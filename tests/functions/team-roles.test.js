// team-roles.js: only the owner adds or removes team members, only adults, and removal bites at once.
//
// "צוות Drushe" is written in every legal document, but the system knew one admin identity. A team member sees
// children's data, so who may be one is decided on the server, by the owner, and never by the client.

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

let tree; let authUsers; let claims; let revoked; let mails; let created;
const segs = (p) => String(p).split('/').filter(Boolean);
const getAt = (p) => segs(p).reduce((n, k) => (n == null ? undefined : n[k]), tree);
const setAt = (p, v) => {
  const s = segs(p);
  if (v === null || v === undefined) { const parent = getAt(s.slice(0, -1).join('/')); if (parent) delete parent[s[s.length - 1]]; return; }
  let n = tree;
  s.slice(0, -1).forEach((k) => { if (typeof n[k] !== 'object' || n[k] === null) n[k] = {}; n = n[k]; });
  n[s[s.length - 1]] = v;
};
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const fakeDb = { ref: (p) => ({
  get: async () => { const v = clone(getAt(p)); return { val: () => (v === undefined ? null : v), exists: () => v !== undefined }; },
  set: async (v) => setAt(p, clone(v)),
  remove: async () => setAt(p, null),
  push: async (v) => { const id = 'p' + Object.keys(getAt(p) || {}).length; setAt(p + '/' + id, clone(v)); return { key: id }; },
  transaction: async (fn) => { const v = fn(clone(getAt(p))); if (v === undefined) return { committed: false }; setAt(p, clone(v)); return { committed: true }; },
}) };
const fakeAuth = {
  verifyIdToken: async (t) => { if (t === 'bad') throw new Error('x'); return { uid: t, email: t === 'owner' ? 'rotemshaer@gmail.com' : t + '@example.com' }; },
  getUserByEmail: async (email) => { const u = authUsers[email]; if (!u) { const e = new Error('nf'); e.code = 'auth/user-not-found'; throw e; } return u; },
  getUser: async (uid) => Object.values(authUsers).find((u) => u.uid === uid) || { uid, customClaims: {} },
  createUser: async ({ email }) => { const u = { uid: 'new-' + email.split('@')[0], email, customClaims: {} }; authUsers[email] = u; created.push(email); return u; },
  setCustomUserClaims: async (uid, c) => { claims[uid] = c; },
  revokeRefreshTokens: async (uid) => { revoked.push(uid); },
};
const resolve = (rel) => require.resolve(path.join(__dirname, rel));
require.cache[resolve('../../netlify/lib/firebase-admin-init.js')] = { exports: { initAdmin: () => {}, admin: { auth: () => fakeAuth, database: () => fakeDb } } };
require.cache[resolve('../../netlify/lib/emailjs.js')] = { exports: { sendViaEmailJS: async (to, subject, message) => { mails.push({ to, subject, message }); } } };
const { handler } = require('../../netlify/functions/team-roles.js');

const call = async (token, body) => {
  const res = await handler({ httpMethod: 'POST', headers: { origin: 'https://kidemy-app.netlify.app' }, body: JSON.stringify({ idToken: token, ...body }) });
  return { status: res.statusCode, body: JSON.parse(res.body || '{}') };
};

beforeEach(() => {
  tree = { users: {} }; authUsers = {}; claims = {}; revoked = []; mails = []; created = [];
});

describe('team-roles: who may change the team', () => {
  it('only the owner — a team member, a user and a stranger are refused', async () => {
    tree.team = { member: true };
    for (const who of ['member', 'kid', 'stranger']) {
      assert.equal((await call(who, { action: 'add', email: 'x@example.org', confirmAdult: true })).status, 403);
      assert.equal((await call(who, { action: 'remove', uid: 'member' })).status, 403);
      assert.equal((await call(who, { action: 'list' })).status, 403);
    }
    assert.equal(tree.team.member, true, 'nothing changed');
    assert.equal((await call('bad', { action: 'list' })).status, 401);
  });
});

describe('team-roles: adding', () => {
  it('a brand-new adult gets an account, a record, the flag, the claim, a log line and an invitation', async () => {
    const r = await call('owner', { action: 'add', email: 'Dana@Example.org', confirmAdult: true });
    assert.equal(r.status, 200); assert.equal(r.body.created, true);
    const uid = r.body.uid;
    assert.equal(tree.team[uid], true);
    assert.equal(tree.teamInfo[uid].email, 'dana@example.org');
    assert.equal(tree.users[uid].verified, true);
    assert.equal(tree.users[uid].role, 'teacher');
    assert.equal(claims[uid].team, true);
    assert.equal(Object.values(tree.teamLog)[0].action, 'add');
    assert.equal(mails.length, 1);
    assert.equal(mails[0].to, 'dana@example.org');
    assert.match(mails[0].message, /שכחתי סיסמה/);
  });

  it('an existing adult account is promoted, not recreated or overwritten', async () => {
    authUsers['mom@example.org'] = { uid: 'mom', email: 'mom@example.org', customClaims: { other: 1 } };
    tree.users.mom = { name: 'אמא', role: 'teacher', verified: true, age: 40 };
    const r = await call('owner', { action: 'add', email: 'mom@example.org', confirmAdult: true });
    assert.equal(r.body.created, false); assert.deepEqual(created, []);
    assert.equal(tree.users.mom.name, 'אמא');
    assert.deepEqual(claims.mom, { other: 1, team: true }, 'other claims survive');
  });

  it('never a child: a student account, an under-18, or an account with a parent address', async () => {
    for (const [email, rec] of [['s@example.org', { role: 'student', verified: true }], ['t@example.org', { role: 'teacher', age: 16 }], ['p@example.org', { role: 'teacher', parentEmail: 'm@example.org' }]]) {
      authUsers[email] = { uid: email.split('@')[0], email, customClaims: {} };
      tree.users[email.split('@')[0]] = rec;
      assert.equal((await call('owner', { action: 'add', email, confirmAdult: true })).status, 409, email);
    }
    assert.equal(tree.team, undefined);
  });

  it('the owner must say it is an adult, and the address must be real', async () => {
    assert.equal((await call('owner', { action: 'add', email: 'x@example.org' })).status, 400);
    assert.equal((await call('owner', { action: 'add', email: 'x@example.org', confirmAdult: 'yes' })).status, 400);
    assert.equal((await call('owner', { action: 'add', email: 'not-an-email', confirmAdult: true })).status, 400);
    assert.equal((await call('owner', { action: 'add', email: 'kid@kidemy.app', confirmAdult: true })).status, 400);
    assert.equal((await call('owner', { action: 'add', email: 'rotemshaer@gmail.com', confirmAdult: true })).status, 400);
    assert.deepEqual(created, []);
  });

  it('a failed invitation email does not undo the addition', async () => {
    const mod = require.cache[resolve('../../netlify/lib/emailjs.js')].exports;
    const orig = mod.sendViaEmailJS; mod.sendViaEmailJS = async () => { throw new Error('smtp'); };
    const r = await call('owner', { action: 'add', email: 'a@example.org', confirmAdult: true });
    mod.sendViaEmailJS = orig;
    assert.equal(r.status, 200);
    assert.equal(tree.team[r.body.uid], true);
  });
});

describe('team-roles: removing and listing', () => {
  it('removal deletes the flag and the info, clears the claim, revokes the sessions and is logged', async () => {
    const add = await call('owner', { action: 'add', email: 'a@example.org', confirmAdult: true });
    const uid = add.body.uid;
    const r = await call('owner', { action: 'remove', uid });
    assert.equal(r.status, 200);
    assert.equal(tree.team && tree.team[uid], undefined);
    assert.equal(tree.teamInfo && tree.teamInfo[uid], undefined);
    assert.equal(claims[uid].team, false);
    assert.deepEqual(revoked, [uid]);
    assert.ok(Object.values(tree.teamLog).some((l) => l.action === 'remove' && l.uid === uid));
  });

  it('lists the members for the owner', async () => {
    await call('owner', { action: 'add', email: 'a@example.org', confirmAdult: true });
    const r = await call('owner', { action: 'list' });
    assert.equal(r.body.members.length, 1);
    assert.equal(r.body.members[0].email, 'a@example.org');
  });

  it('refuses a malformed uid', async () => {
    assert.equal((await call('owner', { action: 'remove', uid: 'a/../b' })).status, 400);
  });
});
