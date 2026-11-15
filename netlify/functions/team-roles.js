// Drushe — הבעלים מוסיף ומסיר חברי צוות.
//
// השורש: "צוות Drushe" נכתב בכל מסמך משפטי, אבל המערכת הכירה זהות מנהל אחת (המייל של הבעלים, כ-150 הפניות בחוקים).
// כלומר מכל "הצוות בודק" שנאמר לצד שלישי, מי שבודק בפועל הוא אדם אחד — ושום אדם נוסף לא היה יכול לבדוק גם אם רצה.
//
// מה זה נותן: חבר צוות מבצע עבודת בדיקה (אישור ודחייה של ילדים ומורים, דיווחים, קבוצות, תוכן) ולא מגדיר את הכללים.
// החוקים (database.rules.json) מגדירים במדויק מה הוא יכול; כאן רק מי הוא. זה חייב לרוץ בשרת: אם הלקוח יכול לכתוב
// team/<uid>, כל משתמש מעניק לעצמו גישה לילדים.
//
// הגנות:
//  * רק הבעלים (לפי הטוקן, לא לפי הבקשה) יכול להוסיף ולהסיר.
//  * הבעלים מצהיר שזה מבוגר, והשרת מסרב לחשבון שנראה כמו חשבון של ילד (תפקיד תלמיד, גיל מתחת ל-18, או מייל הורה).
//  * כל פעולה נרשמת ב-teamLog.
//  * הסרה: הדגל נמחק (חל מיד בחוקי RTDB), ה-claim נמחק והטוקנים מבוטלים (Storage).

const { admin, initAdmin } = require('../lib/firebase-admin-init');
const { sendViaEmailJS } = require('../lib/emailjs');
const ALLOWED_ORIGINS = require('../lib/allowed-origins');
const { FAKE_DOMAIN } = require('../lib/internal-email');
const { withinWindowLimit } = require('../lib/rate-limit');
const { ADMIN_EMAIL } = require('../lib/admin-email');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UID_RE = /^[-A-Za-z0-9_]{1,128}$/;
const RATE_MAX = 60;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const clip = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);

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
  if (!['list', 'add', 'remove'].includes(body.action)) return reply(400, { error: 'Invalid action' });

  let ownerUid;
  try {
    initAdmin();
    const decoded = await admin.auth().verifyIdToken(body.idToken);
    if (String(decoded.email || '').toLowerCase() !== ADMIN_EMAIL) return reply(403, { error: 'owner only' });
    ownerUid = decoded.uid;
  } catch (_e) {
    return reply(401, { error: 'invalid or expired session' });
  }

  try {
    const db = admin.database();
    if (!(await withinWindowLimit(db, 'teamRolesRateLimit', ownerUid, RATE_MAX, RATE_WINDOW_MS))) return reply(429, { error: 'rate' });
    const log = (entry) => db.ref('teamLog').push({ ...entry, by: ownerUid, at: Date.now() }).catch(() => {});

    if (body.action === 'list') {
      const info = (await db.ref('teamInfo').get()).val() || {};
      const members = Object.entries(info).map(([uid, m]) => ({ uid, email: clip(m.email, 200), name: clip(m.name, 80), addedAt: m.addedAt || 0 }));
      return reply(200, { members });
    }

    if (body.action === 'add') {
      const email = String(body.email || '').trim().toLowerCase();
      if (!EMAIL_RE.test(email) || email.endsWith(FAKE_DOMAIN) || email.length > 200) return reply(400, { error: 'bad_email' });
      if (email === ADMIN_EMAIL) return reply(400, { error: 'owner' });
      if (body.confirmAdult !== true) return reply(400, { error: 'confirm_adult' });

      let user; let created = false;
      try {
        user = await admin.auth().getUserByEmail(email);
      } catch (e) {
        if (!e || e.code !== 'auth/user-not-found') throw e;
        user = null;
      }
      const rec = user ? (await db.ref('users/' + user.uid).get()).val() : null;
      // חשבון שנראה כמו של ילד לא הופך לחבר צוות, גם אם הבעלים סימן "מבוגר"
      if (rec && (rec.role === 'student' || rec.parentEmail || (Number.isFinite(Number(rec.age)) && Number(rec.age) < 18))) {
        return reply(409, { error: 'child_account' });
      }
      if (!user) { user = await admin.auth().createUser({ email, emailVerified: true }); created = true; }

      const name = clip((rec && rec.name) || user.displayName || email.split('@')[0], 80);
      if (!rec) {
        // אותה צורה כמו רשומת הבעלים: נכנס כמו כל משתמש מאושר, בלי מסלול ההרשמה של ילדים
        await db.ref('users/' + user.uid).set({ name, email, role: 'teacher', verified: true, createdAt: Date.now(), teamMember: true });
      }
      await db.ref('team/' + user.uid).set(true);
      await db.ref('teamInfo/' + user.uid).set({ email, name, addedAt: Date.now(), addedBy: ownerUid });
      await admin.auth().setCustomUserClaims(user.uid, { ...(user.customClaims || {}), team: true });
      await log({ action: 'add', uid: user.uid, email, created });

      // הזמנה במייל — נכשלת בשקט: החבר כבר נוסף, והבעלים יכול להגיד לו "שכחתי סיסמה" בעצמו
      try {
        await sendViaEmailJS(email, 'הוזמנת לצוות Drushe',
          `שלום ${name},\n\nהוזמנת להצטרף לצוות Drushe — בדיקת הרשמות, דיווחים וקבוצות של ילדים ונוער.\n\n` +
          `כדי להיכנס: ${ALLOWED_ORIGINS[0]} ← "כניסה" ← "שכחתי סיסמה" עם המייל הזה, והגדר/י סיסמה.\n\n` +
          `המידע שתראה/י הוא מידע על ילדים. אין לצלם, להעתיק או לשתף אותו, ואין לפתוח את הפאנל במכשיר משותף.\n\n– Drushe`);
      } catch (mailErr) { console.error('[team-roles] invite mail failed:', mailErr.message); }
      return reply(200, { ok: true, uid: user.uid, created });
    }

    // remove
    const uid = String(body.uid || '');
    if (!UID_RE.test(uid)) return reply(400, { error: 'bad_uid' });
    const info = (await db.ref('teamInfo/' + uid).get()).val();
    await db.ref('team/' + uid).remove();
    await db.ref('teamInfo/' + uid).remove();
    try {
      const u = await admin.auth().getUser(uid);
      await admin.auth().setCustomUserClaims(uid, { ...(u.customClaims || {}), team: false });
      await admin.auth().revokeRefreshTokens(uid);
    } catch (e) { console.error('[team-roles] claim cleanup failed:', e.message); }
    await log({ action: 'remove', uid, email: info && info.email });
    return reply(200, { ok: true });
  } catch (err) {
    console.error('[team-roles]', err);
    return reply(500, { error: 'server_error' });
  }
};
