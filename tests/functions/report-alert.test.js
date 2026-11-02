// report-alert.js: a critical/high report pushes to the admin's phone, once, and only for the reporter's own report.
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

let data; let pushes;
const fakeDb = {
  ref: (p) => ({
    get: async () => ({ val: () => data[p], exists: () => data[p] !== undefined }),
    transaction: async (fn) => { const v = fn(data[p]); if (v === undefined) return { committed: false }; data[p] = v; return { committed: true }; },
    orderByChild: () => ({ equalTo: (u) => ({ get: async () => {
      const toks = Object.keys(data).filter((k) => k.startsWith('fcmTokens/') && data[k].uid === u);
      const val = {}; toks.forEach((k) => { val[k.slice(10)] = data[k]; });
      return { exists: () => toks.length > 0, val: () => val };
    } }) }),
  }),
};
const resolve = (rel) => require.resolve(path.join(__dirname, rel));
require.cache[resolve('../../netlify/lib/firebase-admin-init.js')] = {
  exports: { initAdmin: () => {}, admin: {
    auth: () => ({ verifyIdToken: async (t) => { if (t === 'bad') throw new Error('x'); return { uid: t }; }, getUserByEmail: async () => ({ uid: 'admin-uid' }) }),
    database: () => fakeDb,
    messaging: () => ({ sendEachForMulticast: async (m) => { pushes.push(m); return { successCount: m.tokens.length, failureCount: 0 }; } }),
  } },
};
const { handler } = require('../../netlify/functions/report-alert.js');
const call = async (uid, body) => {
  const res = await handler({ httpMethod: 'POST', headers: { origin: 'https://kidemy-app.netlify.app' }, body: JSON.stringify({ idToken: uid, ...body }) });
  return { status: res.statusCode, body: JSON.parse(res.body || '{}') };
};

beforeEach(() => {
  pushes = [];
  data = {
    'reports/r1': { reporterId: 'kid', severity: 'critical', reasonLabel: 'סכנת בטיחות', targetName: 'Teen' },
    'reports/r2': { reporterId: 'kid', severity: 'low', reasonLabel: 'ספאם', targetName: 'x' },
    'fcmTokens/tok1': { uid: 'admin-uid' },
  };
});

describe('report-alert', () => {
  it('pushes a critical report to the admin phone, once', async () => {
    const r = await call('kid', { reportId: 'r1' });
    assert.equal(r.body.sent, 1);
    assert.equal(pushes.length, 1);
    assert.match(pushes[0].notification.title, /קריטי/);
    assert.equal((await call('kid', { reportId: 'r1' })).body.duplicate, true);
    assert.equal(pushes.length, 1);
  });
  it('does not push a low-severity report, someone else\'s report, or a bad session', async () => {
    assert.equal((await call('kid', { reportId: 'r2' })).body.sent, 0);
    assert.equal((await call('stranger', { reportId: 'r1' })).status, 403);
    assert.equal((await call('bad', { reportId: 'r1' })).status, 401);
    assert.equal(pushes.length, 0);
  });
});
