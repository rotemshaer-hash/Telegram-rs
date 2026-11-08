// parent-consent.js, run against an in-memory stand-in for the Firebase Admin SDK.
// The consent link is the only thing that releases a minor's account gate, so these
// pin WHERE it goes (the address the server stored, not one the request names or the
// child edits later), WHO can ask (not a guest, not past the per-IP limit), and what
// the admin is shown about who actually approved.
//
// Review findings (27-29.10.2026): the parent's email came from the request body;
// then from a record the child can edit at any time; guests got a fresh quota per
// uid; old tokens stayed valid; the student name came from the request.

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

let data;           // flat path -> value
let sent;           // [{ to, subject, message }]
const CHILD = 'child-uid';

const nested = (p) => {
  if (p in data) return data[p];
  const pre = p + '/';
  const keys = Object.keys(data).filter((k) => k.startsWith(pre));
  if (!keys.length) return undefined;
  const out = {};
  for (const k of keys) {
    const parts = k.slice(pre.length).split('/');
    let o = out;
    parts.slice(0, -1).forEach((x) => { o = o[x] = o[x] || {}; });
    o[parts[parts.length - 1]] = data[k];
  }
  return out;
};
const writeObj = (p, v) => {
  if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => writeObj(p + '/' + k, x));
  else data[p] = v;
};
const ref = (p) => ({
  get: async () => ({ val: () => nested(p), exists: () => nested(p) !== undefined }),
  set: async (v) => { Object.keys(data).filter((k) => k === p || k.startsWith(p + '/')).forEach((k) => delete data[k]); writeObj(p, v); },
  update: async (v) => { Object.entries(v).forEach(([k, x]) => writeObj(p + '/' + k, x)); },
  push: async (v) => { writeObj(p + '/(push' + Object.keys(data).length + ')', v); },
  child: (c) => ref(p + '/' + c),
  transaction: async (fn) => {
    const v = fn(data[p]);
    if (v === undefined) return { committed: false };
    data[p] = v; return { committed: true };
  },
});
const fakeDb = { ref };

const resolve = (rel) => require.resolve(path.join(__dirname, rel));
require.cache[resolve('../../netlify/lib/firebase-admin-init.js')] = {
  exports: {
    initAdmin: () => {},
    admin: {
      auth: () => ({
        verifyIdToken: async (t) => ({
          uid: t, email: data['__email__' + t] || t + '@example.com',
          firebase: { sign_in_provider: t.startsWith('guest') ? 'anonymous' : 'password' },
        }),
      }),
      database: Object.assign(() => fakeDb, { ServerValue: { TIMESTAMP: 12345 } }),
    },
  },
};
require.cache[resolve('../../netlify/lib/emailjs.js')] = {
  exports: { sendViaEmailJS: async (to, subject, message) => { sent.push({ to, subject, message }); return true; } },
};
const { handler } = require('../../netlify/functions/parent-consent.js');

const callWith = async (body, ip = '1.1.1.1', ua = 'ChildPhone') => {
  const res = await handler({
    httpMethod: 'POST',
    headers: { origin: 'https://kidemy-app.netlify.app', 'x-nf-client-connection-ip': ip, 'user-agent': ua },
    body: JSON.stringify(body),
  });
  return { status: res.statusCode, body: JSON.parse(res.body || '{}') };
};
const create = (extra = {}, uid = CHILD, ip, ua) => callWith({ action: 'create', idToken: uid, ...extra }, ip, ua);
const tokenOf = () => data[`parentConsentByUid/${CHILD}`];

beforeEach(() => {
  sent = [];
  data = { [`users/${CHILD}/parentEmail`]: 'mom@example.org', [`users/${CHILD}/name`]: 'Kid' };
});

describe('parent-consent create', () => {
  it('sends the link to the parent on the user record and stores that address on the server', async () => {
    const r = await create();
    assert.equal(r.status, 200);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'mom@example.org');
    assert.equal(data[`parentContact/${CHILD}/email`], 'mom@example.org');
  });

  it('ignores a parentEmail and a student name in the request', async () => {
    await create({ parentEmail: 'attacker@example.net', studentName: 'EVIL <b>CLICK</b>' });
    assert.equal(sent[0].to, 'mom@example.org');
    assert.doesNotMatch(sent[0].subject + sent[0].message, /EVIL/);
    assert.match(sent[0].subject, /Kid/);
  });

  it('keeps sending to the stored address after the child edits the record', async () => {
    await create();
    data[`users/${CHILD}/parentEmail`] = 'child-second-mailbox@example.net';
    await create();
    assert.equal(sent.length, 2);
    assert.equal(sent[1].to, 'mom@example.org');
  });

  it('refuses when there is no parent address, even if the request has one', async () => {
    delete data[`users/${CHILD}/parentEmail`];
    const r = await create({ parentEmail: 'attacker@example.net' });
    assert.equal(r.status, 400);
    assert.equal(sent.length, 0);
  });

  it("refuses the child's own login email, any case", async () => {
    data[`users/${CHILD}/parentEmail`] = 'Child-Uid@Example.com';
    const r = await create();
    assert.equal(r.status, 400);
    assert.equal(sent.length, 0);
  });

  it('refuses the internal @kidemy.app placeholder', async () => {
    data[`users/${CHILD}/parentEmail`] = 'kid@kidemy.app';
    assert.equal((await create()).status, 400);
  });

  it('does not mail a parent who has already approved', async () => {
    data[`users/${CHILD}/parentConsentAt`] = 999;
    const r = await create();
    assert.equal(r.body.alreadyApproved, true);
    assert.equal(sent.length, 0);
  });

  it('a guest cannot ask for a consent mail', async () => {
    data['users/guest-1/parentEmail'] = 'victim@example.org';
    const r = await create({}, 'guest-1');
    assert.equal(r.status, 403);
    assert.equal(sent.length, 0);
  });

  it('the previous link stops working when a new one is made', async () => {
    await create();
    const first = tokenOf();
    await create();
    assert.notEqual(tokenOf(), first);
    assert.equal(data[`parentConsent/${first}/expiresAt`], 0);
  });

  it('one network address cannot flood parents through many accounts', async () => {
    let last;
    for (let i = 0; i < 41; i++) {
      data[`users/acct-${i}/parentEmail`] = `p${i}@example.org`;
      last = await create({}, `acct-${i}`, '9.9.9.9');
    }
    assert.equal(last.status, 429);
    assert.equal(sent.length, 40);
  });

  it('requires a signed-in session', async () => {
    assert.equal((await callWith({ action: 'create', parentEmail: 'mom@example.org' })).status, 401);
  });
});

describe('parent-consent approve', () => {
  const approve = (ip, ua) => callWith({ action: 'approve', token: tokenOf() }, ip, ua);

  it('records which address approved, and that it was a different device', async () => {
    await create({}, CHILD, '1.1.1.1', 'ChildPhone');
    const r = await approve('2.2.2.2', 'ParentPhone');
    assert.equal(r.status, 200);
    assert.equal(data[`users/${CHILD}/parentConsentEmail`], 'mom@example.org');
    assert.equal(data[`users/${CHILD}/parentConsentSameDevice`], false);
    assert.equal(data[`users/${CHILD}/parentConsentAt`], 12345);
  });

  it('flags a link opened from the same network and device that requested it', async () => {
    await create({}, CHILD, '1.1.1.1', 'ChildPhone');
    await approve('1.1.1.1', 'ChildPhone');
    assert.equal(data[`users/${CHILD}/parentConsentSameDevice`], true);
  });

  it('a superseded link no longer approves', async () => {
    await create();
    const first = tokenOf();
    await create();
    const r = await callWith({ action: 'approve', token: first });
    assert.equal(r.status, 410);
    assert.equal(data[`users/${CHILD}/parentConsentAt`], undefined);
  });
});

// The group-meetup disclosure is written in two places (the page the parent sees, the email the parent gets); they must stay identical.
describe('group meetup notice', () => {
  it('index.html and the consent email carry the same sentence', () => {
    const fs = require('node:fs'); const path = require('node:path');
    const html = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
    const fn = fs.readFileSync(path.join(__dirname, '../../netlify/functions/parent-consent.js'), 'utf8');
    const m = html.match(/const GROUP_MEETUP_NOTICE='([^']+)'/);
    assert.ok(m, 'constant exists');
    assert.ok(fn.includes(m[1]), 'the email says the same thing');
  });
});
