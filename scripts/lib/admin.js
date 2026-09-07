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

function requireServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    throw new Error(
      'חסר הסוד FIREBASE_SERVICE_ACCOUNT. ' +
      'Settings → Secrets and variables → Actions.'
    );
  }
  try {
    return JSON.parse(raw);
  } catch (_e) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT אינו JSON תקין.');
  }
}

// מריץ fn עם אפליקציית admin מאותחלת, וסוגר אותה תמיד — גם כשנזרקת שגיאה.
async function withAdmin(fn) {
  const app = admin.initializeApp({
    credential: admin.credential.cert(requireServiceAccount()),
    databaseURL: DB_URL,
    storageBucket: STORAGE_BUCKET,
  });
  try {
    return await fn({ app, db: admin.database(), bucket: admin.storage().bucket() });
  } finally {
    await app.delete();
  }
}

module.exports = { withAdmin, PROJECT_ID, DB_URL, STORAGE_BUCKET };
