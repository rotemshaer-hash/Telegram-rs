// notify.js group notifications, run against an in-memory stand-in for the
// Firebase Admin SDK. The function is the only thing between "a group owner"
// and "any user's notification panel", so these pin who may notify whom, and
// that the text shown to the recipient comes from the database, not the request.
//
// Review finding (27.10.2026): groupApproved/groupRejected only checked that the
// caller owned the group — not that the recipient had asked to join — and the
// group title came from the request, so any group owner could put text of their
// choosing in front of any user.

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

let data;           // flat path -> value
let pushed;         // [{ path, value }]
const OWNER = 'owner-uid', JOINER = 'joiner-uid', STRANGER = 'stranger-uid';

const get = (p) => data[p];
const fakeDb = {
  ref: (p) => ({
    get: async () => ({ val: () => get(p), exists: () => get(p) !== undefined }),
    push: async (value) => { pushed.push({ path: p, value }); },
    transaction: async (fn) => { const v = fn(get(p)); data[p] = v; return { snapshot: { val: () => v } }; },
    orderByKey: () => ({ limitToLast: () => ({ get: async () => ({ forEach: () => {} }) }) }),
  }),
};
const uidFromToken = (t) => ({ uid: t, email: t + '@example.com' });

require.cache[require.resolve(path.join(__dirname, '../../netlify/lib/firebase-admin-init.js'))] = {
  exports: {
    initAdmin: () => {},
    admin: { auth: () => ({ verifyIdToken: async (t) => uidFromToken(t) }), database: () => fakeDb },
  },
};
const { handler } = require('../../netlify/functions/notify.js');

const call = async (callerUid, body) => {
  const res = await handler({
    httpMethod: 'POST', headers: { origin: 'https://kidemy-app.netlify.app' },
    body: JSON.stringify({ idToken: callerUid, ...body }),
  });
  return { status: res.statusCode, body: JSON.parse(res.body || '{}') };
};

beforeEach(() => {
  pushed = [];
  data = {
    'groups/g1': { teacherId: OWNER, title: 'Chess club' },
    [`groupMembers/g1/${JOINER}`]: { status: 'approved', name: 'Joiner' },
    [`users/${OWNER}/name`]: 'Owner',
    [`users/${JOINER}/name`]: 'Joiner',
    [`users/${OWNER}/verified`]: true,
    [`users/${JOINER}/verified`]: true,
  };
});

describe('only an approved, unblocked account can notify another user', () => {
  it('an unverified sender is refused', async () => {
    delete data[`users/${OWNER}/verified`];
    const r = await call(OWNER, { toUid: JOINER, type: 'groupApproved', ctx: { groupId: 'g1' } });
    assert.equal(r.status, 403);
    assert.equal(pushed.length, 0);
  });

  it('a blocked sender is refused', async () => {
    data[`userBlocks/${OWNER}`] = { at: 1 };
    const r = await call(OWNER, { toUid: JOINER, type: 'groupApproved', ctx: { groupId: 'g1' } });
    assert.equal(r.status, 403);
    assert.equal(pushed.length, 0);
  });
});

describe('group notifications', () => {
  it('the owner can tell a member who was approved', async () => {
    const r = await call(OWNER, { toUid: JOINER, type: 'groupApproved', ctx: { groupId: 'g1' } });
    assert.equal(r.status, 200);
    assert.equal(pushed.length, 1);
  });

  it('the owner cannot send "approved" to a user who never asked to join', async () => {
    const r = await call(OWNER, { toUid: STRANGER, type: 'groupApproved', ctx: { groupId: 'g1' } });
    assert.equal(r.status, 403);
    assert.equal(pushed.length, 0);
  });

  it('the owner cannot send "approved" when the member is only pending', async () => {
    data[`groupMembers/g1/${JOINER}`] = { status: 'pending' };
    const r = await call(OWNER, { toUid: JOINER, type: 'groupApproved', ctx: { groupId: 'g1' } });
    assert.equal(r.status, 403);
  });

  it('"rejected" requires a rejected request, not an approved one', async () => {
    const r = await call(OWNER, { toUid: JOINER, type: 'groupRejected', ctx: { groupId: 'g1' } });
    assert.equal(r.status, 403);
  });

  it('the title shown to the recipient comes from the group, not the request', async () => {
    const r = await call(OWNER, {
      toUid: JOINER, type: 'groupApproved',
      ctx: { groupId: 'g1', groupTitle: '<img src=x onerror=alert(1)>' },
    });
    assert.equal(r.status, 200);
    assert.equal(pushed[0].value.groupTitle, 'Chess club');
  });

  it('someone who is not the owner cannot approve', async () => {
    const r = await call(STRANGER, { toUid: JOINER, type: 'groupApproved', ctx: { groupId: 'g1' } });
    assert.equal(r.status, 403);
  });

  it('a join request notifies the owner only if the sender really asked to join', async () => {
    const ok = await call(JOINER, { toUid: OWNER, type: 'groupJoin', ctx: { groupId: 'g1' } });
    assert.equal(ok.status, 200);
    const spam = await call(STRANGER, { toUid: OWNER, type: 'groupJoin', ctx: { groupId: 'g1' } });
    assert.equal(spam.status, 403);
  });

  it('a join request cannot be aimed at someone other than the owner', async () => {
    const r = await call(JOINER, { toUid: STRANGER, type: 'groupJoin', ctx: { groupId: 'g1' } });
    assert.equal(r.status, 403);
  });
});

// QA 29.10.2026: question and brief notifications only checked WHO the sender was,
// not that the question or proposal they point at exists — any teacher could tell
// any child "your question was answered".
describe('question and brief notifications point at something real', () => {
  const TEACH = OWNER;
  beforeEach(() => {
    data['teachers/' + TEACH] = { name: 'T' };
    data[`teacherQA/${TEACH}/q1`] = { askerUid: JOINER, question: 'why?', answer: 'because' };
    data[`teacherQA/${TEACH}/q2`] = { askerUid: JOINER, question: 'unanswered?', answer: null };
    data['parentBriefs/br1'] = { parentUid: JOINER };
    data[`briefProposals/br1/${TEACH}`] = { price: 50 };
  });

  it('the teacher can tell the asker an answered question was answered', async () => {
    const r = await call(TEACH, { toUid: JOINER, type: 'questionAnswered', ctx: { teacherUid: TEACH, qaId: 'q1' } });
    assert.equal(r.status, 200);
  });

  it('but not a user who did not ask it, nor a question that has no answer', async () => {
    assert.equal((await call(TEACH, { toUid: STRANGER, type: 'questionAnswered', ctx: { teacherUid: TEACH, qaId: 'q1' } })).status, 403);
    assert.equal((await call(TEACH, { toUid: JOINER, type: 'questionAnswered', ctx: { teacherUid: TEACH, qaId: 'q2' } })).status, 403);
    assert.equal((await call(TEACH, { toUid: JOINER, type: 'questionAnswered', ctx: { teacherUid: TEACH } })).status, 403);
  });

  it('a new-question notice must be about the sender’s own question', async () => {
    assert.equal((await call(JOINER, { toUid: TEACH, type: 'newQuestion', ctx: { teacherUid: TEACH, qaId: 'q1' } })).status, 200);
    assert.equal((await call(STRANGER, { toUid: TEACH, type: 'newQuestion', ctx: { teacherUid: TEACH, qaId: 'q1' } })).status, 403);
  });

  it('a proposal notice needs a submitted proposal, and an acceptance needs the teacher to have one', async () => {
    assert.equal((await call(TEACH, { toUid: JOINER, type: 'briefProposal', ctx: { briefId: 'br1' } })).status, 200);
    assert.equal((await call(STRANGER, { toUid: JOINER, type: 'briefProposal', ctx: { briefId: 'br1' } })).status, 403);
    assert.equal((await call(JOINER, { toUid: TEACH, type: 'briefAccepted', ctx: { briefId: 'br1' } })).status, 200);
    assert.equal((await call(JOINER, { toUid: STRANGER, type: 'briefAccepted', ctx: { briefId: 'br1' } })).status, 403);
  });
});
