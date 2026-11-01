// send-push answered with no CORS headers, so the packaged app (capacitor://localhost,
// http://localhost) had its response blocked by the browser and a push was never sent,
// with nothing visible. It now uses the same origin list as the other functions.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

require.cache[require.resolve(path.join(__dirname, '../../netlify/lib/firebase-admin-init.js'))] = {
  exports: { initAdmin: () => {}, admin: { auth: () => ({ verifyIdToken: async () => { throw new Error('x'); } }), database: () => ({}) } },
};
const { handler } = require('../../netlify/functions/send-push.js');

describe('send-push CORS', () => {
  it('answers a preflight from the native app', async () => {
    const r = await handler({ httpMethod: 'OPTIONS', headers: { origin: 'capacitor://localhost' }, body: '' });
    assert.equal(r.statusCode, 204);
    assert.equal(r.headers['Access-Control-Allow-Origin'], 'capacitor://localhost');
  });

  it('sets the allow-origin header on a real response too, for the new domain', async () => {
    const r = await handler({ httpMethod: 'POST', headers: { origin: 'https://drushe.com' }, body: '{}' });
    assert.equal(r.headers['Access-Control-Allow-Origin'], 'https://drushe.com');
  });

  it('does not echo an origin that is not on the list', async () => {
    const r = await handler({ httpMethod: 'POST', headers: { origin: 'https://evil.example' }, body: '{}' });
    assert.notEqual(r.headers['Access-Control-Allow-Origin'], 'https://evil.example');
  });
});
