// מורים מייסדים — תיקון רטרואקטיבי.
//
// ── השורש ──
//
// הדגל `users/<uid>/foundingMember` נכתב **פעם אחת בלבד**, ובמקום יחיד:
// `saveTeacherProfile` (index.html), הפונקציה שרצה כשמורה **חדש** משלים
// את מסך ההקמה לראשונה. הפיצ'ר נוסף ב-18.8.2026 (commit 35a6fc8).
//
// המשמעות: כל מורה שנרשם **לפני** אותו תאריך — ובכלל זה מורים מוקדמים
// אמיתיים, כולל הבעלים עצמו — קיבל `foundingMember === undefined` לצמיתות.
// אין שום מסלול אחר בקוד שמגדיר את הדגל: `saveTeacherProfileEdits` (עריכת
// פרופיל) לא נוגע בו, ואין מסך שמריץ שוב את לוגיקת ההקמה למורה קיים.
// "מורה מייסד" הפך בפועל ל"מורה שנרשם אחרי 18.8 ובתוך 500 הראשונים" —
// לא מה שהובטח.
//
// ── הכלל הנכון, ולמה לא "500 הראשונים שנספרים היום" ──
//
// "500 הראשונים" חייב להימדד לפי **סדר הרשמה** (`teachers/<uid>/createdAt`),
// לא לפי מונה חי היום. מורה מוקדם אמיתי יכול להימצא מתחת ל-500 בסדר ההרשמה
// גם אם היום יש כבר יותר מ-500 מורים במסד (חלקם הצטרפו אחר כך, חלקם אולי
// נמחקו) — ספירה חיה הייתה יכולה להחריג בטעות בדיוק את מי שהמנגנון נועד
// להגן עליו.
//
// ── בטיחות ──
//
// ברירת המחדל היא dry run: מדפיס מה **היה** משתנה, לא כותב כלום. כתיבה
// אמיתית דורשת `APPLY_FOUNDING_BACKFILL=yes` במפורש — אותו דפוס בדיוק כמו
// `ALLOW_RESTORE` ב-restore-database.js, כי גם כאן מדובר בכתיבה על נתוני
// ייצור אמיתיים, גם אם ההשפעה (דגל תשלום) הפיכה בקלות יחסית.
//
// לא נוגע במורה שכבר יש לו `foundingMember === true` — אידמפוטנטי.
'use strict';
const { withAdmin } = require('./lib/admin');

const FOUNDING_TEACHER_LIMIT = 500;
const APPLY = process.env.APPLY_FOUNDING_BACKFILL === 'yes';

async function run({ db }) {
  const [teachersSnap, usersSnap] = await Promise.all([
    db.ref('teachers').once('value'),
    db.ref('users').once('value'),
  ]);
  const teachers = teachersSnap.val() || {};
  const users = usersSnap.val() || {};

  const ordered = Object.entries(teachers)
    .map(([uid, t]) => ({ uid, createdAt: Number(t?.createdAt) || Infinity }))
    .sort((a, b) => a.createdAt - b.createdAt);

  console.log(`👥 ${ordered.length} מורים בסך הכל, ${FOUNDING_TEACHER_LIMIT} מקומות מייסדים.`);

  const eligible = ordered.slice(0, FOUNDING_TEACHER_LIMIT);
  const toFix = eligible.filter((t) => users[t.uid]?.foundingMember !== true);
  const alreadyTrue = eligible.length - toFix.length;
  console.log(`✅ ${alreadyTrue} מהזכאים כבר מסומנים כמייסדים.`);
  console.log(`${APPLY ? '✏️' : '🔎'} ${toFix.length} זכאים ${APPLY ? 'יסומנו עכשיו' : 'היו מסומנים בהרצה עם APPLY_FOUNDING_BACKFILL=yes'}.`);

  // הבעלים מוזכר בשמו כי זו התשובה לשאלה שהוא שאל על עצמו — לא הדלפת נתוני
  // משתמש אחר. לא מודפס שום פרט על אף מורה אחר.
  const ownerEntry = Object.entries(users).find(([, u]) => u?.email === 'rotemshaer@gmail.com');
  if (ownerEntry) {
    const [ownerUid] = ownerEntry;
    const rank = ordered.findIndex((t) => t.uid === ownerUid);
    const already = users[ownerUid]?.foundingMember === true;
    if (rank === -1) {
      console.log('🙋 הבעלים: אינו רשום כמורה (אין רשומה תחת teachers).');
    } else {
      console.log(`🙋 הבעלים: מקום #${rank + 1} בסדר ההרשמה · foundingMember נוכחי: ${already} · בטווח 500: ${rank < FOUNDING_TEACHER_LIMIT}`);
    }
  } else {
    console.log('🙋 הבעלים: לא נמצא ב-users לפי המייל.');
  }

  if (!APPLY) {
    console.log('\n(dry run — שום דבר לא נכתב)');
    return;
  }

  const updates = {};
  for (const t of toFix) updates[`users/${t.uid}/foundingMember`] = true;
  await db.ref().update(updates);
  console.log(`\n✔ ${toFix.length} מורים סומנו כמייסדים.`);
}

withAdmin(run).catch((e) => {
  console.error('❌ נכשל:', e.message);
  process.exitCode = 1;
});
