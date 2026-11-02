// apns.js + push.js: iOS devices are reached directly through APNs (no Firebase iOS SDK); Android stays on FCM.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { sendApns, makeJwt, readConfig } = require('../../netlify/lib/apns');
const { pushToTokens, splitTokens } = require('../../netlify/lib/push');

const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const env = { APNS_KEY: pem, APNS_KEY_ID: 'ABC123DEFG', APNS_TEAM_ID: 'TEAM123456' };

// fake HTTP/2 session: statusFor(token) decides the answer
const fakeConnect = (statusFor, log) => () => {
  const s = new EventEmitter();
  s.close = () => {};
  s.request = (headers) => {
    const req = new EventEmitter();
    const token = headers[':path'].split('/').pop();
    req.end = (payload) => {
      log.push({ headers, payload });
      setImmediate(() => {
        const st = statusFor(token);
        req.emit('response', { ':status': st });
        if (st !== 200) req.emit('data', JSON.stringify({ reason: st === 410 ? 'Unregistered' : 'BadDeviceToken' }));
        req.emit('end');
      });
    };
    return req;
  };
  return s;
};

describe('apns', () => {
  it('is not configured without the three env values (and never throws)', async () => {
    assert.equal(readConfig({}), null);
    const r = await sendApns(['aa'], { title: 't', body: 'b' }, { env: {} });
    assert.equal(r.configured, false);
  });
  it('signs a verifiable ES256 token with the key id and team id', () => {
    const cfg = readConfig(env);
    const jwt = makeJwt(cfg, 1700000000000);
    const [h, c, sig] = jwt.split('.');
    assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url')), { alg: 'ES256', kid: 'ABC123DEFG' });
    assert.deepEqual(JSON.parse(Buffer.from(c, 'base64url')), { iss: 'TEAM123456', iat: 1700000000 });
    const ok = crypto.verify('sha256', Buffer.from(h + '.' + c), { key: crypto.createPublicKey(privateKey), dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url'));
    assert.equal(ok, true);
  });
  it('sends one request per token with the right topic, reports dead tokens', async () => {
    const log = [];
    const r = await sendApns(['good', 'gone', 'bad'], { title: 'כותרת', body: 'גוף', data: { type: 'newMessage', fromUid: 'u1' } },
      { env, connect: fakeConnect((t) => (t === 'good' ? 200 : t === 'gone' ? 410 : 400), log) });
    assert.equal(r.sent, 1);
    assert.equal(r.failed, 2);
    assert.deepEqual(r.dead.sort(), ['bad', 'gone']);
    assert.equal(log[0].headers['apns-topic'], 'app.drushe.mobile');
    assert.match(log[0].headers.authorization, /^bearer /);
    assert.equal(JSON.parse(log[0].payload).fromUid, 'u1');
  });
});

describe('push', () => {
  it('a token without a platform is Android; ios tokens go to APNs', () => {
    assert.deepEqual(splitTokens({ a: { uid: 'u' }, b: { uid: 'u', platform: 'ios' }, c: { uid: 'u', platform: 'android' } }), { fcm: ['a', 'c'], ios: ['b'] });
  });
  it('sends each platform through its own channel and prunes dead tokens', async () => {
    const removed = []; const log = [];
    const db = { ref: (p) => ({ remove: async () => { removed.push(p); } }) };
    const admin = { messaging: () => ({ sendEachForMulticast: async (m) => ({ successCount: m.tokens.length - 1, failureCount: 1, responses: m.tokens.map((t) => (t === 'deadfcm' ? { error: { code: 'messaging/registration-token-not-registered' } } : {})) }) }) };
    const r = await pushToTokens(admin, db, { okfcm: { uid: 'u' }, deadfcm: { uid: 'u' }, ios1: { uid: 'u', platform: 'ios' }, ios2: { uid: 'u', platform: 'ios' } }, { title: 't', body: 'b' },
      { apnsOptions: { env, connect: fakeConnect((t) => (t === 'ios1' ? 200 : 410), log) } });
    assert.equal(r.sent, 2); // okfcm + ios1
    assert.equal(r.failed, 2);
    assert.deepEqual(removed.sort(), ['fcmTokens/deadfcm', 'fcmTokens/ios2']);
  });
});
