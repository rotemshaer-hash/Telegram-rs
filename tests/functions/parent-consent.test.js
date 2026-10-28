// parent-consent.js "create", run against an in-memory stand-in for the Firebase
// Admin SDK. The consent link is the only thing that releases a minor's account
// gate, so these pin WHERE it is sent: to the address on the user's record (the
// one the admin sees and approves against), never to an address the request
// names, and never to the child's own mailbox.
//
// Review finding (27.10.2026): the parent's email was taken from the request body.

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

let data;           // flat path -> value
let written;        // { path: value } for set()
let sent;           // [{ to, subject, message }]
const CHILD = 'child-uid';

const fakeDb = {
  ref: (p) => ({
    get: async () => ({ val: () => data[p], exists: () => data[p] !== undefined }),
    set: async (v) => { written[p] = v; },
    push: async (v) => { written[p + '/(push)'] = v; },
    update: async (v) => { written[p + '/(update)'] = v; },
    transaction: async (fn) => { const v = fn(data[p]); if (v === undefined) return { committed: false }; data[p] = v; return { committed: true }; },
    child: () => ({ transaction: async () => ({ committed: true }) }),
  }),
};

const resolve = (rel) => require.resolve(path.join(__dirname, rel));
require.cache[resolve('../../netlify/lib/firebase-admin-init.js')] = {
  exports: {
    initAdmin: () => {},
    admin: {
      auth: () => ({ verifyIdToken: async (t) => ({ uid: t, email: data['__email__' + t] || t + '@example.com' }) }),
      database: Object.assign(() => fakeDb, { ServerValue: { TIMESTAMP: 'ts' } }),
    },
  },
};
require.cache[resolve('../../netlify/lib/emailjs.js')] = {
  exports: { sendViaEmailJS: async (to, subject, message) => { sent.push({ to, subject, message }); return true; } },
};
const { handler } = require('../../netlify/functions/parent-consent.js');

const create = async (body) => {
  const res = await handler({
    httpMethod: 'POST', headers: { origin: 'https://kidemy-app.netlify.app' },
    body: JSON.stringify({ action: 'create', idToken: CHILD, studentName: 'Kid', ...body }),
  });
  return { status: res.statusCode, body: JSON.parse(res.body || '{}') };
};
const consentRecord = () => Object.entries(written).find(([k]) => k.startsWith('parentConsent/'))?.[1];

beforeEach(() => {
  written = {}; sent = [];
  data = { [`users/${CHILD}/parentEmail`]: 'mom@example.org' };
});

describe('parent-consent create', () => {
  it('sends the link to the parent on the user record', async () => {
    const r = await create({ parentEmail: 'mom@example.org' });
    assert.equal(r.status, 200);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'mom@example.org');
    assert.equal(consentRecord().parentEmail, 'mom@example.org');
  });

  it('ignores a different parentEmail in the request', async () => {
    const r = await create({ parentEmail: 'attacker@example.net' });
    assert.equal(r.status, 200);
    assert.equal(sent[0].to, 'mom@example.org');
    assert.equal(consentRecord().parentEmail, 'mom@example.org');
    assert.ok(!sent.some((m) => m.to === 'attacker@example.net'));
  });

  it('refuses when the user record has no parent email, even if the request has one', async () => {
    delete data[`users/${CHILD}/parentEmail`];
    const r = await create({ parentEmail: 'attacker@example.net' });
    assert.equal(r.status, 400);
    assert.equal(sent.length, 0);
    assert.equal(consentRecord(), undefined);
  });

  it("refuses the child's own login email as the parent's", async () => {
    data[`users/${CHILD}/parentEmail`] = 'Kid@Example.com';
    data['__email__' + CHILD] = 'kid@example.com';
    const r = await create({});
    assert.equal(r.status, 400);
    assert.equal(sent.length, 0);
  });

  it('refuses the internal @kidemy.app placeholder address', async () => {
    data[`users/${CHILD}/parentEmail`] = 'kid@kidemy.app';
    const r = await create({});
    assert.equal(r.status, 400);
    assert.equal(sent.length, 0);
  });

  it('requires a signed-in session', async () => {
    const res = await handler({
      httpMethod: 'POST', headers: { origin: 'https://kidemy-app.netlify.app' },
      body: JSON.stringify({ action: 'create', parentEmail: 'mom@example.org' }),
    });
    assert.equal(res.statusCode, 401);
    assert.equal(sent.length, 0);
  });
});
