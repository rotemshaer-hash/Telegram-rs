// Drushe — איפוס סיסמה לחשבונות שם-משתמש.
//
// למה זה קיים: כל ההרשמות באפליקציה — תלמידים ומורים כאחד — יוצרות חשבון
// Firebase עם כתובת מומצאת, ‎<username>@kidemy.app. אין תיבת דואר בדומיין
// הזה ואף אחד לא מקבל שם דבר.
//
// המשמעות היא ש-auth.sendPasswordResetEmail על החשבון הזה *מצליח* — החשבון
// באמת קיים — ולכן האפליקציה הודיעה "נשלח קישור לאיפוס למייל שלך", בזמן
// שהמייל נשלח לשומקום. משתמש שאיבד סיסמה נשאר בחוץ בלי שום סימן לתקלה.
//
// התיבה האמיתית היחידה שידועה לנו היא של ההורה (parentEmail). אבל הצומת
// users קריא לבעלים בלבד — וזה נכון, יש שם פרטי קטינים — ולכן משתמש מנותק
// אינו יכול לאתר אותה מהלקוח. firebase-admin עוקף חוקים, ולכן זו הדרך
// היחידה שבה האיפוס יכול להגיע ליעד.
//
// עיקרון אבטחה: קישור האיפוס **לעולם אינו מוחזר לקורא**. הוא נשלח ישירות
// לתיבת ההורה. אחרת כל אחד היה מבקש איפוס לשם משתמש כלשהו ומקבל לידיו
// מפתח לחשבון.

const { admin, initAdmin } = require('../lib/firebase-admin-init');
const { sendViaEmailJS } = require('../lib/emailjs');

const FAKE_DOMAIN = '@kidemy.app';
const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;


async function withinRateLimit(db, ip) {
  const key = String(ip || 'unknown').replace(/[.#$/[\]]/g, '_');
  const ref = db.ref('resetRateLimit/' + key);
  const now = Date.now();
  const result = await ref.transaction((cur) => {
    if (!cur || now - cur.start > RATE_LIMIT_WINDOW_MS) return { start: now, count: 1 };
    if (cur.count >= RATE_LIMIT_MAX) return;
    return { start: cur.start, count: cur.count + 1 };
  });
  return result.committed;
}

exports.handler = async (event) => {
  const ALLOWED_ORIGINS = [
    'https://kidemy-app.netlify.app',
    'capacitor://localhost',
    'http://localhost',
  ];
  const origin = event.headers.origin || event.headers.Origin || '';
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let username;
  try {
    username = String(JSON.parse(event.body || '{}').username || '').trim().toLowerCase();
  } catch (_e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }
  username = username.replace(new RegExp(FAKE_DOMAIN.replace('.', '\\.') + '$'), '');
  if (!USERNAME_RE.test(username)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'invalid_username' }) };
  }

  // תשובה אחידה בכל מקרה. אחרת אפשר היה לברר אילו שמות משתמש קיימים על ידי
  // השוואת תשובות — וזו רשימה של קטינים.
  const generic = {
    statusCode: 200,
    headers,
    body: JSON.stringify({ ok: true, message: 'אם החשבון קיים, נשלח קישור לאיפוס למייל ההורה הרשום.' }),
  };

  try {
    initAdmin();
    const db = admin.database();

    const ip = event.headers['x-nf-client-connection-ip'] || event.headers['client-ip'];
    if (!(await withinRateLimit(db, ip))) {
      return { statusCode: 429, headers, body: JSON.stringify({ error: 'too_many_requests' }) };
    }

    const fakeEmail = username + FAKE_DOMAIN;
    const snap = await db.ref('users').orderByChild('email').equalTo(fakeEmail).get();
    if (!snap.exists()) return generic;

    let rec = null;
    snap.forEach((c) => { rec = c.val(); });
    const parentEmail = (rec && rec.parentEmail) || '';
    const name = (rec && rec.name) || 'המשתמש';

    if (!parentEmail || parentEmail.endsWith(FAKE_DOMAIN)) {
      // אין תיבה אמיתית לשלוח אליה. במקום להצהיר הצלחה כוזבת, מדווחים למנהל
      // כדי שיוכל לאפס ידנית — זו בדיוק הנפילה השקטה שהבאג הזה נוצר ממנה.
      await db.ref('adminNotifs').push({
        type: 'passwordResetNeedsHelp',
        from: name,
        username,
        read: false,
        createdAt: Date.now(),
      });
      return generic;
    }

    const link = await admin.auth().generatePasswordResetLink(fakeEmail);

    try {
      await sendViaEmailJS(
        parentEmail,
        'איפוס סיסמה ל-Drushe — ' + name,
        `שלום,\n\n` +
        `התקבלה בקשה לאיפוס סיסמה לחשבון "${username}" ב-Drushe.\n\n` +
        `החשבון רשום עם שם משתמש ולא עם כתובת מייל, ולכן הקישור נשלח אליכם — ההורה/אפוטרופוס הרשום.\n\n` +
        `לאיפוס הסיסמה:\n${link}\n\n` +
        `אם לא ביקשתם זאת, אפשר להתעלם מהמייל. הסיסמה לא תשתנה.\n\n` +
        `– צוות Drushe`
      );
    } catch (mailErr) {
      console.error('[password-reset] email failed:', mailErr.message);
      await db.ref('adminNotifs').push({
        type: 'passwordResetNeedsHelp',
        from: name,
        username,
        error: String(mailErr.message).slice(0, 200),
        read: false,
        createdAt: Date.now(),
      });
    }

    return generic;
  } catch (err) {
    console.error('[password-reset]', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'server_error' }) };
  }
};
