// Drushe — שליחת push ישירות ל-APNs (אפל), בלי Firebase iOS SDK.
//
// למה: ה-plugin של Capacitor ב-iOS מחזיר טוקן APNs ולא טוקן FCM, ו-FCM לא יודע לשלוח אליו בלי SDK נוסף בתוך
// האפליקציה (חבילה, קובץ הגדרה, שינוי בפרויקט Xcode שאי אפשר לבדוק בלי Mac). שליחה ישירה דורשת רק מפתח .p8 אחד
// בשרת: חתימת JWT (ES256) + בקשת HTTP/2 לכל מכשיר.
//
// משתני סביבה (מוגדרים ב-Netlify אחרי שחשבון המפתח של אפל מאושר):
//   APNS_KEY      — תוכן קובץ ה-.p8 (אפשר עם \n מילולי)
//   APNS_KEY_ID   — 10 התווים של המפתח
//   APNS_TEAM_ID  — Team ID של חשבון המפתח
//   APNS_ENV      — 'sandbox' לבניית Xcode רגילה; כל ערך אחר (ברירת מחדל) = production (TestFlight/חנות)
// בלי שלושת הראשונים הפונקציה מחזירה configured:false והשליחה ל-iOS מדולגת (אנדרואיד לא מושפע).

const crypto = require('node:crypto');
const http2 = require('node:http2');

const BUNDLE_ID = 'app.drushe.mobile';
const JWT_TTL_MS = 50 * 60 * 1000; // אפל דורשת חידוש בין 20 ל-60 דקות

const b64url = (b) => Buffer.from(b).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

function makeJwt({ key, keyId, teamId }, now = Date.now()) {
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: keyId }));
  const claims = b64url(JSON.stringify({ iss: teamId, iat: Math.floor(now / 1000) }));
  const data = header + '.' + claims;
  const sig = crypto.sign('sha256', Buffer.from(data), { key, dsaEncoding: 'ieee-p1363' });
  return data + '.' + b64url(sig);
}

function readConfig(env = process.env) {
  const key = String(env.APNS_KEY || '').replace(/\\n/g, '\n');
  const keyId = env.APNS_KEY_ID || '';
  const teamId = env.APNS_TEAM_ID || '';
  if (!/BEGIN PRIVATE KEY/.test(key) || !keyId || !teamId) return null;
  return { key, keyId, teamId, host: env.APNS_ENV === 'sandbox' ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com' };
}

let _jwt = null; let _jwtAt = 0;

// tokens: מערך טוקני APNs (hex). מחזיר { configured, sent, failed, dead } — dead = טוקנים שאפל אמרה שאינם תקפים (למחיקה).
async function sendApns(tokens, { title, body, data }, { env = process.env, connect = http2.connect } = {}) {
  const cfg = readConfig(env);
  if (!cfg) return { configured: false, sent: 0, failed: 0, dead: [] };
  if (!tokens.length) return { configured: true, sent: 0, failed: 0, dead: [] };
  if (!_jwt || Date.now() - _jwtAt > JWT_TTL_MS) { _jwt = makeJwt(cfg); _jwtAt = Date.now(); }
  const payload = JSON.stringify({ aps: { alert: { title, body }, sound: 'default' }, ...(data || {}) });
  const session = connect(cfg.host);
  session.on('error', () => {});
  const out = { configured: true, sent: 0, failed: 0, dead: [] };
  try {
    await Promise.all(tokens.map((token) => new Promise((resolve) => {
      const req = session.request({
        ':method': 'POST',
        ':path': '/3/device/' + token,
        authorization: 'bearer ' + _jwt,
        'apns-topic': BUNDLE_ID,
        'apns-push-type': 'alert',
        'apns-priority': '10',
      });
      let status = 0; let resp = '';
      req.on('response', (h) => { status = h[':status']; });
      req.on('data', (c) => { resp += c; });
      req.on('end', () => {
        if (status === 200) out.sent++;
        else {
          out.failed++;
          let reason = ''; try { reason = JSON.parse(resp).reason; } catch (_e) { /* גוף ריק */ }
          if (status === 410 || reason === 'BadDeviceToken' || reason === 'Unregistered') out.dead.push(token);
        }
        resolve();
      });
      req.on('error', () => { out.failed++; resolve(); });
      req.end(payload);
    })));
  } finally {
    try { session.close(); } catch (_e) { /* כבר סגור */ }
  }
  return out;
}

module.exports = { sendApns, makeJwt, readConfig, BUNDLE_ID };
