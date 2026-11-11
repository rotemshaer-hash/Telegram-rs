// group-leave.js: a child leaves a group and the place really frees up.
//
// The counter sits on the group record, which only the leader may write, so until now it
// only ever went down in the leaving child's own browser: on the server a group that
// filled up stayed 'full' for good and disappeared from the list. Letting a member lower
// the counter in the rules was not safe either — every verified account creates its own
// membership row by tapping "join", so a pending joiner could free place after place and
// reopen a full group. The server recounts from the member list instead.

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

let data; let updates; let removed;
const LEADER = 'teacher-uid'; const KID = 'kid-uid'; const OTHER = 'other-kid';

const fakeDb = {
  ref: (p) => ({
    get: async () => ({ val: () => (p === undefined ? data : data[p]), exists: () => data[p] !== undefined }),
    remove: async () => { removed.push(p); delete data[p]; },
    update: async (v) => { updates.push(v); Object.assign(data, v); },
    transaction: async (fn) => { const v = fn(data[p]); if (v === undefined) return { committed: false }; data[p] = v; return { committed: true, snapshot: { val: () => v } }; },
  }),
};
// db.ref() with no path, for the multi-path update
const rootRef = { update: async (v) => { updates.push(v); Object.assign(data, v); } };
const dbWithRoot = { ref: (p) => (p === undefined ? rootRef : fakeDb.ref(p)) };

const resolve = (rel) => require.resolve(path.join(__dirname, rel));
require.cache[resolve('../../netlify/lib/firebase-admin-init.js')] = {
  exports: {
    initAdmin: () => {},
    admin: {
      auth: () => ({ verifyIdToken: async (t) => { if (t === 'bad') throw new Error('x'); return { uid: t }; } }),
      database: () => dbWithRoot,
    },
  },
};
const { handler } = require('../../netlify/functions/group-leave.js');

const call = async (uid, body) => {
  const res = await handler({
    httpMethod: 'POST', headers: { origin: 'https://kidemy-app.netlify.app' },
    body: JSON.stringify({ idToken: uid, ...body }),
  });
  return { status: res.statusCode, body: JSON.parse(res.body || '{}') };
};

beforeEach(() => {
  updates = []; removed = [];
  data = {
    'groups/g1': { teacherId: LEADER, title: 'חוג', status: 'full', membersCount: 3, maxStudents: 3 },
    [`groupMembers/g1/${KID}`]: { name: 'ילד', status: 'approved' },
    [`groupMembers/g1/${OTHER}`]: { name: 'ילדה', status: 'approved' },
    'groupMembers/g1': { [KID]: { status: 'approved' }, [OTHER]: { status: 'approved' }, pending1: { status: 'pending' } },
  };
});

describe('a child leaving a group frees the place on the server', () => {
  it('removes the membership and recounts, reopening a full group', async () => {
    data['groupMembers/g1'] = { [OTHER]: { status: 'approved' }, pending1: { status: 'pending' } };
    const r = await call(KID, { groupId: 'g1' });
    assert.equal(r.status, 200);
    assert.equal(r.body.membersCount, 1);
    assert.equal(r.body.status, 'open');
    assert.deepEqual(removed, [`groupMembers/g1/${KID}`, `userGroups/${KID}/g1`]);
    assert.deepEqual(updates, [{ 'groups/g1/membersCount': 1, 'groups/g1/status': 'open' }]);
  });

  it('counts only approved members, never the pending requests', async () => {
    data['groups/g1'] = { teacherId: LEADER, status: 'open', membersCount: 9, maxStudents: 5 };
    data['groupMembers/g1'] = { a: { status: 'approved' }, b: { status: 'pending' }, c: { status: 'rejected' } };
    const r = await call(KID, { groupId: 'g1' });
    assert.equal(r.body.membersCount, 1);
  });

  it('someone who is not in the group changes nothing', async () => {
    delete data[`groupMembers/g1/${KID}`];
    const r = await call(KID, { groupId: 'g1' });
    assert.equal(r.status, 404);
    assert.deepEqual(removed, []);
    assert.deepEqual(updates, []);
  });

  it('the leaving child cannot name someone else — the uid comes from the token', async () => {
    const r = await call(KID, { groupId: 'g1', uid: OTHER });
    assert.equal(r.status, 200);
    assert.ok(removed.includes(`groupMembers/g1/${KID}`));
    assert.ok(!removed.includes(`groupMembers/g1/${OTHER}`));
  });

  it('refuses a bad session, a bad group id and the wrong method', async () => {
    assert.equal((await call('bad', { groupId: 'g1' })).status, 401);
    assert.equal((await call(KID, { groupId: 'g1/../x' })).status, 400);
    const res = await handler({ httpMethod: 'GET', headers: {}, body: '' });
    assert.equal(res.statusCode, 405);
  });

  it('a group that no longer exists still lets the child out', async () => {
    delete data['groups/g1'];
    const r = await call(KID, { groupId: 'g1' });
    assert.equal(r.status, 200);
    assert.ok(removed.includes(`groupMembers/g1/${KID}`));
    assert.deepEqual(updates, []);
  });
});
