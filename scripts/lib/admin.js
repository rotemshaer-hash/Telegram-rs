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
// ייצור כתוב כאן בקוד; staging מגיע ממשתני סביבה. זה לא חוסר עקביות — זה
// הכיוון הבטוח: סקריפט שרץ בלי הסודות של staging **לא מקבל** יעד staging
// ונופל, במקום ליפול בשקט חזרה על הייצור. ההפך היה הופך תרגיל שחזור לאירוע.
const ENVS = {
  production: {
    projectId: PROJECT_ID,
    dbUrl: DB_URL,
    bucket: STORAGE_BUCKET,
    secretVar: 'FIREBASE_SERVICE_ACCOUNT',
  },
  staging: {
    projectId: process.env.STAGING_PROJECT_ID || '',
    dbUrl: process.env.STAGING_DB_URL || '',
    bucket: process.env.STAGING_STORAGE_BUCKET || '',
    secretVar: 'FIREBASE_SERVICE_ACCOUNT_STAGING',
  },
};

function envConfig(name) {
  const cfg = ENVS[name];
  if (!cfg) throw new Error(`סביבה לא מוכרת: ${name}`);
  if (!cfg.projectId || !cfg.dbUrl) {
    throw new Error(
      `הסביבה '${name}' אינה מוגדרת. חסרים STAGING_PROJECT_ID / STAGING_DB_URL. ` +
      'לא נופלים חזרה על הייצור.'
    );
  }
  // הגבול עצמו. אם משתנה סביבה שגוי מכוון את staging אל הייצור, כל סקריפט
  // שכותב ל-staging יכתוב לייצור — וזה בדיוק התרחיש שסביבת בדיקות נועדה
  // למנוע. נבדק כאן, פעם אחת, במקום בכל קורא.
  if (name !== 'production' && (cfg.dbUrl === DB_URL || cfg.projectId === PROJECT_ID)) {
    throw new Error(
      `הסביבה '${name}' מצביעה על פרויקט הייצור (${cfg.projectId}). נעצר.`
    );
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
