// ניקוי יתומים — המשך ל-orphan-scan.js.
//
// ── השורש ──
//
// orphan-scan.js (ריצה 34262805242, על עותק משוחזר אמיתי) מצא 41 רשומות
// יתומות — כולל רשומה אחת ב-teacherVerification, שם יושבת תמונת תעודת
// הזהות של קטין. הן שריד היסטורי ממחיקת משתמש ששברה ארבעה סבבים בעבר
// (ראה HANDOFF): מסלול המחיקה תוקן ועוצר יתומים חדשים, אבל מעולם לא ניקה
// את הישנים. הסקריפט הזה סוגר את החלק הזה — הוא לא סורק מחדש, אלא מוחק
// בדיוק את מה ש-lib/orphans.js מזהה.
//
// ── בטיחות, שכבה אחר שכבה ──
//
// 1. ברירת המחדל היא staging, לא ייצור — אותו דפוס בדיוק כמו orphan-scan.js
//    ו-restore-drill.js. עורף לייצור דורש CLEANUP_ENV=production מפורש.
// 2. ברירת המחדל היא dry run — מדפיס מה **היה** נמחק, לא מוחק כלום. מחיקה
//    אמיתית דורשת APPLY_ORPHAN_CLEANUP=yes, אותו דפוס כמו ALLOW_RESTORE
//    ב-restore-database.js ו-APPLY_FOUNDING_BACKFILL בסקריפט המייסדים —
//    כי גם כאן זו כתיבה (מחיקה, לא הפיכה בקלות כמו דגל) על נתוני ייצור.
// 3. מחיקה בייצור (CLEANUP_ENV=production + APPLY=yes) דורשת גם גיבוי טרי
//    מאומת — פחות מ-30 שעות, אותו סף בדיוק כמו health-monitor.js. בלי גיבוי
//    טרי הסקריפט נעצר *לפני* שהוא נוגע במסד, לא אחרי.
// 4. כל 41 (או כמה שיש כרגע) אינן בהכרח יתומות אמת — ייתכנו רשומות
//    לגיטימיות שמצביעות על uid שלא היה מעולם ב-users. הרשימה המודפסת היא
//    מועמדות לבדיקה, לא גזר דין: לקרוא אותה לפני שמריצים עם APPLY=yes.
'use strict';
const { withAdmin } = require('./lib/admin');
const { findOrphans } = require('./lib/orphans');

const APPLY = process.env.APPLY_ORPHAN_CLEANUP === 'yes';
const CLEANUP_ENV = process.env.CLEANUP_ENV === 'production' ? 'production' : 'staging';
// אותו סף בדיוק כמו health-monitor.js — "גיבוי טרי" מוגדר במקום אחד ברוח
// הדברים, גם אם שני הקבצים לא יכולים לייבא קבוע משותף בלי תלות מיותרת.
const RECENT_BACKUP_MAX_AGE_H = 30;

async function assertRecentProductionBackup(bucket) {
  if (!bucket) throw new Error('אין גישה לדלי הגיבויים — נעצר לפני מחיקת ייצור.');
  const [files] = await bucket.getFiles({ prefix: 'backups/' });
  const daily = files.filter((f) => !f.name.includes('pre-restore-'));
  const newest = daily
    .map((f) => Date.parse(f.metadata?.timeCreated || ''))
    .filter(Number.isFinite)
    .sort((a, b) => b - a)[0];
  if (!newest) throw new Error('אין אף גיבוי בדלי — נעצר לפני מחיקת ייצור.');
  const ageH = (Date.now() - newest) / 3600000;
  if (ageH > RECENT_BACKUP_MAX_AGE_H) {
    throw new Error(`הגיבוי האחרון בן ${Math.round(ageH)} שעות (סף: ${RECENT_BACKUP_MAX_AGE_H}) — נעצר לפני מחיקת ייצור.`);
  }
  console.log(`✅ גיבוי טרי אומת (${Math.round(ageH)} שעות).`);
}

async function run({ db, env, bucket }) {
  console.log(`🔎 סורק ${env}`);
  const items = await findOrphans(db);

  if (!items.length) {
    console.log('✅ לא נמצאו יתומים — אין מה לנקות.');
    return;
  }

  const byWhere = new Map();
  for (const it of items) byWhere.set(it.where, (byWhere.get(it.where) || 0) + 1);
  console.log(`\n${APPLY ? '🗑️' : '🔎'} ${items.length} רשומות יתומות ב-${byWhere.size} מקומות (${env}):`);
  for (const [where, count] of [...byWhere.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${String(count).padStart(5)}  ${where}`);
  }

  if (!APPLY) {
    console.log('\n(dry run — שום דבר לא נמחק. APPLY_ORPHAN_CLEANUP=yes למחיקה אמיתית)');
    return;
  }

  if (env === 'production') {
    await assertRecentProductionBackup(bucket);
  }

  const updates = {};
  for (const it of items) updates[it.refPath] = null;
  await db.ref().update(updates);
  console.log(`\n✔ ${items.length} רשומות נמחקו מ-${env}.`);
}

withAdmin((h) => run(h), CLEANUP_ENV).catch((e) => {
  console.error('❌ ניקוי היתומים נכשל:', e.message);
  process.exitCode = 1;
});
