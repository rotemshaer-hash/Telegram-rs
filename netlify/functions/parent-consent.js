// Drushe — אישור הורה. הפונקציה היחידה שמשחררת חשבון של קטין.
//
// למה זה חייב לרוץ בשרת ולא באפליקציה:
//
// החוק על users/$uid/verified מתיר לכתוב true רק למנהל. זה נכון ולא משתנה —
// אילו הלקוח היה יכול להציב אותו, כל ילד היה משחרר את עצמו והשער כולו היה
// דקורטיבי. אבל המשמעות היא שההורה, שאינו מחובר לאפליקציה ואין לו חשבון בכלל,
// לא יכול לאשר בעצמו. firebase-admin עוקף חוקים ולכן זו הדרך היחידה שבה
// ההסכמה של ההורה יכולה להיות מה שפותח את החשבון בפועל.
//
// מה היה קודם: פרטי ההורה הוקלדו על המכשיר של הילד, באותו מסך, ברצף אחד.
// בדיקת תעודת הזהות הייתה ספרת ביקורת בלבד — כל מספר תקין עובר. הגיל 18+
// הוקלד. שום קישור אישור לא נשלח, וההורה קיבל מייל יידוע בלבד. מה שבאמת פתח
// חשבון היה המנהל שמסמן verified ידנית. כלומר ההורה מעולם לא היה בלולאה, ולא
// היה שום תיעוד שאפשר להציג בדיעבד לשאלה "איך הוכחתם שההורה הסכים".
//
// הטוקן הוא אמצעי הזיהוי היחיד כאן, ולכן הוא 32 בייטים אקראיים מ-crypto —
// לא ניתן לניחוש, לא נגזר מה-uid, ולא ניתן לשחזור מתוך שום דבר שהילד רואה.

const crypto = require('crypto');
const { admin, initAdmin } = require('../lib/firebase-admin-init');
const { sendViaEmailJS } = require('../lib/emailjs');

const TOKEN_RE = /^[a-f0-9]{64}$/;
const PARENT_CONSENT_DAYS = 14;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// תקרה גסה נגד סריקה. ניחוש טוקן של 256 ביט אינו מעשי ממילא, אבל תקרה זולה
// מונעת גם ניסיונות אוטומטיים וגם הצפה של הפונקציה עצמה.
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

// יצירת בקשת הסכמה: עד 5 ניסיונות לשעה לכל uid. מספיק להרשמה שנכשלה וניסיון
// חוזר, נמוך מדי כדי לאפשר הצפת תיבת ההורה במיילים.
const CREATE_RATE_LIMIT_MAX = 5;
const CREATE_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

async function withinRateLimit(db, path, ip, max, windowMs) {
  const key = String(ip || 'unknown').replace(/[.#$/[\]]/g, '_');
  const ref = db.ref(path + '/' + key);
  const now = Date.now();
  const result = await ref.transaction((cur) => {
    if (!cur || now - cur.start > windowMs) return { start: now, count: 1 };
    if (cur.count >= max) return; // ביטול העסקה — חריגה
    return { start: cur.start, count: cur.count + 1 };
  });
  return result.committed;
}

exports.handler = async (event) => {
  // רשימת מקורות מותרים. ההורה מגיע מהאתר, אבל הזרימה נקראת גם מתוך
  // האפליקציה הארוזה — ושם המקור אינו הדומיין שלנו אלא capacitor://localhost
  // (iOS) או http://localhost (אנדרואיד). בלי שהם ברשימה, הדפדפן היה חוסם את
  // הקריאה עוד לפני שהיא יוצאת, וזה היה נראה כאילו האישור פשוט לא עובד.
  //
  // הרשימה סגורה בכוונה ולא '*': הפונקציה הזו משחררת חשבונות של קטינים.
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

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (_e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { token, action } = body;
  if (action !== 'info' && action !== 'approve' && action !== 'create') {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid action' }) };
  }
  if (action !== 'create' && !TOKEN_RE.test(String(token || ''))) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid token' }) };
  }

  const ip = event.headers['x-nf-client-connection-ip'] || event.headers['client-ip'];

  // ── create ───────────────────────────────────────────────────────────────
  // חייב לרוץ כאן ולא בלקוח: אם הילד יוצר את הטוקן בעצמו, הוא יודע אותו —
  // וזה בדיוק מה שהופך את "אישור ההורה" להוכחת החזקה של הילד, לא פעולה של
  // ההורה. השרת מייצר את הטוקן, כותב אותו ישירות ל-DB עם ה-admin SDK (שעוקף
  // חוקים), ושולח אותו לתיבת ההורה מהשרת — הלקוח לעולם לא רואה אותו.
  if (action === 'create') {
    if (!body.idToken) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'idToken is required' }) };
    }
    let uid;
    try {
      initAdmin();
      uid = (await admin.auth().verifyIdToken(body.idToken)).uid;
    } catch {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'invalid or expired session' }) };
    }
    const parentEmail = String(body.parentEmail || '').trim();
    const studentName = String(body.studentName || '').trim().slice(0, 100);
    if (!EMAIL_RE.test(parentEmail)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'invalid parentEmail' }) };
    }

    try {
      const db = admin.database();
      if (!(await withinRateLimit(db, 'parentConsentCreateRateLimit', uid, CREATE_RATE_LIMIT_MAX, CREATE_RATE_LIMIT_WINDOW_MS))) {
        return { statusCode: 429, headers, body: JSON.stringify({ error: 'Too many requests' }) };
      }

      const newToken = crypto.randomBytes(32).toString('hex');
      await db.ref('parentConsent/' + newToken).set({
        uid,
        studentName,
        parentEmail,
        status: 'pending',
        createdAt: Date.now(),
        expiresAt: Date.now() + PARENT_CONSENT_DAYS * 24 * 3600 * 1000,
      });

      const link = ALLOWED_ORIGINS[0] + '/?consent=' + newToken;
      try {
        await sendViaEmailJS(
          parentEmail,
          'נדרש אישורך — ' + (studentName || 'ילדך') + ' נרשם/ה ל-Drushe',
          `שלום,\n\n` +
          `${studentName || 'ילדכם'} נרשם/ה ל-Drushe — פלטפורמה שבה בני נוער מלמדים ילדים, בפיקוח הורים.\n\n` +
          `**החשבון לא פעיל, ולא יופעל בלי אישורכם.** ללא אישורכם, ${studentName || 'ילדכם'} לא יוכל/תוכל ליצור קשר עם אף אחד באפליקציה.\n\n` +
          `לאישור, היכנסו לקישור:\n${link}\n\n` +
          `לאחר אישורכם, גם צוות Drushe עובר על כל הרשמה לפני שהחשבון נפתח.\n\n` +
          `הקישור אישי ותקף ל-${PARENT_CONSENT_DAYS} ימים.\n\n` +
          `אם לא אתם ההורה, או שאינכם מאשרים — פשוט התעלמו מהמייל. החשבון יישאר חסום.\n\n` +
          `– צוות Drushe`
        );
      } catch (mailErr) {
        console.error('[parent-consent] create email failed:', mailErr.message);
        await db.ref('adminNotifs').push({
          type: 'registrationFailed',
          from: studentName || uid,
          error: 'parentConsent email: ' + String(mailErr.message).slice(0, 200),
          read: false,
          createdAt: Date.now(),
        });
      }

      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    } catch (err) {
      console.error('[parent-consent] create', err);
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'server_error' }) };
    }
  }

  try {
    initAdmin();
    const db = admin.database();

    if (!(await withinRateLimit(db, 'consentRateLimit', ip, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS))) {
      return { statusCode: 429, headers, body: JSON.stringify({ error: 'Too many requests' }) };
    }

    const ref = db.ref('parentConsent/' + token);
    const snap = await ref.get();
    if (!snap.exists()) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'not_found' }) };
    }
    const rec = snap.val();

    if (Date.now() > (rec.expiresAt || 0)) {
      return { statusCode: 410, headers, body: JSON.stringify({ error: 'expired' }) };
    }

    // 'info' מחזיר רק את מה שההורה כבר יודע — שם הילד — כדי שיוכל לוודא שהוא
    // מאשר את הילד הנכון. שום פרט נוסף לא נחשף דרך הטוקן.
    if (action === 'info') {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          studentName: rec.studentName || '',
          status: rec.status || 'pending',
        }),
      };
    }

    // ── approve ──────────────────────────────────────────────────────────────
    // חד-פעמי, דרך טרנזקציה: שתי לחיצות במקביל לא יכולות לאשר פעמיים, ולחיצה
    // חוזרת על קישור שכבר נוצל מקבלת תשובה ברורה במקום לאשר בשקט שוב.
    const claim = await ref.child('status').transaction((cur) =>
      cur === 'approved' ? undefined : 'approved'
    );
    if (!claim.committed) {
      return { statusCode: 409, headers, body: JSON.stringify({ error: 'already_approved' }) };
    }

    const uid = rec.uid;
    if (!uid) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'malformed_record' }) };
    }

    // ההסכמה **לא** מפעילה את החשבון. זו החלטה מכוונת של בעל האפליקציה: הוא
    // רוצה לראות כל תלמיד לפני שהוא נכנס, ואישור אוטומטי היה מוציא אותו
    // מהתמונה. לכן ההורה פותח את השער ובעל האפליקציה עובר בו.
    //
    // מה שנפתר כאן הוא בכל זאת הפער האמיתי: קודם ההורה לא היה בלולאה בכלל
    // ולא היה שום תיעוד. עכשיו ההסכמה היא פעולה אקטיבית של מי שמחזיק בתיבת
    // המייל, היא מתועדת, והיא תנאי מוקדם לאישור — approveStudent מזהיר כשהיא
    // חסרה. שתי הדרישות מתקיימות: ההורה בלולאה, והשליטה נשארת אצל המנהל.

    // תיעוד ההסכמה. זה מה שאפשר יהיה להציג אם יישאלו איך הוכחנו שההורה הסכים,
    // ולכן הוא נשמר בנפרד מהטוקן ולא נמחק איתו.
    const evidence = {
      uid,
      studentName: rec.studentName || '',
      parentEmail: rec.parentEmail || '',
      approvedAt: admin.database.ServerValue.TIMESTAMP,
      ip: ip || null,
      userAgent: String(event.headers['user-agent'] || '').slice(0, 300),
    };
    await db.ref('parentConsentLog/' + uid).push(evidence);
    await ref.update({ approvedAt: admin.database.ServerValue.TIMESTAMP });

    // דגל על רשומת המשתמש — כדי שפאנל הניהול יוכל להראות "הורה אישר" בלי
    // לקרוא את parentConsentLog, ו-approveStudent יוכל לבדוק אותו לפני אישור.
    await db.ref('users/' + uid + '/parentConsentAt').set(admin.database.ServerValue.TIMESTAMP);

    // ההתראה היא למנהל — הוא זה שצריך לפעול עכשיו. הילד לא מקבל "אושרת",
    // כי הוא עוד לא אושר.
    await db.ref('adminNotifs').push({
      type: 'parentApproved',
      from: rec.studentName || uid,
      uid,
      read: false,
      createdAt: Date.now(),
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, studentName: rec.studentName || '' }),
    };
  } catch (err) {
    console.error('[parent-consent]', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'server_error' }) };
  }
};
