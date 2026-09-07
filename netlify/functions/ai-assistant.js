// Drushe AI Assistant — serverless proxy to the Claude API.
//
// Runs on Netlify Functions so the Anthropic API key never reaches the
// browser. Requires an ANTHROPIC_API_KEY environment variable set in the
// Netlify site's Build & deploy → Environment settings.
//
// Two grounded modes, both designed to avoid hallucination:
//   "search" — turns a free-text query into structured filters (category,
//              city, max price). The client matches those filters against
//              the REAL teacher list itself; Claude never invents a teacher.
//   "ask"    — answers a safety/policy question using ONLY the platform's
//              own safety-page copy as context, so answers can't drift from
//              what Drushe actually promises parents.
//
// למה יש כאן אימות בכלל: עד עכשיו הפונקציה קיבלה כל בקשת POST, מכל מקור
// באינטרנט — Access-Control-Allow-Origin:'*' ובלי לבדוק מי שולח. מפתח
// ה-Anthropic מוגן מהדפדפן, אבל לא מבוט שמריץ POST ישירות ל-URL של
// הפונקציה, שחשוף מהרגע שהאתר עולה ולא רק אחרי שיש משתמשים אמיתיים. אותו
// שיקול בדיוק כמו ב-send-push.js: השרת לא סומך על מי שהלקוח *טוען* שהוא,
// אלא מאמת טוקן Firebase אמיתי ומגביל קצב לפי ה-uid שהטוקן הזה מוכיח.
// כניסת אורח (signInAnonymously) עדיין נותנת טוקן תקין ועדיין נספרת בהגבלה
// — מותר לאורח להשתמש, אסור לבוט בלי שום חשבון.
const { admin, initAdmin } = require('../lib/firebase-admin-init');

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
const ANTHROPIC_VERSION = '2023-06-01';

// ── תקרות ──────────────────────────────────────────────────────────────────
//
// למה הגבלה לפי uid לבדה לא מספיקה, וזה מה שביקורת חיצונית העירה בצדק:
// האפליקציה מפעילה signInAnonymously כדי לאפשר גלישת אורח, ולכן uid הוא
// משאב חינמי ואינסופי. מי שרוצה להציף פשוט מייצר עוד חשבון אנונימי ומקבל
// דלי נקי. הגבלה לפי uid בעולם כזה היא מהמורה, לא תקרה — והתקרה האפקטיבית
// על חשבון ה-API הייתה, בפועל, אין.
//
// שלוש שכבות, מהזולה לרחבה:
//   uid    — מרסן משתמש בודד שנתקע בלולאה.
//   IP     — מרסן ייצור חשבונות אנונימיים בסדרה, שזה מה שעוקף את הראשונה.
//   גלובלי — התקרה האמיתית על העלות היומית. זו זו שאי אפשר לעקוף בכלל.
// ומעליהן kill switch ידני, כי כשמשהו משתבש צריך לעצור *עכשיו* ולא לחכות
// לחצות.
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

const IP_RATE_LIMIT_MAX = 60;
const IP_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

// תקרה יומית לכל האפליקציה. ברירת מחדל שמרנית — נדיבה מאוד לשימוש אמיתי
// בהיקף הנוכחי (13 בודקים), ונמוכה מספיק שהצפה תיעצר לפני שהיא עולה כסף
// אמיתי. ניתן לכוונון ב-adminConfig/aiDailyMax בלי פריסה.
const GLOBAL_DAILY_MAX = 1500;
// מתי להתריע למנהל שהיום הולך ונגמר — פעם אחת ביום, לא בכל בקשה.
const GLOBAL_ALERT_AT = 0.8;

function todayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD, UTC
}

// חלון מתגלגל לפי מפתח (uid או IP). מחזיר true אם הבקשה בתוך התקרה.
async function withinWindowLimit(db, path, key, max, windowMs) {
  const safeKey = String(key || 'unknown').replace(/[.#$/[\]]/g, '_');
  const ref = db.ref(path + '/' + safeKey);
  const now = Date.now();
  const result = await ref.transaction((cur) => {
    if (!cur || now - (cur.windowStart || 0) > windowMs) {
      return { windowStart: now, count: 1 };
    }
    return { windowStart: cur.windowStart, count: (cur.count || 0) + 1 };
  });
  return (result.snapshot.val()?.count || 0) <= max;
}

// מונה יומי גלובלי. מחזיר {ok, count, max} — ok=false כשהיום נגמר.
async function withinGlobalDailyLimit(db, max) {
  const ref = db.ref('aiUsage/' + todayKey());
  const result = await ref.transaction((cur) => ({
    count: ((cur && cur.count) || 0) + 1,
    updatedAt: Date.now(),
  }));
  const count = result.snapshot.val()?.count || 0;
  return { ok: count <= max, count, max };
}

// התראה חד-פעמית ביום כשעוברים את הסף. הדגל נכתב באותה טרנזקציה שקובעת
// מי הראשון שעבר, כדי ששתי בקשות במקביל לא ייצרו שתי התראות.
async function alertAdminOnce(db, count, max) {
  const flagRef = db.ref('aiUsage/' + todayKey() + '/alerted');
  const claim = await flagRef.transaction((cur) => (cur ? undefined : true));
  if (!claim.committed) return;
  await db.ref('adminNotifs').push({
    type: 'aiBudgetAlert',
    from: 'מערכת',
    count,
    max,
    read: false,
    createdAt: Date.now(),
  });
}

const CATEGORY_IDS = [
  'math','english','hebrew','guitar','art','dance','football','chess','coding',
  'cooking','barber','nails','makeup','freelance','photo','design','history',
  'science','tutoring','singing','swimming','robotics','babysit','arabic'
];

const SAFETY_CONTEXT = `
תהליך ההרשמה: כל ילד (מורה או תלמיד) חייב לספק שם, מייל וטלפון של הורה — בלי הורה אין הרשמה.
ההורה מקבל הודעה אוטומטית על ההרשמה ויכול לאשר או לדחות אותה.
כל מורה עובר בדיקה ידנית של צוות Drushe (כולל אימות גיל וזהות) לפני שהוא מופיע לתלמידים.
השיעור הראשון הוא תמיד "שיעור ניסיון" קצר, ושני הצדדים יכולים לעצור בכל שלב.
הורים מקבלים דוח שבועי אוטומטי במייל, יכולים לצפות בכל הצ'אטים של הילד/ה (דרך פרטי ההתחברות של הילד/ה),
ומקבלים עדכון על כל תשלום.
שיעורים מתקיימים אונליין (Zoom / Google Meet / Teams) דרך קישור אישי שהמורה קובע.
חשוב ולא להתחמק ממנו אם שואלים: Drushe **אינה** צופה בשיעור עצמו ואינה מקליטה אותו — הוא מתקיים
בפלטפורמה חיצונית. מה ש-Drushe כן רואה ושומרת: הצ'אטים, ההזמנות והדיווחים. לכן ההורה מקבל מייל עם
קישור ההצטרפות ויכול להיכנס לשיעור בעצמו, ומומלץ שיהיה נוכח בשיעור ראשון עם מורה או תלמיד/ה חדש/ה
וישקול להקליט אותו.
אחרי כל שיעור שני הצדדים מדרגים אחד את השני.
אפשר לדווח על כל תוכן או משתמש בלחיצת כפתור. יעד הטיפול נקבע לפי חומרת הדיווח: סכנת בטיחות או זיהוי שיתוף פרטי קשר — שעתיים; הטרדה/בריונות או תוכן בלתי הולם — 12 שעות; פרופיל מזויף או סיבה אחרת — 48 שעות; ספאם — 7 ימים. כל דיווח מתועד: מי טיפל, מתי, ומה הוחלט.
Drushe לא גובה עמלה — המורים משלמים מנוי, התלמידים לומדים בחינם מצד האפליקציה (משלמים למורה ישירות).
לשאלות שאין להן תשובה בהקשר הזה, יש להפנות ל-WhatsApp של הצוות ולא לנחש.
`.trim();

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'method not allowed' }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'AI not configured yet — missing ANTHROPIC_API_KEY' }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'invalid JSON body' }) };
  }

  const mode = payload.mode;
  const message = (payload.message || '').toString().slice(0, 600).trim();
  if (!message) return { statusCode: 400, headers, body: JSON.stringify({ error: 'missing message' }) };
  if (mode !== 'search' && mode !== 'ask') {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'mode must be "search" or "ask"' }) };
  }

  if (!payload.idToken) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'idToken is required' }) };
  }
  let uid;
  try {
    initAdmin();
    uid = (await admin.auth().verifyIdToken(payload.idToken)).uid;
  } catch {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'invalid or expired session' }) };
  }
  const db = admin.database();

  // 1. kill switch — נקרא ראשון, כי כשהוא כבוי אסור אפילו לצרוך מהמונים.
  //    ברירת המחדל היא "פועל": רק false מפורש מכבה, כדי שצומת חסר לא ישבית
  //    את הפיצ'ר בשקט.
  let cfg = {};
  try {
    cfg = (await db.ref('adminConfig').get()).val() || {};
  } catch (_e) { /* קריאה שנכשלה לא תשבית — הכיבוי חייב להיות מכוון */ }
  if (cfg.aiEnabled === false) {
    return { statusCode: 503, headers, body: JSON.stringify({ error: 'העוזר החכם מושבת זמנית. נסו שוב מאוחר יותר.' }) };
  }

  // 2. משתמש בודד.
  if (!(await withinWindowLimit(db, 'aiRateLimit', uid, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS))) {
    return { statusCode: 429, headers, body: JSON.stringify({ error: 'too many requests — try again later' }) };
  }

  // 3. IP — זה מה שחוסם ייצור חשבונות אנונימיים בסדרה כדי לעקוף את (2).
  const ip = event.headers['x-nf-client-connection-ip'] || event.headers['client-ip'];
  if (!(await withinWindowLimit(db, 'aiIpRateLimit', ip, IP_RATE_LIMIT_MAX, IP_RATE_LIMIT_WINDOW_MS))) {
    return { statusCode: 429, headers, body: JSON.stringify({ error: 'too many requests — try again later' }) };
  }

  // 4. התקרה שאי אפשר לעקוף: סך הבקשות ביום, לכל האפליקציה.
  const dailyMax = Number.isFinite(cfg.aiDailyMax) && cfg.aiDailyMax > 0 ? cfg.aiDailyMax : GLOBAL_DAILY_MAX;
  const daily = await withinGlobalDailyLimit(db, dailyMax);
  if (daily.count >= Math.floor(dailyMax * GLOBAL_ALERT_AT)) {
    alertAdminOnce(db, daily.count, dailyMax).catch(() => {});
  }
  if (!daily.ok) {
    return { statusCode: 429, headers, body: JSON.stringify({ error: 'העוזר החכם הגיע למכסה היומית. נסו שוב מחר.' }) };
  }

  let system, maxTokens;
  if (mode === 'search') {
    maxTokens = 300;
    system = `אתה מפרש כוונת חיפוש למורים באפליקציית Drushe, פלטפורמה שבה בני נוער מלמדים ילדים אחרים.
קטגוריות אפשריות (id בלבד): ${CATEGORY_IDS.join(', ')}.
קרא את הבקשה של המשתמש והחזר אך ורק JSON תקני בפורמט הזה, בלי טקסט נוסף לפניו או אחריו:
{"categories": ["id1","id2"], "city": "שם עיר או null", "maxPrice": מספר או null, "reasoning": "משפט קצר בעברית שמסביר איך הבנת את הבקשה"}
- categories: 0-3 מזהי קטגוריה מהרשימה בלבד שהכי מתאימים לבקשה. אם אין התאמה ברורה, מערך ריק.
- אל תמציא קטגוריות שאינן ברשימה. אל תמציא מורים — אתה לא ניגש למאגר המורים בפועל.`;
  } else {
    maxTokens = 1024;
    system = `אתה עוזר ה-AI של Drushe, פלטפורמת שיעורים פרטיים שבה בני נוער מלמדים ילדים אחרים, בפיקוח הורים מלא.
ענה על שאלות של הורים/תלמידים/מורים בעברית, בקצרה וברורות, אך ורק על סמך המידע הבא — אל תמציא מדיניות שלא מופיעה כאן:
---
${SAFETY_CONTEXT}
---
אם השאלה לא נענית מהמידע הזה, אמור זאת בכנות והפנה ליצירת קשר עם צוות Drushe דרך WhatsApp באפליקציה. אל תנחש.`;
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: message }],
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      return { statusCode: res.status, headers, body: JSON.stringify({ error: data?.error?.message || 'Claude API error' }) };
    }

    const text = (data.content || []).map((b) => b.text || '').join('');

    if (mode === 'search') {
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        return { statusCode: 502, headers, body: JSON.stringify({ error: 'could not parse AI response' }) };
      }
      const categories = Array.isArray(parsed.categories) ? parsed.categories.filter((c) => CATEGORY_IDS.includes(c)) : [];
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          categories,
          city: typeof parsed.city === 'string' ? parsed.city : null,
          maxPrice: typeof parsed.maxPrice === 'number' ? parsed.maxPrice : null,
          reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
        }),
      };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ answer: text }) };
  } catch (e) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: e.message || 'network error calling Claude' }) };
  }
};
