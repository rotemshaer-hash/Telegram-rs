// פריסת חוקי Storage דרך ה-API, בלי ה-CLI.
//
// ── למה זה קיים ──
//
// `firebase deploy --only storage` נכשל כאן חודשים ב-403. אחרי שנבדק סוף סוף
// **מה** חסר — testIamPermissions, ולא ניחוש — התמונה הפכה מדויקת:
//
//   firebaserules.releases.update   ✅ יש
//   firebaserules.rulesets.create   ✅ יש
//   firebaserules.rulesets.test     ❌ אין
//
// ‏`rulesets.test` הוא **בדיקת התחביר המקדימה** שה-CLI מריץ לפני הפריסה. הוא
// אינו נדרש כדי לפרוס. כלומר לחשבון יש בדיוק את שתי ההרשאות שצריך כדי לבצע
// את הפעולה, והוא נחסם על ידי צעד אימות שהוא עצמו אינו רשאי להריץ.
//
// ── האם ויתרנו על אימות ──
//
// לא. הבדיקה עברה מקום: `tests/rules/storage.rules.test.js` מריץ 34 טסטים
// מול אמולטור Storage אמיתי, והם רצים ב-CI **לפני** הפריסה. זו בדיקה חזקה
// בהרבה מבדיקת קומפילציה — היא בודקת התנהגות, לא תחביר. מה שאבד הוא
// אימות תחביר שאין בו צורך כשהקובץ כבר הורץ מול אמולטור.
//
// ── סדר הפעולות, ולמה הוא בטוח ──
//
//   1. קוראים את ה-release הנוכחי ומדפיסים איזה ruleset חי כרגע.
//   2. יוצרים ruleset חדש מהקובץ שבריפו. יצירה לבדה **אינה משנה כלום** —
//      הוא רק נשמר.
//   3. מעדכנים את ה-release להצביע עליו. זה הרגע היחיד שמשנה מצב.
//
// כלומר גם אם שלב 2 נכשל, החוקים החיים נשארים כפי שהיו.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const admin = require('firebase-admin');

const PROJECT_ID = 'kidemy-83a17';
const BUCKET = process.env.FIREBASE_STORAGE_BUCKET || `${PROJECT_ID}.firebasestorage.app`;
const API = 'https://firebaserules.googleapis.com/v1';
// שם ה-release של Storage הוא לפי הדלי, לא לפי הפרויקט — לכל דלי חוקים
// משלו. שגיאה כאן הייתה מפרסמת את החוקים לדלי הלא נכון.
const RELEASE = `projects/${PROJECT_ID}/releases/firebase.storage/${BUCKET}`;
const RULES_FILE = path.join(__dirname, '..', 'storage.rules');

function serviceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('חסר הסוד FIREBASE_SERVICE_ACCOUNT.');
  try {
    return JSON.parse(raw);
  } catch (_e) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT אינו JSON תקין.');
  }
}

async function token(app) {
  const t = await app.options.credential.getAccessToken();
  return t.access_token;
}

async function call(accessToken, method, url, body) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${url.replace(API, '')} → ${res.status}: ${text.slice(0, 400)}`);
  }
  return text ? JSON.parse(text) : {};
}

async function main() {
  const app = admin.initializeApp({ credential: admin.credential.cert(serviceAccount()) });
  try {
    const accessToken = await token(app);
    const source = fs.readFileSync(RULES_FILE, 'utf8');
    if (!source.includes('service firebase.storage')) {
      throw new Error('storage.rules אינו נראה כמו קובץ חוקי Storage. נעצר.');
    }

    // 1. מה חי עכשיו. גם אימות שההרשאה לקריאה קיימת, וגם רישום למה שהוחלף.
    let before = null;
    try {
      before = await call(accessToken, 'GET', `${API}/${RELEASE}`);
      console.log(`📖 ruleset חי כרגע: ${before.rulesetName}`);
    } catch (e) {
      console.log(`📖 לא ניתן לקרוא את ה-release הנוכחי (${e.message.slice(0, 80)})`);
    }

    // השוואת **תוכן**, לא מזהה. ruleset חדש מקבל מזהה חדש גם כשהתוכן זהה,
    // ולכן השוואת מזהים לעולם לא הייתה חוסכת כלום — כל ריצה הייתה יוצרת
    // ruleset נוסף ומחליפה את ה-release בלי סיבה.
    if (before?.rulesetName) {
      try {
        const live = await call(accessToken, 'GET', `${API}/${before.rulesetName}`);
        const liveSource = (live.source?.files || []).map((f) => f.content).join('');
        if (liveSource.trim() === source.trim()) {
          console.log('✅ החוקים החיים כבר זהים לקובץ שבריפו. אין מה לפרוס.');
          return;
        }
        console.log('↻ החוקים החיים שונים מהקובץ שבריפו — פורס.');
      } catch (e) {
        console.log(`(לא ניתן להשוות תוכן: ${e.message.slice(0, 80)})`);
      }
    }

    // 2. יצירה בלבד — לא משנה את המצב החי.
    const ruleset = await call(accessToken, 'POST', `${API}/projects/${PROJECT_ID}/rulesets`, {
      source: { files: [{ name: 'storage.rules', content: source }] },
    });
    console.log(`📦 נוצר ruleset: ${ruleset.name}`);

    // 3. הרגע היחיד שמשנה מצב.
    //
    // ה-release עטוף בשדה `release` ו-updateMask יושב בגוף הבקשה — זה מה
    // ש-UpdateReleaseRequest מגדיר. הניסיון הראשון שלח את השדות ישירות
    // וקיבל 400 "Unknown name rulesetName". שים לב שזו הייתה 400 ולא 403:
    // ההרשאות היו תקינות, הצורה לא.
    await call(accessToken, 'PATCH', `${API}/${RELEASE}`, {
      release: { name: RELEASE, rulesetName: ruleset.name },
      updateMask: 'rulesetName',
    });
    console.log(`✅ ${BUCKET} מצביע עכשיו על ${ruleset.name}`);

    // אימות בקריאה חוזרת. פריסה שדיווחה הצלחה ולא נתפסה היא בדיוק הדפוס
    // שחזר כאן שוב ושוב, ובקובץ שמגן על תעודות זהות של קטינים.
    const after = await call(accessToken, 'GET', `${API}/${RELEASE}`);
    if (after.rulesetName !== ruleset.name) {
      throw new Error(`אחרי העדכון ה-release מצביע על ${after.rulesetName} ולא על ${ruleset.name}.`);
    }
    console.log('✔ אומת בקריאה חוזרת.');
  } finally {
    await app.delete();
  }
}

main().catch((e) => {
  console.error('❌ פריסת חוקי ה-Storage נכשלה:', e.message);
  process.exitCode = 1;
});
