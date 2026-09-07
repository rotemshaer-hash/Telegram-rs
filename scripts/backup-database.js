// גיבוי יומי של כל מסד הנתונים.
//
// ── למה זה קיים, ולמה רק עכשיו ──
//
// עד 7.9.2026 לא היה לפרויקט שום גיבוי. לא ידני, לא אוטומטי, ולא מתועד
// כפער — ביקורת חיצונית העירה על כך וצדקה שזו נקודה עיוורת אמיתית: כל שאר
// הקטגוריות שהיא בדקה כבר היו מתועדות, וזו לא הייתה בשום מקום. גיבוי אוטומטי
// דורש תוכנית Blaze, שהופעלה באותו יום, ולכן זה נכתב עכשיו.
//
// מה זה מגן מפניו, וזה מה שבאמת מסוכן כאן: מחיקה בטעות, שינוי חוקים שגוי,
// או באג במסלול מחיקה. מסלול המחיקה בפרויקט הזה חזר ונשבר **ארבע פעמים**,
// ובכל פעם הוא דיווח הצלחה. הפעם החמישית תמצא גיבוי מאתמול.
//
// מה זה **לא** מגן מפניו: אובדן הפרויקט עצמו. הגיבוי יושב בדלי Storage של
// אותו פרויקט. זה מכוון — הוא לא דורש שום תשתית נוספת ולא מוציא מידע של
// קטינים החוצה — אבל זו מגבלה שצריך לדעת עליה. הגנה מפני אובדן פרויקט
// דורשת יעד חיצוני, וזו החלטה של הבעלים.
//
// ── למה לא artifact של GitHub ──
//
// כי הריפו ציבורי. artifact ניתן להורדה על ידי כל מי שיכול לקרוא את הריפו,
// והגיבוי מכיל שמות של קטינים, כתובות מייל של ההורים שלהם, וצילומי תעודות
// זהות (base64 תחת teacherVerification). דלי ה-Storage, לעומת זאת, סגור
// ללקוחות לחלוטין — storage.rules דוחה כל נתיב שאינו ארבע התיקיות המוכרות,
// ו-backups/ אינו אחת מהן. רק חשבון השירות מגיע לשם.
'use strict';
const { withAdmin } = require('./lib/admin');

const PREFIX = 'backups/';
// 30 גיבויים יומיים. RPO = 24 שעות (מה שאפשר לאבד), RTO = דקות (זמן שחזור).
const RETENTION_DAYS = 30;

function stamp(d = new Date()) {
  return d.toISOString().replace(/[:.]/g, '-').slice(0, 19) + 'Z';
}

async function run({ db, bucket }) {
  const snap = await db.ref('/').once('value');
  const data = snap.val();
  if (data === null) {
    // מסד ריק הוא כמעט תמיד סימן לתקלה — הרשאה, כתובת שגויה, או שמישהו
    // בדיוק מחק הכל. לא כותבים גיבוי ריק על גבי ההיסטוריה בשקט.
    throw new Error('המסד חזר ריק. לא נכתב גיבוי — בדוק הרשאות וכתובת DB.');
  }

  const json = JSON.stringify(data);
  const name = `${PREFIX}${stamp()}.json`;
  const file = bucket.file(name);
  await file.save(json, {
    contentType: 'application/json',
    // הגיבוי מכיל מידע אישי של קטינים. אין שום סיבה שהוא ייכנס למטמון של
    // שום שכבה בדרך.
    metadata: { cacheControl: 'no-store' },
  });

  // גיבוי שלא נבדק הוא הנחה, לא גיבוי. קוראים אותו בחזרה ומוודאים שהוא
  // שלם ונפרס — זה תופס העלאה שנקטעה, שהיא הכשל הנפוץ ביותר כאן.
  const [back] = await file.download();
  if (back.length !== Buffer.byteLength(json)) {
    throw new Error(`הגיבוי נכתב חלקית: ${back.length} מתוך ${Buffer.byteLength(json)} בתים.`);
  }
  JSON.parse(back.toString('utf8'));

  const topLevel = Object.keys(data).length;
  // ספירות בלבד. שום תוכן לא נכנס ללוג — הוא ציבורי.
  console.log(`✅ גובה ${name} · ${(json.length / 1024).toFixed(1)}KB · ${topLevel} צמתים · אומת בקריאה חוזרת`);

  // ניקוי לפי גיל.
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 3600 * 1000;
  const [files] = await bucket.getFiles({ prefix: PREFIX });
  let removed = 0;
  for (const f of files) {
    if (f.name === name) continue;
    const created = Date.parse(f.metadata?.timeCreated || '');
    if (Number.isFinite(created) && created < cutoff) {
      await f.delete();
      removed++;
    }
  }
  console.log(`🧹 ${files.length} גיבויים קיימים, ${removed} נמחקו מעל ${RETENTION_DAYS} יום`);
}

withAdmin(run).catch((e) => {
  console.error('❌ הגיבוי נכשל:', e.message);
  process.exitCode = 1;
});
