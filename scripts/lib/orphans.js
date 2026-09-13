// זיהוי רשומות יתומות — מקור אמת יחיד.
//
// הלוגיקה הזו נכתבה במקור בתוך orphan-scan.js (שסופר בלבד). orphan-cleanup.js
// צריך את אותו זיהוי בדיוק, אבל עם נתיב מדויק לכל רשומה כדי שאפשר יהיה
// למחוק אותה — לא רק לספור. שני עותקים של "מה נחשב יתום" היו בדיוק הסיכון
// שה-SSOT בפרויקט הזה קיים כדי למנוע: הגדרה אחת זזה, השנייה נשארת מאחור,
// והסקריפט שמוחק מוחק לפי כלל אחר מזה שהסקריפט שסורק דיווח עליו.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

// USER_DATA_PATHS נקרא מ-index.html ולא משוכפל: זו אותה רשימה שמחיקת
// משתמש מוחקת לפיה.
function userKeyedPaths() {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
  const m = html.match(/const USER_DATA_PATHS=\[([\s\S]*?)\];/);
  if (!m) throw new Error('USER_DATA_PATHS לא נמצא ב-index.html — הרשימה זזה, והסריקה תסרוק את הדבר הלא נכון.');
  return m[1].split(',').map((x) => x.trim().replace(/^'|'$/g, '')).filter(Boolean);
}

// צמתים שבהם ה-uid הוא **ערך** ולא מפתח. שמות השדות נבדקו מול הקוד בפועל:
// reviews נושא `from`, לא `uid`, ו-communityPosts נושא `authUid`.
const UID_VALUED = [
  { path: 'communityPosts', fields: ['authUid'], depth: 1 },
  { path: 'pendingReviews', fields: ['from'], depth: 1 },
  { path: 'bookings', fields: ['studentId', 'teacherId'], depth: 1 },
  { path: 'reviews', fields: ['from'], depth: 2 },
];

// מחזיר מערך של { refPath, where, kind, uid } — refPath הוא בדיוק מה
// שמעבירים ל-db.ref(...) כדי למחוק את הרשומה הספציפית הזו, לא רק ספירה.
async function findOrphans(db) {
  const usersSnap = await db.ref('users').once('value');
  const users = usersSnap.val() || {};
  const live = new Set(Object.keys(users));
  if (!live.size) {
    throw new Error('אין אף משתמש. כנראה שהמסד ריק — הרץ קודם את תרגיל השחזור.');
  }

  const items = [];

  // א. צמתים שממופתחים לפי uid
  for (const node of userKeyedPaths()) {
    if (node === 'users') continue;
    const snap = await db.ref(node).once('value');
    const val = snap.val();
    if (!val || typeof val !== 'object') continue;
    for (const k of Object.keys(val)) {
      if (!live.has(k)) items.push({ refPath: `${node}/${k}`, where: node, kind: 'מפתח', uid: k });
    }
  }

  // ב. צמתים שבהם ה-uid הוא ערך
  for (const { path: node, fields, depth } of UID_VALUED) {
    const snap = await db.ref(node).once('value');
    const val = snap.val();
    if (!val || typeof val !== 'object') continue;
    const records = depth === 1
      ? Object.entries(val)
      : Object.entries(val).flatMap(([outerK, inner]) =>
          inner && typeof inner === 'object'
            ? Object.entries(inner).map(([innerK, r]) => [`${outerK}/${innerK}`, r])
            : []
        );
    for (const [key, r] of records) {
      if (!r || typeof r !== 'object') continue;
      for (const field of fields) {
        const v = r[field];
        if (typeof v === 'string' && !live.has(v)) {
          items.push({ refPath: `${node}/${key}`, where: `${node}.${field}`, kind: 'ערך', uid: v });
          break; // רשומה אחת נספרת פעם אחת גם אם כמה שדות יתומים בה
        }
      }
    }
  }

  // ג. שיחות: chatId הוא <uidA>_<uidB>
  const msgSnap = await db.ref('messages').once('value');
  const chats = msgSnap.val() || {};
  for (const id of Object.keys(chats)) {
    const parts = String(id).split('_');
    const orphanUid = parts.length === 2 ? parts.find((p) => p && !live.has(p)) : null;
    if (orphanUid) items.push({ refPath: `messages/${id}`, where: 'messages', kind: 'chatId', uid: orphanUid });
  }

  return items;
}

module.exports = { findOrphans, userKeyedPaths };
