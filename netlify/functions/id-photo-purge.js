// Drushe — מחיקה אוטומטית של צילומי תעודות זהות, 30 יום אחרי שהצוות הכריע.
//
// השורש: האפליקציה אוספת צילום תעודה של נער שנרשם כמורה ושל ההורה, כדי שאדם יאמת גיל והסכמה. ברגע שההחלטה
// התקבלה, התמונה כבר לא נחוצה לשום מטרה — אבל היא נשארה עד מחיקת החשבון. כל יום שהיא נשארת הוא סיכון על קטין,
// בלי תועלת. מה שנשמר אחרי המחיקה הוא העובדה (גיל, סוג מסמך, מי אימת, מתי), לא המסמך.
//
// פונקציה מתוזמנת (netlify.toml), פעם ביום. היא בטוחה להפעלה חוזרת: מוחקת רק מה שהגיע זמנו, ומה שנכשל נשאר
// לריצה הבאה — שום דבר לא מסומן כ"נמחק" לפני שהוא באמת נמחק.
//
// שני מקורות לתאריך החלטה:
//  1. idPurgeDue/<uid> — מספר (מילישניות). המנהל כותב אותו בלחיצה על אישור/דחייה (index.html, scheduleIdPurge).
//     זה מכסה את תצלום ההורה (users/<uid>/parentIdPhoto) ואת תצלום המורה.
//  2. סריקה של teacherVerification: מורה שהעלה תעודה חדשה *אחרי* האימות לא עובר שוב דרך המנהל, ולכן אין לו שורה
//     בתור. הצומת הזה קטן (מורים בלבד, מחרוזות כתובת) ולכן הסריקה זולה. התאריך: האחרון מבין האימות להעלאה.
//     תעודה שעדיין לא הוכרע בה — לא נמחקת, היא עוד נחוצה.

const { admin, initAdmin, STORAGE_BUCKET } = require('../lib/firebase-admin-init');
const { ID_PHOTO_RETENTION_DAYS, DAY_MS } = require('../lib/retention');

const UID_RE = /^[-A-Za-z0-9_]{1,128}$/;

exports.handler = async () => {
  initAdmin();
  const db = admin.database();
  const bucket = admin.storage().bucket(STORAGE_BUCKET);
  const now = Date.now();
  const result = { purged: [], failed: [], scanned: 0 };

  // מוחק את כל מה ששייך לתעודות של uid אחד. זורק אם משהו נכשל — הקורא משאיר הכול לריצה הבאה.
  async function purge(uid) {
    if (!UID_RE.test(uid)) throw new Error('bad uid');
    // Storage קודם: אם הוא נכשל, שדה ה-DB עדיין מצביע על הקובץ והריצה הבאה תנסה שוב.
    await bucket.deleteFiles({ prefix: 'id-photos/' + uid + '/' });
    await db.ref('teacherVerification/' + uid + '/idPhoto').remove();
    await db.ref('teachers/' + uid + '/ageVerification/idPhoto').remove();   // עותק ישן שנשמר בתוך הרשומה
    await db.ref('users/' + uid + '/parentIdPhoto').remove();
    await db.ref('users/' + uid + '/idPhotosPurgedAt').set(now);
    await db.ref('idPurgeDue/' + uid).remove();
  }

  async function attempt(uid) {
    try { await purge(uid); result.purged.push(uid); }
    catch (e) { console.error('[id-photo-purge] failed for', uid, e.message); result.failed.push(uid); }
  }

  // 1. התור
  const queue = (await db.ref('idPurgeDue').get()).val() || {};
  const done = new Set();
  for (const [uid, due] of Object.entries(queue)) {
    if (typeof due === 'number' && due <= now) { done.add(uid); await attempt(uid); }
  }

  // 2. תעודות מורים שהועלו אחרי האימות
  const tv = (await db.ref('teacherVerification').get()).val() || {};
  for (const [uid, rec] of Object.entries(tv)) {
    if (done.has(uid) || !rec || !rec.idPhoto) continue;
    result.scanned++;
    const status = (await db.ref('teachers/' + uid + '/ageVerification/status').get()).val();
    const verifiedAt = Number((await db.ref('teachers/' + uid + '/ageVerification/verifiedAt').get()).val()) || 0;
    const rejectedAt = Number((await db.ref('users/' + uid + '/rejectedAt').get()).val()) || 0;
    const base = status === 'verified' ? Math.max(verifiedAt, Number(rec.updatedAt) || 0) : rejectedAt;
    if (base && now >= base + ID_PHOTO_RETENTION_DAYS * DAY_MS) await attempt(uid);
  }

  console.log('[id-photo-purge]', JSON.stringify({ purged: result.purged.length, failed: result.failed.length, scanned: result.scanned }));
  return { statusCode: result.failed.length ? 500 : 200, body: JSON.stringify(result) };
};
