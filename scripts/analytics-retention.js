// מחיקת לוג האנליטיקס הישן.
//
// ── למה ──
//
// kLog כותב ל-`_analytics/<חודש>` רשומה לכל פעולה: שם האירוע, הפרמטרים,
// **ה-uid של המשתמש** והזמן. המשתמשים כאן הם קטינים, והצומת הזה גדל בלי
// הגבלה — כלומר מעקב אחרי ילד נשמר לנצח, ונכנס גם לכל גיבוי יומי.
//
// הגיבויים עצמם נמחקים אחרי 30 יום (backup-database.js), ותעודות זהות
// יושבות בצומת מוגן. רק האנליטיקס לא היה כפוף לשום תקופת שמירה.
//
// ── למה מחיקה אוטומטית ולא ריצת יובש ──
//
// orphan-cleanup.js דורש אישור מפורש כי הוא מוחק רשומות אמיתיות של משתמשים
// — הזמנות, ביקורות, שיחות — ושגיאה שם מוחקת משהו שאיש לא יוכל לשחזר.
// כאן מדובר בלוג אירועים בלבד, והמחיקה היא לפי דלי חודשי שלם, לא לפי
// רשומה. זה אותו דפוס שבו backup-database.js כבר מוחק גיבויים ישנים לבד.
// שמירה שדורשת שמישהו יזכור ללחוץ עליה אינה תקופת שמירה.
'use strict';
const { withAdmin } = require('./lib/admin');
const annotate = require('./lib/annotate');

// 12 חודשים. מספיק כדי להשוות שנה לשנה, ולא יותר.
const RETENTION_MONTHS = 12;

// מפתחות החודש נכתבים ב-kLog כ-`new Date().toISOString().slice(0,7)` — כלומר
// תמיד YYYY-MM. כל מפתח שלא נראה כך לא נמחק: הוא לא נוצר בידי הקוד הזה,
// ואנחנו לא יודעים מה הוא.
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function monthsBetween(a, b) {
  return (b.y - a.y) * 12 + (b.m - a.m);
}

function parseMonth(key) {
  const [y, m] = key.split('-').map(Number);
  return { y, m };
}

async function run({ db }) {
  const snap = await db.ref('_analytics').once('value');
  const all = snap.val() || {};
  const keys = Object.keys(all);

  if (!keys.length) {
    console.log('✅ אין נתוני אנליטיקס — אין מה למחוק.');
    return;
  }

  const now = new Date();
  const current = { y: now.getUTCFullYear(), m: now.getUTCMonth() + 1 };

  const expired = [];
  const kept = [];
  const skipped = [];

  for (const key of keys) {
    if (!MONTH_RE.test(key)) { skipped.push(key); continue; }
    const age = monthsBetween(parseMonth(key), current);
    // age <= 0 הוא החודש הנוכחי או מפתח עתידי (שעון שגוי) — לא נוגעים.
    (age > RETENTION_MONTHS ? expired : kept).push({ key, age, count: Object.keys(all[key] || {}).length });
  }

  console.log(`🔎 ${keys.length} חודשים ב-_analytics, סף: ${RETENTION_MONTHS} חודשים.`);
  for (const k of kept) console.log(`   נשמר   ${k.key}  (${k.count} אירועים, בן ${k.age} חודשים)`);
  if (skipped.length) console.log(`   ⚠️ לא נבדקו (מפתח שאינו YYYY-MM): ${skipped.join(', ')}`);

  if (!expired.length) {
    console.log('\n✅ אין חודשים מעבר לתקופת השמירה.');
    annotate.notice(
      `אנליטיקס: ${keys.length} חודשים נשמרים, 0 נמחקו`,
      [`סף: ${RETENTION_MONTHS} חודשים`, ...kept.map((k) => `${k.key}  ${k.count} אירועים`)]
    );
    return;
  }

  const updates = {};
  for (const e of expired) updates[e.key] = null;
  await db.ref('_analytics').update(updates);

  const lines = expired.map((e) => `${e.key}  (${e.count} אירועים, בן ${e.age} חודשים)`);
  console.log(`\n🗑️ ${expired.length} חודשים נמחקו:`);
  for (const l of lines) console.log(`   ${l}`);
  // ההערה נכתבת **אחרי** שהמחיקה חזרה, ולכן היא עדות שהיא קרתה ולא רק
  // שנשקלה — אותו לקח מ-orphan-cleanup.js.
  annotate.notice(`אנליטיקס: נמחקו ${expired.length} חודשים`, lines);
}

withAdmin((h) => run(h), 'production').catch((e) => {
  console.error('❌ מחיקת האנליטיקס הישן נכשלה:', e.message);
  annotate.error('מחיקת האנליטיקס הישן נכשלה', e.message);
  process.exitCode = 1;
});
