// Drushe — מייל להורה כשנפתחת שיחה חדשה, נשלח מהשרת.
//
// למה לא מהלקוח: הלקוח ניסה לקרוא את users/<הצד השני> כדי להשיג את כתובת ההורה שלו, והחוקים (נכון) חוסמים
// קריאה של רשומת משתמש אחר. הקריאה נכשלה בשקט, והדגל "כבר נשלח" כבר נכתב — אז אף הורה לא קיבל מייל,
// בניגוד למה ש-child-safety.html הבטיח (נמצא 2.11.2026). השרת מזהה את השולח לפי idToken, בודק שבאמת קיימת שיחה
// שהוא כתב בה, קורא את הכתובות (parentContact שננעל בשרת קודם לכתובת שהילד עורך), ושולח נוסח קבוע.
//
// מייל אחד לכל שיחה: newConversationNotified/<chatId> נתפס בטרנזקציה.

const { admin, initAdmin } = require('../lib/firebase-admin-init');
const { sendViaEmailJS } = require('../lib/emailjs');
const ALLOWED_ORIGINS = require('../lib/allowed-origins');
const { FAKE_DOMAIN } = require('../lib/internal-email');
const { withinWindowLimit } = require('../lib/rate-limit');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

const clip = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);

async function parentOf(db, uid) {
  const [locked, rec, parentName, name] = await Promise.all([
    db.ref('parentContact/' + uid + '/email').get(),
    db.ref('users/' + uid + '/parentEmail').get(),
    db.ref('users/' + uid + '/parentName').get(),
    db.ref('users/' + uid + '/name').get(),
  ]);
  const to = String(locked.val() || rec.val() || '').trim();
  return { to, parentName: clip(parentName.val(), 60), name: clip(name.val(), 60) };
}

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
  const otherUid = String(body.otherUid || '');
  if (!UID_RE.test(otherUid)) return reply(400, { error: 'Invalid request' });

  let uid;
  try {
    initAdmin();
    uid = (await admin.auth().verifyIdToken(body.idToken)).uid;
  } catch (_e) {
    return reply(401, { error: 'invalid or expired session' });
  }
  if (uid === otherUid) return reply(400, { error: 'Invalid request' });

  try {
    const db = admin.database();
    if (!(await withinWindowLimit(db, 'conversationMailRateLimit', uid, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS))) {
      return reply(429, { error: 'Too many requests' });
    }
    const [verified, blocked] = await Promise.all([
      db.ref('users/' + uid + '/verified').get(),
      db.ref('userBlocks/' + uid).get(),
    ]);
    if (verified.val() !== true || blocked.exists()) return reply(403, { error: 'account is not active' });

    // השיחה חייבת להיות אמיתית: הודעה אחרונה בה היא של השולח
    const chatId = [uid, otherUid].sort().join('_');
    const last = await db.ref('messages/' + chatId).limitToLast(1).get();
    let lastFrom = null;
    last.forEach((m) => { lastFrom = (m.val() || {}).from; });
    if (lastFrom !== uid) return reply(403, { error: 'no such conversation' });

    // מייל אחד לכל שיחה
    const claim = await db.ref('newConversationNotified/' + chatId).transaction((cur) => (cur ? undefined : Date.now()));
    if (!claim.committed) return reply(200, { ok: true, sent: 0, duplicate: true });

    const [me, other] = await Promise.all([parentOf(db, uid), parentOf(db, otherUid)]);
    const meName = me.name || 'המשתמש/ת';
    const otherName = other.name || 'המשתמש/ת השני/ה';
    const tail = '\n\nהשיחות נשמרות ונבדקות על ידי צוות Drushe במקרה של דיווח או חשד. ההורה יכול לעיין בשיחות דרך חשבון הילד.\n\nמזכירים: מומלץ להיות נוכח/ת בשיעור הראשון עם מורה/תלמיד/ה חדש/ה.\n\n– צוות Drushe 💙';
    const jobs = [];
    const add = (p, subject, text) => {
      if (EMAIL_RE.test(p.to) && !p.to.toLowerCase().endsWith(FAKE_DOMAIN)) jobs.push(sendViaEmailJS(p.to, subject, text));
    };
    add(me, `💬 שיחה חדשה של ${meName} ב-Drushe`,
      `שלום ${me.parentName || 'הורה יקר'} 👋\n\n${meName} התחיל/ה עכשיו שיחה חדשה עם ${otherName} ב-Drushe.${tail}`);
    add(other, `💬 שיחה חדשה של ${otherName} ב-Drushe`,
      `שלום ${other.parentName || 'הורה יקר'} 👋\n\n${otherName} מקבל/ת עכשיו שיחה חדשה מ-${meName} ב-Drushe.${tail}`);

    const results = await Promise.allSettled(jobs);
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed) {
      await db.ref('adminNotifs').push({ type: 'conversationMailFailed', chatId, failed, read: false, createdAt: Date.now() });
    }
    return reply(200, { ok: true, sent: results.length - failed });
  } catch (err) {
    console.error('[conversation-mail]', err);
    return reply(500, { error: 'server_error' });
  }
};
