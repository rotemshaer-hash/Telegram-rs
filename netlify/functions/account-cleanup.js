// Drushe — ניקוי מה שרק השרת מחזיק על משתמש שנמחק.
//
// מחיקת חשבון מהלקוח (deleteAllUserData) מוחקת את מה שהמשתמש רשאי למחוק. אבל כמה
// רשומות נכתבות רק על ידי השרת, ולכן הלקוח לא יכול להסיר אותן — ובהן כתובת ההורה,
// תיעוד ההסכמה (כתובת רשת ו-user-agent של ההורה), טוקני אישור, טוקני פורטל
// ההורים והסטוריז. הן נשארו במסד אחרי "החשבון נמחק בהצלחה", וזה בדיוק מה שהמחיקה
// אמורה למנוע. הפונקציה הזו מסירה אותן, ורצה לפני שהזדהות המשתמש נמחקת.
//
// מזהים את המבקש לפי idToken, לא לפי גוף הבקשה: משתמש מוחק רק את עצמו. המנהל
// (שמוחק חשבון אחר דרך הפאנל) יכול לציין uid.

const { admin, initAdmin } = require('../lib/firebase-admin-init');
const ALLOWED_ORIGINS = require('../lib/allowed-origins');

const ADMIN_EMAIL = 'rotemshaer@gmail.com';
const UID_RE = /^[A-Za-z0-9_-]{1,128}$/;

exports.handler = async (event) => {
  const origin = event.headers.origin || event.headers.Origin || '';
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
  const reply = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_e) { return reply(400, { error: 'Invalid JSON' }); }
  if (!body.idToken) return reply(401, { error: 'idToken is required' });

  let uid;
  try {
    initAdmin();
    const decoded = await admin.auth().verifyIdToken(body.idToken);
    uid = decoded.uid;
    if (body.uid && body.uid !== uid) {
      if (decoded.email !== ADMIN_EMAIL) return reply(403, { error: 'you can only clean up your own account' });
      if (!UID_RE.test(String(body.uid))) return reply(400, { error: 'invalid uid' });
      uid = String(body.uid);
    }
  } catch (_e) {
    return reply(401, { error: 'invalid or expired session' });
  }

  try {
    const db = admin.database();
    const removed = [];
    const drop = async (p) => { await db.ref(p).remove(); removed.push(p); };

    // טוקן ההסכמה הפעיל, ואחריו כל השאר שנוצרו עבור המשתמש
    const activeToken = (await db.ref('parentConsentByUid/' + uid).get()).val();
    if (typeof activeToken === 'string' && /^[a-f0-9]{64}$/.test(activeToken)) await drop('parentConsent/' + activeToken);
    const consents = await db.ref('parentConsent').orderByChild('uid').equalTo(uid).get();
    const consentKeys = [];
    consents.forEach((c) => { consentKeys.push(c.key); });
    for (const k of consentKeys) await drop('parentConsent/' + k);

    for (const p of ['parentConsentByUid/' + uid, 'parentContact/' + uid, 'parentConsentLog/' + uid]) await drop(p);

    // פורטל ההורים: טוקנים שנוצרו עבור התלמיד
    const tokens = await db.ref('parentTokens').orderByChild('uid').equalTo(uid).get();
    const tokenKeys = [];
    tokens.forEach((c) => { tokenKeys.push(c.key); });
    for (const k of tokenKeys) await drop('parentTokens/' + k);

    // סטוריז שהמשתמש העלה (נושאים uid, לא מפתחים אותו)
    const stories = await db.ref('stories').orderByChild('uid').equalTo(uid).get();
    const storyKeys = [];
    stories.forEach((c) => { storyKeys.push(c.key); });
    for (const k of storyKeys) await drop('stories/' + k);

    return reply(200, { ok: true, removed: removed.length });
  } catch (err) {
    console.error('[account-cleanup]', err);
    return reply(500, { error: 'server_error' });
  }
};
