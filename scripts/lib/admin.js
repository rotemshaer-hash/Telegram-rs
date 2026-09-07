// אתחול firebase-admin לסקריפטים המתוזמנים — הגדרה אחת.
//
// הסיבה שזה קובץ ולא שש שורות שמועתקות: הסגירה. firebase-admin מחזיק סוקט
// פתוח ל-RTDB, והסוקט מחזיק את לולאת האירועים של Node. סקריפט שלא סוגר אותו
// מסיים את עבודתו, מדפיס Done, ואז **לא יוצא** — ה-job רץ עד תקרת שש השעות
// של הראנר ושורף דקות בשקט. זה קרה כאן בפועל (ראה HANDOFF), ולכן דפוס
// הסגירה נכתב פעם אחת במקום להישען על כך שכל סקריפט חדש יזכור אותו.
'use strict';
const admin = require('firebase-admin');

const PROJECT_ID = 'kidemy-83a17';
const DB_URL = 'https://kidemy-83a17-default-rtdb.firebaseio.com';
// דלי ברירת המחדל של Firebase Storage. ניתן לעקיפה דרך משתנה סביבה למקרה
// שהפרויקט נוצר עם השם הישן (‎<project>.appspot.com) ולא החדש.
const STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET || `${PROJECT_ID}.firebasestorage.app`;

// ─── שתי סביבות, והגבול ביניהן ──────────────────────────────────────────────
//
// staging הוא **מופע RTDB נוסף באותו פרויקט**, ולא פרויקט שני. זו הייתה
// החלטה מודעת: פרויקט שני מחייב את הבעלים לעבור רצף מסכים בקונסולה מהטלפון,
// ליצור חשבון שירות נוסף ולהדביק סוד נוסף — בעוד שמופע נוסף נוצר מה-CLI עם
// ההרשאות שכבר יש. מה שהבודק ביקש staging בשבילו הוא בידוד **נתונים**, וזה
// בדיוק מה שמופע נפרד נותן.
//
// מה שזה לא נותן, ולא מתחזים לכך: בידוד Auth ו-Storage, והגנה מפני אובדן
// הפרויקט. שני אלה דורשים פרויקט שני, וזו החלטה פתוחה.
//
// כתובת ה-staging מגיעה ממשתנה סביבה, ואין לה ברירת מחדל. סקריפט שרץ בלי
// הכתובת **נופל**, במקום ליפול בשקט חזרה על הייצור. ההפך היה הופך תרגיל
// שחזור לאירוע ייצור.
const ENVS = {
  production: {
    projectId: PROJECT_ID,
    dbUrl: DB_URL,
    bucket: STORAGE_BUCKET,
    secretVar: 'FIREBASE_SERVICE_ACCOUNT',
  },
  staging: {
    projectId: PROJECT_ID,
    dbUrl: process.env.STAGING_DB_URL || '',
    // Storage אינו מבודד — הדלי משותף לפרויקט. סריקת יתומים ב-staging
    // מכסה את ה-RTDB בלבד, וזה נאמר במפורש ולא מוסתר מאחורי ערך ברירת מחדל.
    bucket: '',
    secretVar: 'FIREBASE_SERVICE_ACCOUNT',
  },
};

function envConfig(name) {
  const cfg = ENVS[name];
  if (!cfg) throw new Error(`סביבה לא מוכרת: ${name}`);
  if (!cfg.dbUrl) {
    throw new Error(
      `הסביבה '${name}' אינה מוגדרת — חסר STAGING_DB_URL. לא נופלים חזרה על הייצור.`
    );
  }
  // הגבול עצמו, והוא כתובת המסד ולא מזהה הפרויקט: שתי הסביבות חולקות פרויקט
  // בכוונה, ולכן מה שמפריד ביניהן הוא בדיוק המסד שכותבים אליו. משתנה סביבה
  // שגוי שמכוון את staging אל מסד הייצור הופך כל כתיבה של תרגיל לכתיבה
  // אמיתית — וזה התרחיש שסביבת הבדיקות קיימת כדי למנוע.
  if (name !== 'production' && cfg.dbUrl === DB_URL) {
    throw new Error(`הסביבה '${name}' מצביעה על מסד הייצור. נעצר.`);
  }
  return cfg;
}

function requireServiceAccount(varName) {
  const raw = process.env[varName];
  if (!raw) {
    throw new Error(
      `חסר הסוד ${varName}. ` +
      'Settings → Secrets and variables → Actions.'
    );
  }
  try {
    return JSON.parse(raw);
  } catch (_e) {
    throw new Error(`${varName} אינו JSON תקין.`);
  }
}

function openApp(name, appName) {
  const cfg = envConfig(name);
  const app = admin.initializeApp({
    credential: admin.credential.cert(requireServiceAccount(cfg.secretVar)),
    databaseURL: cfg.dbUrl,
    ...(cfg.bucket ? { storageBucket: cfg.bucket } : {}),
  }, appName);
  return {
    app,
    env: name,
    projectId: cfg.projectId,
    dbUrl: cfg.dbUrl,
    db: admin.database(app),
    bucket: cfg.bucket ? admin.storage(app).bucket() : null,
  };
}

// מריץ fn עם אפליקציית admin מאותחלת, וסוגר אותה תמיד — גם כשנזרקת שגיאה.
async function withAdmin(fn, env = 'production') {
  const h = openApp(env, env === 'production' ? undefined : env);
  try {
    return await fn(h);
  } finally {
    await h.app.delete();
  }
}

// שתי סביבות בבת אחת, לתרגיל השחזור: קוראים מהייצור, כותבים ל-staging.
// שתיהן נסגרות תמיד, גם אם אחת מהן נכשלה באתחול.
async function withBothEnvs(fn) {
  const production = openApp('production', 'production');
  let staging = null;
  try {
    staging = openApp('staging', 'staging');
    return await fn({ production, staging });
  } finally {
    if (staging) await staging.app.delete().catch(() => {});
    await production.app.delete().catch(() => {});
  }
}

module.exports = { withAdmin, withBothEnvs, envConfig, PROJECT_ID, DB_URL, STORAGE_BUCKET };
