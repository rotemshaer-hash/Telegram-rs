// password-reset.js must find the account through Firebase Auth, never through a field the user writes
// (security review 2.11.2026: users/<uid>/email is user-writable, so an attacker could claim a victim's login
// and receive the victim's reset link at an address of their own choosing).

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

let data = {};
let sent = [];
let resetLinksFor = [];
const AUTH_USERS = { 'victim@kidemy.app': 'victim-uid', 'real@kidemy.app': 'real-uid' };

const fakeDb = {
  ref: (p) => ({
    get: async () => ({ val: () => data[p], exists: () => data[p] !== undefined }),
    push: async () => {},
    transaction: async (fn) => { const v = fn(data[p]); if (v === undefined) return { committed: false }; data[p] = v; return { committed: true }; },
    // the old code path: a query over users by the user-writable email field. Present so a regression would be visible.
    orderByChild: () => ({ equalTo: (v) => ({ get: async () => ({ exists: () => true, forEach: (cb) => cb({ val: () => ({ email: v, parentEmail: 'attacker@evil.example', name: 'x' }) }) }) }) }),
  }),
};
const resolve = (rel) => require.resolve(path.join(__dirname, rel));
require.cache[resolve('../../netlify/lib/firebase-admin-init.js')] = {
  exports: {
    initAdmin: () => {},
    admin: {
      database: () => fakeDb,
      auth: () => ({
        getUserByEmail: async (e) => { if (!AUTH_USERS[e]) throw new Error('auth/user-not-found'); return { uid: AUTH_USERS[e] }; },
        generatePasswordResetLink: async (e) => { resetLinksFor.push(e); return 'https://reset.example/link'; },
      }),
    },
  },
};
require.cache[resolve('../../netlify/lib/emailjs.js')] = { exports: { sendViaEmailJS: async (to) => { sent.push(to); return true; } } };
const { handler } = require('../../netlify/functions/password-reset.js');

const call = (username, ip = '1.1.1.1') => handler({ httpMethod: 'POST', headers: { origin: 'https://kidemy-app.netlify.app', 'x-nf-client-connection-ip': ip }, body: JSON.stringify({ username }) });

beforeEach(() => { data = {}; sent = []; resetLinksFor = []; });

describe('password-reset', () => {
  it('sends the link to the parent address of the real account owner, taken from the server-locked contact', async () => {
    data['parentContact/victim-uid/email'] = 'mom@example.org';
    data['users/victim-uid/parentEmail'] = 'child-edited@example.net';
    data['users/victim-uid/name'] = 'Kid';
    const r = await call('victim');
    assert.equal(r.statusCode, 200);
    assert.deepEqual(sent, ['mom@example.org']);
    assert.deepEqual(resetLinksFor, ['victim@kidemy.app']);
  });

  it('is not fooled by another user writing the victim’s login into their own record', async () => {
    // the attacker's own record claims the victim's email and an address of their choosing
    data['users/zzz-attacker/email'] = 'victim@kidemy.app';
    data['users/zzz-attacker/parentEmail'] = 'attacker@evil.example';
    data['users/victim-uid/parentEmail'] = 'mom@example.org';
    await call('victim');
    assert.deepEqual(sent, ['mom@example.org']);
    assert.equal(sent.includes('attacker@evil.example'), false);
  });

  it('answers the same for an account that does not exist, and sends nothing', async () => {
    const r = await call('nobodyhere');
    assert.equal(r.statusCode, 200);
    assert.deepEqual(sent, []);
    assert.deepEqual(resetLinksFor, []);
  });
});
