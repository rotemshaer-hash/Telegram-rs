// Drushe — מייל למנהל כששגיאה חדשה קורית אצל משתמש אמיתי.
//
// השורש: האפליקציה *כן* תופסת כל שגיאת JS/Promise שלא נתפסה וכותבת אותה ל-clientErrors
// (index.html, ה-IIFE בראש הקובץ). אבל אף אחד לא מקבל התראה — השגיאות יושבות במסד עד
// שהמנהל פותח את פאנל הניהול וגולל ל"שגיאות אפליקציה". כלומר מסך שנשבר אצל כל המשתמשים
// יכול להישאר שבור יום שלם, והדרך היחידה לדעת היא שמישהו יספר.
//
// למה אין כאן idToken: השגיאה יכולה לקרות בשנייה הראשונה של הטעינה, לפני התחברות ולפני
// שיש currentUser. לכן השער הוא אחר — ושלוש שכבות:
//   1. הרשומה חייבת להתקיים ב-clientErrors. החוקים מתירים יצירה שם רק ל-auth != null,
//      ולכן אי אפשר להפעיל את הפונקציה בלי שנכתבה קודם שגיאה אמיתית בסשן מחובר.
//   2. חלון טריות: רשומה מלפני יותר מ-10 דקות לא מייצרת מייל, כדי שלא יהיה אפשר לשחזר
//      מזהה ישן שוב ושוב.
//   3. תקרה גלובלית קשיחה: גם אם יקרו מאה שגיאות שונות ביום, יוצאים עד MAX_EMAILS_PER_DAY
//      מיילים. מסך שנשבר בלולאה לא יכול להפיל את תיבת הדואר של המנהל.
//
// וגם נטל כפול: אותה שגיאה (אותו message+source+line) שולחת מייל אחד ל-24 שעות
// (errorAlertSent/<חתימה> נתפס בטרנזקציה) — ההמשך נספר בפאנל, לא בתיבת הדואר.

const crypto = require('crypto');
const { admin, initAdmin } = require('../lib/firebase-admin-init');
const ALLOWED_ORIGINS = require('../lib/allowed-origins');
const { withinWindowLimit } = require('../lib/rate-limit');
const { sendViaEmailJS } = require('../lib/emailjs');
const { ADMIN_EMAIL } = require('../lib/admin-email');

const ID_RE = /^[-A-Za-z0-9_]{1,128}$/;
const FRESH_MS = 10 * 60 * 1000;          // רשומה טרייה בלבד
const DEDUPE_MS = 24 * 60 * 60 * 1000;    // מייל אחד לכל שגיאה ייחודית ביום
const MAX_EMAILS_PER_DAY = 10;            // התקרה הקשיחה על תיבת הדואר
const IP_LIMIT_MAX = 20;                  // כמה קריאות מאותו מקור בשעה
const IP_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const SITE_URL = ALLOWED_ORIGINS[0];

const clip = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);

// חתימה נגזרת בשרת מהרשומה עצמה, לא מהמטען: לקוח לא יכול לעקוף את הנטל הכפול
// על ידי שליחת חתימה אחרת בכל פעם.
const signatureOf = (e) => crypto.createHash('sha256')
  .update(clip(e.message, 500) + '|' + clip(e.source, 300) + '|' + (e.lineno == null ? '' : String(e.lineno)))
  .digest('hex').slice(0, 32);

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

  // אין כאן אימות משתמש (ראה ההסבר בראש הקובץ), ולכן המקור כן נבדק.
  if (!ALLOWED_ORIGINS.includes(origin)) return reply(403, { error: 'Forbidden origin' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_e) { return reply(400, { error: 'Invalid JSON' }); }
  const errorId = String(body.errorId || '');
  if (!ID_RE.test(errorId)) return reply(400, { error: 'Invalid request' });

  try {
    initAdmin();
    const db = admin.database();

    const ip = (event.headers['x-nf-client-connection-ip'] || event.headers['client-ip']
      || String(event.headers['x-forwarded-for'] || '').split(',')[0] || 'unknown').trim();
    if (!(await withinWindowLimit(db, 'errorAlertIpLimit', ip, IP_LIMIT_MAX, IP_LIMIT_WINDOW_MS))) {
      return reply(429, { error: 'Too many requests' });
    }

    const err = (await db.ref('clientErrors/' + errorId).get()).val();
    if (!err) return reply(404, { error: 'no such error' });

    const now = Date.now();
    const createdAt = Number(err.createdAt) || 0;
    if (!createdAt || now - createdAt > FRESH_MS) return reply(200, { sent: 0, reason: 'stale' });

    const sig = signatureOf(err);
    const claimed = await db.ref('errorAlertSent/' + sig).transaction((cur) => {
      if (cur && cur.at && now - cur.at < DEDUPE_MS) return undefined; // ביטול — כבר נשלח מייל על זה היום
      return { at: now, errorId };
    });
    if (!claimed.committed) return reply(200, { sent: 0, duplicate: true });

    if (!(await withinWindowLimit(db, 'errorAlertRateLimit', 'global', MAX_EMAILS_PER_DAY, DEDUPE_MS))) {
      // התקרה נגמרה — משחררים את החתימה כדי שהשגיאה הזו תוכל להתריע אחרי שהחלון יתאפס,
      // במקום להישאר מסומנת כ"נשלחה" בלי שמייל יצא בפועל.
      await db.ref('errorAlertSent/' + sig).remove().catch(() => {});
      return reply(200, { sent: 0, reason: 'daily cap' });
    }

    const when = new Date(createdAt).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' });
    const lines = [
      'שגיאה חדשה נרשמה באפליקציה.',
      '',
      'השגיאה: ' + clip(err.message, 500),
      'מסך: ' + (clip(err.lastScreen, 60) || 'לא ידוע'),
      'מתי: ' + when,
      'מקור: ' + (clip(err.source, 300) || 'לא ידוע') + (err.lineno ? ':' + Number(err.lineno) : ''),
      'משתמש: ' + (clip(err.uid, 128) || 'לא מחובר'),
      'דפדפן: ' + clip(err.userAgent, 200),
      '',
      clip(err.stack, 800),
      '',
      'כל השגיאות: ' + SITE_URL + ' ← פאנל ניהול ← שגיאות אפליקציה',
      'מייל אחד לכל שגיאה ייחודית ב-24 שעות, עד ' + MAX_EMAILS_PER_DAY + ' מיילים ביום.',
    ];
    try {
      await sendViaEmailJS(ADMIN_EMAIL, '🐞 שגיאה חדשה ב-Drushe: ' + clip(err.message, 70), lines.join('\n'));
    } catch (mailErr) {
      // מייל שלא יצא לא "בזבז" כלום: החתימה והמכסה היומית משוחררות, כך שהשגיאה הזו תוכל להתריע שוב כשהמייל יתוקן. קודם הן
      // נשארו תפוסות ל-24 שעות — כלומר תקלה ב-EmailJS הייתה גם מעלימה את ההתראה, וגם שורפת את המכסה, בשקט.
      console.error('[error-alert] mail failed:', mailErr.message);
      await db.ref('errorAlertSent/' + sig).remove().catch(() => {});
      await db.ref('errorAlertRateLimit/global').transaction((cur) => (cur && cur.count > 0 ? { start: cur.start, count: cur.count - 1 } : cur)).catch(() => {});
      await db.ref('adminNotifs').push({ type: 'emailFailed', from: 'error-alert', error: clip(mailErr.message, 200), read: false, createdAt: Date.now() }).catch(() => {});
      return reply(502, { error: 'mail_failed' });
    }

    return reply(200, { sent: 1, signature: sig });
  } catch (e) {
    console.error('[error-alert] failed:', e.message);
    return reply(500, { error: 'Failed to send alert' });
  }
};
