// group-consent.js: a child is let into a group only after the parent approved THAT group.
//
// The claim this protects: "the parents knew". Before, the parent approved the app once, in general; the
// leader could then accept the child into any group, and the parent was told afterwards, if at all. These
// tests pin the new order — request → email to the parent with the group's details → the parent's click →
// only then does the server write the field the rules require before the leader may approve.

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

// a small real tree, so nested paths behave like the database (get/set/update/remove/transaction/push)
let tree; let emails; let pushes;
const segs = (p) => String(p).split('/').filter(Boolean);
const getAt = (p) => segs(p).reduce((n, k) => (n == null ? undefined : n[k]), tree);
const setAt = (p, v) => {
  const s = segs(p);
  if (v === null || v === undefined) {
    const parent = getAt(s.slice(0, -1).join('/'));
    if (parent) delete parent[s[s.length - 1]];
    return;
  }
  let n = tree;
  s.slice(0, -1).forEach((k) => { if (typeof n[k] !== 'object' || n[k] === null) n[k] = {}; n = n[k]; });
  n[s[s.length - 1]] = v;
};
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const fakeDb = {
  ref: (p) => ({
    get: async () => { const v = clone(getAt(p)); return { val: () => (v === undefined ? null : v), exists: () => v !== undefined }; },
    set: async (v) => setAt(p, clone(v)),
    remove: async () => setAt(p, null),
    update: async (o) => Object.keys(o).forEach((k) => setAt(p + '/' + k, clone(o[k]))),
    push: async (v) => { const id = 'push' + Object.keys(getAt(p) || {}).length; setAt(p + '/' + id, clone(v)); pushes.push({ p, v }); return { key: id }; },
    child: (k) => fakeDb.ref(p + '/' + k),
    transaction: async (fn) => { const v = fn(clone(getAt(p))); if (v === undefined) return { committed: false }; setAt(p, clone(v)); return { committed: true, snapshot: { val: () => v } }; },
  }),
};
const resolve = (rel) => require.resolve(path.join(__dirname, rel));
require.cache[resolve('../../netlify/lib/firebase-admin-init.js')] = {
  exports: { initAdmin: () => {}, admin: {
    auth: () => ({ verifyIdToken: async (t) => {
      if (t === 'bad') throw new Error('x');
      return { uid: t, email: t + '@example.com', firebase: { sign_in_provider: t === 'guest' ? 'anonymous' : 'password' } };
    } }),
    database: () => fakeDb,
  } },
};
require.cache[resolve('../../netlify/lib/emailjs.js')] = {
  exports: { sendViaEmailJS: async (to, subject, message) => { if (global.__mailFails) throw new Error('smtp down'); emails.push({ to, subject, message }); return true; } },
};
const { handler } = require('../../netlify/functions/group-consent.js');
const { GROUP_EMERGENCY_PHONE } = require('../../netlify/lib/safety-contact');

const KID = 'kid-uid'; const LEADER = 'leader-uid';
const call = async (body, ip = '1.1.1.1') => {
  const res = await handler({ httpMethod: 'POST', headers: { origin: 'https://kidemy-app.netlify.app', 'x-nf-client-connection-ip': ip, 'user-agent': 'UA-1' }, body: JSON.stringify(body) });
  return { status: res.statusCode, body: JSON.parse(res.body || '{}') };
};
const tokenFromMail = () => emails[emails.length - 1].message.match(/groupConsent=([a-f0-9]{64})/)[1];

beforeEach(() => {
  global.__mailFails = false; emails = []; pushes = [];
  tree = {
    groups: { g1: { teacherId: LEADER, teacherName: 'מוביל', title: 'שחמט בפארק', location: 'פארק הירקון', day: 'יום שני', time: '17:00', status: 'open', minAge: 11, maxAge: 14 } },
    groupMembers: { g1: { [KID]: { name: 'דנה', status: 'pending', joinedAt: 1 } } },
    users: { [KID]: { name: 'דנה', age: 12, parentEmail: 'parent@example.org', parentName: 'רונית' } },
  };
});

describe('group-consent: request', () => {
  it('mails the parent the group’s details and a personal link, and tells them nothing is decided without them', async () => {
    const r = await call({ action: 'request', idToken: KID, groupId: 'g1' });
    assert.equal(r.status, 200);
    assert.equal(emails.length, 1);
    assert.equal(emails[0].to, 'parent@example.org');
    const m = emails[0].message;
    assert.match(m, /שחמט בפארק/); assert.match(m, /פארק הירקון/); assert.match(m, /יום שני בשעה 17:00/);
    assert.match(m, /11–14/); assert.match(m, /ללא נוכחות הורים/); assert.match(m, /קבוצה נוספת תדרוש אישור נפרד/);
    assert.ok(m.includes(GROUP_EMERGENCY_PHONE), 'the emergency number is in the parent’s email');
    assert.match(m, /^[\s\S]*https:\/\/kidemy-app\.netlify\.app\/\?groupConsent=[a-f0-9]{64}/);
  });

  it('the token never reaches the child — it is only in the email and the server record', async () => {
    const r = await call({ action: 'request', idToken: KID, groupId: 'g1' });
    assert.ok(!JSON.stringify(r.body).includes(tokenFromMail()));
  });

  it('nothing is approved by asking — the member record is untouched', async () => {
    await call({ action: 'request', idToken: KID, groupId: 'g1' });
    assert.equal(tree.groupMembers.g1[KID].parentApprovedAt, undefined);
    assert.equal(tree.groupMembers.g1[KID].status, 'pending');
  });

  it('refuses a child outside the group’s age range, and sends nothing', async () => {
    tree.users[KID].age = 9;
    assert.equal((await call({ action: 'request', idToken: KID, groupId: 'g1' })).status, 403);
    tree.users[KID].age = 16;
    assert.equal((await call({ action: 'request', idToken: KID, groupId: 'g1' })).status, 403);
    tree.users[KID].age = undefined;
    assert.equal((await call({ action: 'request', idToken: KID, groupId: 'g1' })).status, 403);
    assert.equal(emails.length, 0);
  });

  it('refuses a group that never declared an age range', async () => {
    delete tree.groups.g1.minAge; delete tree.groups.g1.maxAge;
    const r = await call({ action: 'request', idToken: KID, groupId: 'g1' });
    assert.equal(r.status, 409); assert.equal(r.body.error, 'group_no_age_range');
    assert.equal(emails.length, 0);
  });

  it('only for a child who really has a pending request, on an open group', async () => {
    assert.equal((await call({ action: 'request', idToken: 'stranger', groupId: 'g1' })).status, 409);
    tree.groups.g1.status = 'pending';
    assert.equal((await call({ action: 'request', idToken: KID, groupId: 'g1' })).status, 409);
    assert.equal(emails.length, 0);
  });

  it('never mails the child’s own address or a fake-domain address as the "parent"', async () => {
    tree.users[KID].parentEmail = KID + '@example.com';
    assert.equal((await call({ action: 'request', idToken: KID, groupId: 'g1' })).status, 422);
    tree.users[KID].parentEmail = 'x@kidemy.app';
    assert.equal((await call({ action: 'request', idToken: KID, groupId: 'g1' })).status, 422);
    assert.equal(emails.length, 0);
  });

  it('the address locked at registration beats the one the child can edit', async () => {
    tree.parentContact = { [KID]: { email: 'real-parent@example.org' } };
    tree.users[KID].parentEmail = 'child-controlled@example.org';
    await call({ action: 'request', idToken: KID, groupId: 'g1' });
    assert.equal(emails[0].to, 'real-parent@example.org');
  });

  it('a second request voids the first link', async () => {
    await call({ action: 'request', idToken: KID, groupId: 'g1' });
    const first = tokenFromMail();
    await call({ action: 'request', idToken: KID, groupId: 'g1' });
    assert.equal((await call({ action: 'approve', token: first })).status, 410);
    assert.equal((await call({ action: 'approve', token: tokenFromMail() })).status, 200);
  });

  it('a guest, a bad session and a bad group id are refused', async () => {
    assert.equal((await call({ action: 'request', idToken: 'guest', groupId: 'g1' })).status, 403);
    assert.equal((await call({ action: 'request', idToken: 'bad', groupId: 'g1' })).status, 401);
    assert.equal((await call({ action: 'request', idToken: KID, groupId: 'g1/../x' })).status, 400);
  });

  it('a mail failure is reported to the child and to the admin, not swallowed', async () => {
    global.__mailFails = true;
    const r = await call({ action: 'request', idToken: KID, groupId: 'g1' });
    assert.equal(r.status, 502);
    assert.ok(pushes.some((p) => p.p === 'adminNotifs'));
  });

  it('is rate limited per child', async () => {
    for (let i = 0; i < 10; i++) assert.equal((await call({ action: 'request', idToken: KID, groupId: 'g1' })).status, 200);
    assert.equal((await call({ action: 'request', idToken: KID, groupId: 'g1' })).status, 429);
  });
});

describe('group-consent: the parent’s side', () => {
  let token;
  beforeEach(async () => { await call({ action: 'request', idToken: KID, groupId: 'g1' }); token = tokenFromMail(); });

  it('info shows the child, the group and the emergency number — and nothing else', async () => {
    const r = await call({ action: 'info', token });
    assert.equal(r.status, 200);
    assert.equal(r.body.childName, 'דנה');
    assert.equal(r.body.group.location, 'פארק הירקון');
    assert.equal(r.body.emergencyPhone, GROUP_EMERGENCY_PHONE);
    assert.ok(!JSON.stringify(r.body).includes('parent@example.org'), 'the parent’s own address is not echoed');
  });

  it('approve writes the one field the rules require, on this member only, and logs the evidence', async () => {
    const r = await call({ action: 'approve', token });
    assert.equal(r.status, 200); assert.equal(r.body.decision, 'approved');
    assert.equal(typeof tree.groupMembers.g1[KID].parentApprovedAt, 'number');
    assert.equal(tree.groupMembers.g1[KID].status, 'pending', 'approval is the leader’s separate step');
    const log = Object.values(tree.groupConsentLog['g1_' + KID])[0];
    assert.equal(log.decision, 'approved'); assert.equal(log.snapshot.location, 'פארק הירקון'); assert.equal(log.ip, '1.1.1.1');
  });

  it('decline rejects the child and never writes the approval', async () => {
    const r = await call({ action: 'decline', token });
    assert.equal(r.body.decision, 'declined');
    assert.equal(tree.groupMembers.g1[KID].status, 'rejected');
    assert.equal(tree.groupMembers.g1[KID].parentApprovedAt, undefined);
  });

  it('the link works once — a second click, or a switch of mind, is refused', async () => {
    await call({ action: 'approve', token });
    assert.equal((await call({ action: 'approve', token })).status, 409);
    assert.equal((await call({ action: 'decline', token })).status, 409);
    assert.equal(tree.groupMembers.g1[KID].status, 'pending');
  });

  it('an expired, unknown or malformed link does nothing', async () => {
    tree.groupConsent[token].expiresAt = Date.now() - 1;
    assert.equal((await call({ action: 'approve', token })).status, 410);
    assert.equal((await call({ action: 'approve', token: 'a'.repeat(64) })).status, 404);
    assert.equal((await call({ action: 'approve', token: 'short' })).status, 400);
    assert.equal(tree.groupMembers.g1[KID].parentApprovedAt, undefined);
  });

  it('what the parent approved is what they get: a changed group voids the link', async () => {
    tree.groups.g1.location = 'דירה פרטית';
    const r = await call({ action: 'approve', token });
    assert.equal(r.status, 409); assert.equal(r.body.error, 'group_changed');
    assert.equal(tree.groupMembers.g1[KID].parentApprovedAt, undefined);
  });

  it('a closed group, or a child who already left, cannot be approved into', async () => {
    tree.groups.g1.status = 'closed';
    assert.equal((await call({ action: 'approve', token })).status, 410);
    tree.groups.g1.status = 'open'; delete tree.groupMembers.g1[KID];
    assert.equal((await call({ action: 'approve', token })).status, 409);
  });

  it('the link is for one child and one group: another child’s membership is never touched', async () => {
    tree.groupMembers.g1.other = { name: 'x', status: 'pending' };
    await call({ action: 'approve', token });
    assert.equal(tree.groupMembers.g1.other.parentApprovedAt, undefined);
  });
});

describe('the emergency number is defined once per side and the two agree', () => {
  it('index.html and the server library hold the same number', () => {
    const html = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
    const m = html.match(/const GROUP_EMERGENCY_PHONE='([^']+)'/);
    assert.ok(m, 'index.html defines GROUP_EMERGENCY_PHONE');
    assert.equal(m[1], GROUP_EMERGENCY_PHONE);
  });
});
