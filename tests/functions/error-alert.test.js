// error-alert.js: a new client error reaches the admin's inbox — once per error, with a hard daily ceiling.
//
// The app already wrote every uncaught error to clientErrors, but nothing notified anyone: a screen
// broken for everyone could stay broken until someone opened the admin panel. These tests pin the three
// things that make an unauthenticated alert endpoint safe — the record must already exist and be fresh,
// the same error emails once a day, and no flood of distinct errors can pass the daily cap.

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { ADMIN_EMAIL } = require('../../netlify/lib/admin-email');

let data; let emails;
const NOW = Date.now();

const fakeDb = {
  ref: (p) => ({
    get: async () => ({ val: () => data[p], exists: () => data[p] !== undefined }),
    remove: async () => { delete data[p]; },
    transaction: async (fn) => {
      const v = fn(data[p]);
      if (v === undefined) return { committed: false };
      data[p] = v;
      return { committed: true, snapshot: { val: () => v } };
    },
  }),
};

const resolve = (rel) => require.resolve(path.join(__dirname, rel));
require.cache[resolve('../../netlify/lib/firebase-admin-init.js')] = {
  exports: { initAdmin: () => {}, admin: { database: () => fakeDb } },
};
require.cache[resolve('../../netlify/lib/emailjs.js')] = {
  exports: { sendViaEmailJS: async (to, subject, message) => { emails.push({ to, subject, message }); return true; } },
};
const { handler } = require('../../netlify/functions/error-alert.js');

const call = async (body, { origin = 'https://kidemy-app.netlify.app', ip = '1.2.3.4', method = 'POST' } = {}) => {
  const res = await handler({
    httpMethod: method,
    headers: { origin, 'x-nf-client-connection-ip': ip },
    body: JSON.stringify(body),
  });
  return { status: res.statusCode, body: JSON.parse(res.body || '{}') };
};

const err = (over = {}) => ({
  message: "Cannot read properties of null (reading 'name')",
  stack: 'at renderTeacher (index.html:4120)',
  source: 'https://kidemy-app.netlify.app/',
  lineno: 4120,
  lastScreen: 'teacherPage',
  uid: 'kid-uid',
  userAgent: 'Mozilla/5.0 (Linux; Android 14)',
  createdAt: NOW,
  ...over,
});

beforeEach(() => {
  emails = [];
  data = { 'clientErrors/e1': err() };
});

describe('error-alert', () => {
  it('emails the admin about a new error, with the screen and the message', async () => {
    const r = await call({ errorId: 'e1' });
    assert.equal(r.status, 200);
    assert.equal(r.body.sent, 1);
    assert.equal(emails.length, 1);
    assert.equal(emails[0].to, ADMIN_EMAIL);
    assert.match(emails[0].subject, /שגיאה חדשה ב-Drushe/);
    assert.match(emails[0].message, /teacherPage/);
    assert.match(emails[0].message, /Cannot read properties of null/);
    assert.match(emails[0].message, /4120/);
  });

  it('the same error emails once a day — the repeat is counted, not mailed', async () => {
    assert.equal((await call({ errorId: 'e1' })).body.sent, 1);
    data['clientErrors/e2'] = err();                   // same message+source+line, a new record
    const second = await call({ errorId: 'e2' });
    assert.equal(second.body.sent, 0);
    assert.equal(second.body.duplicate, true);
    assert.equal(emails.length, 1);
  });

  it('a different error is a different alert', async () => {
    await call({ errorId: 'e1' });
    data['clientErrors/e2'] = err({ message: 'teachers.map is not a function', lineno: 5531 });
    assert.equal((await call({ errorId: 'e2' })).body.sent, 1);
    assert.equal(emails.length, 2);
  });

  it('an old record never mails — an id cannot be replayed later', async () => {
    data['clientErrors/old'] = err({ createdAt: NOW - 11 * 60 * 1000 });
    const r = await call({ errorId: 'old' });
    assert.equal(r.body.sent, 0);
    assert.equal(r.body.reason, 'stale');
    assert.equal(emails.length, 0);
  });

  it('a record with no timestamp never mails', async () => {
    data['clientErrors/nots'] = err({ createdAt: undefined });
    assert.equal((await call({ errorId: 'nots' })).body.reason, 'stale');
    assert.equal(emails.length, 0);
  });

  it('the text comes from the stored record, never from the caller', async () => {
    const r = await call({ errorId: 'e1', message: 'FAKE-TEXT-FROM-CALLER', uid: 'someone-else' });
    assert.equal(r.body.sent, 1);
    assert.ok(!emails[0].message.includes('FAKE-TEXT-FROM-CALLER'));
    assert.ok(!emails[0].subject.includes('FAKE-TEXT-FROM-CALLER'));
  });

  it('an unknown id, a foreign origin, a bad id and the wrong method are all refused', async () => {
    assert.equal((await call({ errorId: 'nope' })).status, 404);
    assert.equal((await call({ errorId: 'e1' }, { origin: 'https://evil.example' })).status, 403);
    assert.equal((await call({ errorId: '../../users' })).status, 400);
    assert.equal((await call({ errorId: 'e1' }, { method: 'GET' })).status, 405);
    assert.equal(emails.length, 0);
  });

  it('ten distinct errors a day is the ceiling — the eleventh is held back, not lost', async () => {
    for (let i = 0; i < 10; i++) {
      data['clientErrors/x' + i] = err({ message: 'error number ' + i, lineno: 100 + i });
      assert.equal((await call({ errorId: 'x' + i })).body.sent, 1, 'alert ' + i);
    }
    data['clientErrors/over'] = err({ message: 'one too many', lineno: 999 });
    const over = await call({ errorId: 'over' });
    assert.equal(over.body.sent, 0);
    assert.equal(over.body.reason, 'daily cap');
    assert.equal(emails.length, 10);
    // the signature was released, so this error can still alert once the window resets
    assert.ok(!Object.keys(data).some((k) => k.startsWith('errorAlertSent/') && data[k].errorId === 'over'));
  });

  it('one source cannot keep calling — the per-IP window closes', async () => {
    for (let i = 0; i < 20; i++) {
      await call({ errorId: 'nope' }, { ip: '9.9.9.9' });   // 404s, but each one spends the window
    }
    assert.equal((await call({ errorId: 'e1' }, { ip: '9.9.9.9' })).status, 429);
    assert.equal((await call({ errorId: 'e1' }, { ip: '8.8.8.8' })).body.sent, 1);
  });
});
