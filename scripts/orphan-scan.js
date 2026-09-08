// סריקת יתומים — רשומות שנשארו במסד תחת uid שכבר לא קיים ב-users.
//
// ── מה זה בודק, ולמה זה שונה מהבדיקות הקיימות ──
//
// tests/e2e/user-deletion.spec.js כבר מריצה את deleteAllUserData **האמיתית**
// מול חנות זרועה, ותופסת שם שדה שגוי או סריקה שאין עליה הרשאה. מה שהיא לא
// יכולה לתפוס הוא נתיב שאיש לא חשב עליו: היא בודקת את מה שזרענו.
//
// הסריקה הזו הולכת מהכיוון ההפוך. היא רצה על **עותק משוחזר של נתוני הייצור
// האמיתיים** (מה שתרגיל השחזור מכניס ל-staging), ושואלת: האם יש כאן רשומות
// ששייכות למישהו שכבר לא קיים? זו התשובה על מחיקות שכבר קרו בעבר — בדיוק
// אלה שמסלול המחיקה השבור דיווח עליהן הצלחה ארבע פעמים.
//
// ── למה זה לא מפיל את הריצה ──
//
// כי אין עדיין בסיס ידוע. יתומים היסטוריים מבאגים שכבר תוקנו יצבעו את הג'וב
// באדום לתמיד, וג'וב שאדום תמיד מאמן את כולם להתעלם מהכישלון הבא — זה בדיוק
// מה שקרה כאן עם 19 ריצות ה-storage. קודם מודדים, ואז קובעים סף.
//
// ── הגבול ──
//
// staging בלבד, קריאה בלבד. הסקריפט אינו כותב כלום ואינו מוחק כלום. גם אם
// יופנה בטעות לייצור הוא לא יזיק — אבל הוא בכל זאת מסרב, כי "לא מזיק" אינו
// סיבה לוותר על גבול שכבר קיים.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { withAdmin, DB_URL } = require('./lib/admin');

// USER_DATA_PATHS נקרא מ-index.html ולא משוכפל כאן: זו אותה רשימה
// ש-deleteAllUserData מוחקת לפיה, ורשימה שנייה שתישאר מאחור תיתן דוח נקי
// בדיוק על הנתיב שהמחיקה שכחה.
function userKeyedPaths() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const m = html.match(/const USER_DATA_PATHS=\[([\s\S]*?)\];/);
  if (!m) throw new Error('USER_DATA_PATHS לא נמצא ב-index.html — הרשימה זזה, והסריקה תסרוק את הדבר הלא נכון.');
  return m[1].split(',').map((x) => x.trim().replace(/^'|'$/g, '')).filter(Boolean);
}

// צמתים שבהם ה-uid הוא **ערך** ולא מפתח. שמות השדות הם אלה שהאפליקציה כותבת
// בפועל, וזו הייתה הטעות שגרמה לכך שאף ביקורת לא נמחקה מעולם: reviews נושא
// `from`, לא `uid`, ו-communityPosts נושא `authUid`.
const UID_VALUED = [
  { path: 'communityPosts', fields: ['authUid'], depth: 1 },
  { path: 'pendingReviews', fields: ['from'], depth: 1 },
  { path: 'bookings', fields: ['studentId', 'teacherId'], depth: 1 },
  { path: 'reviews', fields: ['from'], depth: 2 },
];

async function run({ db, dbUrl }) {
  if (dbUrl === DB_URL) throw new Error('סריקה על הייצור. נעצר.');
  console.log(`🔎 סורק ${dbUrl}`);

  const usersSnap = await db.ref('users').once('value');
  const users = usersSnap.val() || {};
  const live = new Set(Object.keys(users));
  if (!live.size) {
    throw new Error('אין אף משתמש. כנראה שהמסד ריק — הרץ קודם את תרגיל השחזור.');
  }
  console.log(`👥 ${live.size} משתמשים קיימים`);

  const findings = [];

  // ── א. צמתים שממופתחים לפי uid ──
  for (const node of userKeyedPaths()) {
    if (node === 'users') continue;
    const snap = await db.ref(node).once('value');
    const val = snap.val();
    if (!val || typeof val !== 'object') continue;
    const orphans = Object.keys(val).filter((k) => !live.has(k));
    if (orphans.length) findings.push({ where: node, count: orphans.length, kind: 'מפתח' });
  }

  // ── ב. צמתים שבהם ה-uid הוא ערך ──
  for (const { path: node, fields, depth } of UID_VALUED) {
    const snap = await db.ref(node).once('value');
    const val = snap.val();
    if (!val || typeof val !== 'object') continue;
    const records = depth === 1
      ? Object.values(val)
      : Object.values(val).flatMap((inner) => (inner && typeof inner === 'object' ? Object.values(inner) : []));
    for (const field of fields) {
      const orphans = records.filter(
        (r) => r && typeof r === 'object' && typeof r[field] === 'string' && !live.has(r[field])
      );
      if (orphans.length) findings.push({ where: `${node}.${field}`, count: orphans.length, kind: 'ערך' });
    }
  }

  // ── ג. שיחות: chatId הוא <uidA>_<uidB> ──
  const msgSnap = await db.ref('messages').once('value');
  const chats = msgSnap.val() || {};
  const orphanChats = Object.keys(chats).filter((id) => {
    const parts = String(id).split('_');
    return parts.length === 2 && parts.some((p) => p && !live.has(p));
  });
  if (orphanChats.length) findings.push({ where: 'messages', count: orphanChats.length, kind: 'chatId' });

  // ספירות בלבד. שום uid ושום תוכן לא נכנס ללוג — הוא ציבורי, והרשומות
  // האלה נושאות שמות של קטינים ומיילים של הוריהם.
  if (!findings.length) {
    console.log('✅ לא נמצאו יתומים.');
    return;
  }
  const total = findings.reduce((n, f) => n + f.count, 0);
  console.log(`\n⚠️  ${total} רשומות יתומות ב-${findings.length} מקומות:`);
  for (const f of findings.sort((a, b) => b.count - a.count)) {
    console.log(`   ${String(f.count).padStart(5)}  ${f.where}  (${f.kind})`);
  }
  console.log(`\n::warning::נמצאו ${total} רשומות יתומות בעותק המשוחזר. ראה את הפירוט בלוג.`);
  console.log('זו מדידה ראשונה ואין עדיין בסיס להשוות אליו — לכן הריצה אינה נכשלת.');
}

withAdmin(run, 'staging').catch((e) => {
  console.error('❌ סריקת היתומים נכשלה:', e.message);
  process.exitCode = 1;
});
