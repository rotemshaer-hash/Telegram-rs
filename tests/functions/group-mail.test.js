// group-mail.js: the parent hears when the child is accepted/rejected for a specific group (same pattern as
// lesson-mail.js) — the teacher's client never sees the parent's contact details.

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

let data; let sent;
const TEACHER = 'teacher-uid'; const KID = 'kid-uid'; const OTHER = 'other-teacher';

const fakeDb = {
  ref: (p) => ({
    get: async () => ({ val: () => data[p], exists: () => data[p] !== undefined }),
    remove: async () => { delete data[p]; },
    push: async (v) => { data[p + '/(push)'] = v; },
    transaction: async (fn) => {
      const v = fn(data[p]);
      if (v === undefined) return { committed: false };
      data[p] = v; return { committed: true };
    },
  }),
};
const resolve = (rel) => require.resolve(path.join(__dirname, rel));
require.cache[resolve('../../netlify/lib/firebase-admin-init.js')] = {
  exports: {
    initAdmin: () => {},
    admin: { auth: () => ({ verifyIdToken: async (t) => { if (t === 'bad') throw new Error('x'); return { uid: t, email: t === 'admin-uid' ? 'rotemshaer@gmail.com' : t + '@example.com' }; } }), database: () => fakeDb },
  },
};
require.cache[resolve('../../netlify/lib/emailjs.js')] = {
  exports: { sendViaEmailJS: async (to, subject, message) => { sent.push({ to, subject, message }); return true; } },
};
const { handler } = require('../../netlify/functions/group-mail.js');

const call = async (uid, body) => {
  const res = await handler({
    httpMethod: 'POST', headers: { origin: 'https://kidemy-app.netlify.app' },
    body: JSON.stringify({ idToken: uid, ...body }),
  });
  return { status: res.statusCode, body: JSON.parse(res.body || '{}') };
};

beforeEach(() => {
  sent = [];
  data = {
    'groups/g1': { teacherId: TEACHER, teacherName: 'Teach', title: 'Chess', location: 'Herzl 1', day: 'ב', time: '17:00', status: 'open' },
    [`groupMembers/g1/${KID}/status`]: 'approved',
    [`users/${TEACHER}/verified`]: true,
    [`users/${KID}/name`]: 'Kid',
    [`users/${KID}/parentEmail`]: 'mom@example.org',
    [`users/${KID}/parentName`]: 'Mom',
  };
});

describe('group-mail', () => {
  it('prefers the parent address the server locked over the one the child can edit', async () => {
    data[`parentContact/${KID}/email`] = 'real-mom@example.org';
    const r = await call(TEACHER, { groupId: 'g1', uid: KID, event: 'approved' });
    assert.equal(r.status, 200);
    assert.equal(r.body.sent, true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'real-mom@example.org');
    assert.match(sent[0].subject, /Chess/);
    assert.match(sent[0].message, /Herzl 1/);
    assert.match(sent[0].message, /נפגשות פיזית/);
  });

  it('sends once per (group, child, event) — a second call is a silent duplicate', async () => {
    await call(TEACHER, { groupId: 'g1', uid: KID, event: 'approved' });
    const again = await call(TEACHER, { groupId: 'g1', uid: KID, event: 'approved' });
    assert.equal(again.body.duplicate, true);
    assert.equal(sent.length, 1);
  });

  it('a rejection composes different copy and is also deduped independently of approval', async () => {
    data[`groupMembers/g1/${KID}/status`] = 'rejected';
    await call(TEACHER, { groupId: 'g1', uid: KID, event: 'rejected' });
    assert.equal(sent.length, 1);
    assert.doesNotMatch(sent[0].subject, /התקבל/);
  });

  it('refuses a teacher who does not own the group, a status mismatch, an inactive account or a bad session', async () => {
    assert.equal((await call(OTHER, { groupId: 'g1', uid: KID, event: 'approved' })).status, 403);
    data[`groupMembers/g1/${KID}/status`] = 'pending';
    assert.equal((await call(TEACHER, { groupId: 'g1', uid: KID, event: 'approved' })).status, 409);
    data[`groupMembers/g1/${KID}/status`] = 'approved';
    delete data[`users/${TEACHER}/verified`];
    assert.equal((await call(TEACHER, { groupId: 'g1', uid: KID, event: 'approved' })).status, 403);
    data[`users/${TEACHER}/verified`] = true;
    assert.equal((await call('bad', { groupId: 'g1', uid: KID, event: 'approved' })).status, 401);
    assert.equal(sent.length, 0);
  });

  // The parent was emailed the place and the hour. Until now nothing told them when the
  // meetup was called off, so the child could turn up and find nobody there
  // (regulation review 11.11.2026).
  it('a cancelled group emails the parent, but only once the group is really closed', async () => {
    const live = await call(TEACHER, { groupId: 'g1', uid: KID, event: 'cancelled' });
    assert.equal(live.status, 409);
    data['groups/g1'].status = 'closed';
    const r = await call(TEACHER, { groupId: 'g1', uid: KID, event: 'cancelled' });
    assert.equal(r.status, 200);
    assert.equal(r.body.sent, true);
    assert.match(sent[0].subject, /בוטלה/);
    assert.match(sent[0].message, /לא יתקיים/);
    // and only once
    const again = await call(TEACHER, { groupId: 'g1', uid: KID, event: 'cancelled' });
    assert.equal(again.body.duplicate, true);
  });

  it('the admin may cancel a group that is not theirs; another teacher may not', async () => {
    data['groups/g1'].status = 'cancelled';
    data['users/admin-uid/verified'] = true;
    data[`users/${OTHER}/verified`] = true;
    const stranger = await call(OTHER, { groupId: 'g1', uid: KID, event: 'cancelled' });
    assert.equal(stranger.status, 403);
    const admin = await call('admin-uid', { groupId: 'g1', uid: KID, event: 'cancelled' });
    assert.equal(admin.status, 200);
    assert.equal(admin.body.sent, true);
  });

  it('a made-up or fake-domain parent address is silently skipped, not an error', async () => {
    data[`users/${KID}/parentEmail`] = 'kid@kidemy.app';
    const r = await call(TEACHER, { groupId: 'g1', uid: KID, event: 'approved' });
    assert.equal(r.status, 200);
    assert.equal(r.body.sent, false);
    assert.equal(sent.length, 0);
  });
});
