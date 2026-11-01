// מגבלת קצב בחלון קבוע, בטרנזקציה אחת. הגדרה אחת לפונקציות חדשות — חמש
// הפונקציות הקיימות מחזיקות כל אחת עותק משלה (ראה HANDOFF), ואין להוסיף שישי.
//
// מחזירה true אם הבקשה בתוך המגבלה, false אם חרגה. המפתח מנוקה מתווים שאסורים
// בנתיב במסד.
async function withinWindowLimit(db, path, key, max, windowMs) {
  const safe = String(key || 'unknown').replace(/[.#$/[\]]/g, '_');
  const ref = db.ref(path + '/' + safe);
  const now = Date.now();
  const result = await ref.transaction((cur) => {
    if (!cur || now - cur.start > windowMs) return { start: now, count: 1 };
    if (cur.count >= max) return; // ביטול העסקה — חריגה
    return { start: cur.start, count: cur.count + 1 };
  });
  return result.committed;
}

module.exports = { withinWindowLimit };
