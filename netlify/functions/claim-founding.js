// Drushe — מעמד "מורה מייסד" (500 הראשונים פטורים ממנוי לצמיתות), נקבע בשרת בלבד.
//
// עד עכשיו הלקוח כתב users/<uid>/foundingMember בעצמו, והחוק רק דרש שהשדה עוד לא קיים — כלומר כל משתמש
// (גם תלמיד) יכול היה להעניק לעצמו מעמד מייסד לפני שהמנהל ראה אותו. עכשיו החוק מתיר את הכתיבה למנהל בלבד
// (admin SDK עוקף חוקים), והשרת הוא מי שסופר את המורים ומחליט.
//
// הספירה כוללת גם מורים שטרם אושרו (כמו קודם), כדי ששני אנשים שנרשמו באותו יום לא יקבלו תשובה שונה
// רק בגלל שהמנהל הספיק לאשר אחד מהם.

const { admin, initAdmin } = require('../lib/firebase-admin-init');
const ALLOWED_ORIGINS = require('../lib/allowed-origins');
const { withinWindowLimit } = require('../lib/rate-limit');

const FOUNDING_TEACHER_LIMIT = 500; // אותו ערך כמו FOUNDING_TEACHER_LIMIT ב-index.html (בדיקה ב-tests/functions)
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

exports.FOUNDING_TEACHER_LIMIT = FOUNDING_TEACHER_LIMIT;

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
    uid = (await admin.auth().verifyIdToken(body.idToken)).uid;
  } catch (_e) {
    return reply(401, { error: 'invalid or expired session' });
  }

  try {
    const db = admin.database();
    if (!(await withinWindowLimit(db, 'foundingClaimRateLimit', uid, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS))) {
      return reply(429, { error: 'Too many requests' });
    }
    // רק מי שיש לו פרופיל מורה אמיתי (נשמר זה עתה) ורשום כמורה
    const [profile, role, roleLock, already] = await Promise.all([
      db.ref('teachers/' + uid).get(),
      db.ref('users/' + uid + '/role').get(),
      db.ref('userRoles/' + uid).get(),
      db.ref('users/' + uid + '/foundingMember').get(),
    ]);
    if (!profile.exists() || (role.val() !== 'teacher' && roleLock.val() !== 'teacher')) {
      return reply(403, { error: 'not a teacher' });
    }
    if (already.exists()) return reply(200, { founding: already.val() === true, unchanged: true });

    const all = await db.ref('teachers').get();
    let count = 0;
    if (all.exists()) all.forEach(() => { count++; });
    if (count > FOUNDING_TEACHER_LIMIT) return reply(200, { founding: false });
    await db.ref('users/' + uid + '/foundingMember').set(true);
    return reply(200, { founding: true });
  } catch (e) {
    console.error('[claim-founding] failed:', e);
    return reply(500, { error: 'Failed' });
  }
};
