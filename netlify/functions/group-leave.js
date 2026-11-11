// Drushe — ילד יוצא מקבוצה, והמקום באמת מתפנה.
//
// המונה (groups/<id>/membersCount) יושב על רשומת הקבוצה, שרק המוביל רשאי לכתוב. לכן כשילד יצא, המונה ירד רק
// במשתנה המקומי בדפדפן שלו: בשרת הקבוצה נשארה 'full' לנצח, ומסך הקבוצות מסנן status==='open' — כלומר קבוצה
// שהתמלאה פעם אחת נעלמה מכולם לתמיד (ציד באגים 10.11.2026).
//
// הניסיון הראשון היה לתת לחבר קבוצה להוריד את המונה ב-1 ישירות בחוקים. ביקורת האבטחה הראתה למה זה לא מספיק:
// *כל* משתמש מאושר יוצר לעצמו רשומת חברות בלחיצה על "הצטרף", ולכן הוא היה יכול להוריד את המונה שוב ושוב
// ולהחזיר full→open — להכניס ילדים מעבר לתקרה שהמנהל אישר למפגש פיזי. המונה הוא מצב של השרת, ולכן הוא נספר
// כאן מחדש מתוך רשימת החברים עצמה (מקור אמת אחד) במקום להישמר על ידי מי מהצדדים.

const { admin, initAdmin } = require('../lib/firebase-admin-init');
const ALLOWED_ORIGINS = require('../lib/allowed-origins');
const { withinWindowLimit } = require('../lib/rate-limit');

const ID_RE = /^[-A-Za-z0-9_]{1,128}$/;
const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

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

  const groupId = String(body.groupId || '');
  if (!ID_RE.test(groupId)) return reply(400, { error: 'Invalid request' });
  if (!body.idToken) return reply(401, { error: 'idToken is required' });

  let uid;
  try {
    initAdmin();
    uid = (await admin.auth().verifyIdToken(body.idToken)).uid;
  } catch (_e) {
    return reply(401, { error: 'invalid or expired session' });
  }

  try {
    const db = admin.database();
    if (!(await withinWindowLimit(db, 'groupLeaveRateLimit', uid, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS))) {
      return reply(429, { error: 'Too many requests' });
    }

    // יציאה מקבוצה היא זכות של הילד, ולכן אין כאן בדיקת verified: חשבון שהושעה
    // חייב להיות מסוגל לצאת. מה שכן נבדק הוא שהוא באמת חבר בקבוצה הזו.
    const member = (await db.ref('groupMembers/' + groupId + '/' + uid).get()).val();
    if (!member) return reply(404, { error: 'you are not in that group' });

    await db.ref('groupMembers/' + groupId + '/' + uid).remove();
    await db.ref('userGroups/' + uid + '/' + groupId).remove().catch(() => {});

    const g = (await db.ref('groups/' + groupId).get()).val();
    if (!g) return reply(200, { ok: true, left: true, membersCount: 0 });

    // נספר מחדש מהרשימה עצמה — לא ‎-1 על ערך שאולי כבר לא נכון.
    const rest = (await db.ref('groupMembers/' + groupId).get()).val() || {};
    const count = Object.values(rest).filter((m) => m && m.status === 'approved').length;
    const updates = {};
    if (count !== g.membersCount) updates['groups/' + groupId + '/membersCount'] = count;
    const max = Number(g.maxStudents) || 0;
    if (g.status === 'full' && (max === 0 || count < max)) updates['groups/' + groupId + '/status'] = 'open';
    if (Object.keys(updates).length) await db.ref().update(updates);

    return reply(200, { ok: true, left: true, membersCount: count, status: updates['groups/' + groupId + '/status'] || g.status });
  } catch (err) {
    console.error('[group-leave] failed:', err.message);
    return reply(500, { error: 'server error' });
  }
};
