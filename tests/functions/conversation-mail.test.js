// conversation-mail.js: the parents hear about a new conversation from the server. The client could not do it —
// it tried to read the other user's record, which the rules (rightly) refuse — so no parent was ever emailed.

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

let data; let sent;
const KID = 'kid-uid'; const TEACH = 'teach-uid';
const chat = [KID, TEACH].sort().join('_');

const fakeDb = {
  ref: (p) => ({
    get: async () => ({ val: () => data[p], exists: () => data[p] !== undefined }),
    push: async (v) => { data[p + '/(push)'] = v; },
    transaction: async (fn) => { const v = fn(data[p]); if (v === undefined) return { committed: false }; data[p] = v; return { committed: true }; },
    limitToLast: () => ({
      get: async () => {
        const pre = p + '/';
        const keys = [...new Set(Object.keys(data).filter((k) => k.startsWith(pre)).map((k) => k.slice(pre.length).split('/')[0]))];
        const k = keys[keys.length - 1];
        return { forEach: (cb) => { if (k) cb({ val: () => ({ from: data[pre + k + '/from'] }) }); } };
      },
    }),
  }),
};
const resolve = (rel) => require.resolve(path.join(__dirname, rel));
require.cache[resolve('../../netlify/lib/firebase-admin-init.js')] = {
  exports: { initAdmin: () => {}, admin: { auth: () => ({ verifyIdToken: async (t) => { if (t === 'bad') throw new Error('x'); return { uid: t }; } }), database: () => fakeDb } },
};
require.cache[resolve('../../netlify/lib/emailjs.js')] = { exports: { sendViaEmailJS: async (to, subject, message) => { sent.push({ to, subject, message }); return true; } } };
const { handler } = require('../../netlify/functions/conversation-mail.js');

const call = async (uid, body) => {
  const res = await handler({ httpMethod: 'POST', headers: { origin: 'https://kidemy-app.netlify.app' }, body: JSON.stringify({ idToken: uid, ...body }) });
  return { status: res.statusCode, body: JSON.parse(res.body || '{}') };
};

beforeEach(() => {
  sent = [];
  data = {
    [`users/${KID}/verified`]: true, [`users/${KID}/name`]: 'Kid', [`users/${KID}/parentEmail`]: 'kid-edited@example.net', [`users/${KID}/parentName`]: 'Mom',
    [`parentContact/${KID}/email`]: 'mom@example.org',
    [`users/${TEACH}/verified`]: true, [`users/${TEACH}/name`]: 'Teen Teacher', [`users/${TEACH}/parentEmail`]: 'dad@example.org',
    [`messages/${chat}/m1/from`]: KID,
  };
});

describe('conversation-mail', () => {
  it('emails both parents once, using the server-locked address for the child', async () => {
    const r = await call(KID, { otherUid: TEACH });
    assert.equal(r.status, 200);
    assert.deepEqual(sent.map((m) => m.to).sort(), ['dad@example.org', 'mom@example.org']);
    assert.equal(sent.some((m) => m.to === 'kid-edited@example.net'), false);
    const again = await call(KID, { otherUid: TEACH });
    assert.equal(again.body.duplicate, true);
    assert.equal(sent.length, 2);
  });

  it('refuses a caller who is not the author of the last message, an inactive account, or a made-up conversation', async () => {
    data[`messages/${chat}/m1/from`] = TEACH;
    assert.equal((await call(KID, { otherUid: TEACH })).status, 403);
    data[`messages/${chat}/m1/from`] = KID;
    delete data[`users/${KID}/verified`];
    assert.equal((await call(KID, { otherUid: TEACH })).status, 403);
    data[`users/${KID}/verified`] = true;
    assert.equal((await call(KID, { otherUid: 'nobody-uid' })).status, 403);
    assert.equal(sent.length, 0);
  });

  it('skips an address on the internal login domain, and needs a session', async () => {
    data[`parentContact/${KID}/email`] = 'kid@kidemy.app';
    delete data[`users/${KID}/parentEmail`];
    await call(KID, { otherUid: TEACH });
    assert.deepEqual(sent.map((m) => m.to), ['dad@example.org']);
    assert.equal((await call('bad', { otherUid: TEACH })).status, 401);
  });
});
