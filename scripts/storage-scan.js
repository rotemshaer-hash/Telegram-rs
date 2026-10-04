// סריקת יתומים ב-Storage — המקבילה של orphan-scan.js לדלי הקבצים.
//
// ── למה זה נדרש בנפרד ──
//
// findOrphans (lib/orphans.js) סורק את ה-RTDB בלבד. הקבצים עצמם — תמונות
// תעודת זהות של קטינים ושל ההורים שלהם, סטוריז, מדיה בקהילה ותיק עבודות —
// יושבים ב-Firebase Storage, ושום סריקה מעולם לא נגעה בהם. ניקוי היתומים
// של 4.10 מחק 32 רשומות מהמסד, וביניהן רשומת `teacherVerification` של קטין,
// אבל **הקובץ שהיא הצביעה עליו** לא נבדק מעולם.
//
// ── קריאה בלבד, במכוון ──
//
// הסקריפט הזה לא מוחק דבר ואין לו דגל שמאפשר זאת. זה בדיוק הדפוס של
// orphan-scan.js: קודם יודעים מה יש, מסתכלים על הרשימה, ורק אז נבנה ניקוי.
// מחיקה של קובץ ב-Storage אינה הפיכה, ותמונת תעודת זהות שנמחקה בטעות אינה
// ניתנת לשחזור מהמשתמש בלי לבקש ממנו להעלות אותה שוב.
//
// ── ייצור בלבד ──
//
// ל-staging אין דלי משלו: Storage אינו מבודד בין הסביבות (ראה lib/admin.js),
// והדלי משותף לפרויקט. סריקה "על staging" הייתה סורקת את קבצי הייצור
// ומדווחת עליהם כאילו הם של סביבת בדיקות. לכן הסביבה כאן קבועה, והעובדה
// נאמרת ולא מוסתרת.
'use strict';
const { withAdmin } = require('./lib/admin');
const annotate = require('./lib/annotate');

// הקידומות שבהן המקטע הראשון אחרי הקידומת הוא uid. נלקחו מ-storage.rules,
// שהוא מקור האמת לאיזה נתיב מותר למי — לא מרשימה שנכתבה כאן מהזיכרון.
const UID_PREFIXES = ['id-photos', 'stories', 'communityMedia', 'portfolio'];

// נתיבים שאינם של משתמשים ואסור לדווח עליהם כיתומים. backups/ נכתב בידי
// חשבון השירות ואין לו uid כלל.
const NON_USER_PREFIXES = ['backups'];

const MB = 1024 * 1024;

function mb(bytes) {
  return (bytes / MB).toFixed(1);
}

// ממצא מסיים את ה-job בכישלון, וזה מכוון — אותו דפוס בדיוק כמו
// health-monitor.js. ריצה שבועית שאיש לא פותח אינה שווה כלום: כישלון הוא מה
// ש-GitHub שולח עליו התראה, וזו הדרך היחידה שבה סריקה מתוזמנת מגיעה לבעלים
// בלי שמישהו יזכור להיכנס ולהסתכל.
//
// חשוב מה **לא** נחשב ממצא: סריקה שלא מצאה כלום עוברת. כלומר ה-job אדום רק
// כשבאמת יש מה לנקות, ולא ככלל קבוע שמאבד את משמעותו.
function withFindings(findings) {
  const err = new Error(findings.join(' | '));
  err.findings = findings;
  return err;
}

async function run({ db, bucket }) {
  if (!bucket) throw new Error('אין גישה לדלי — נעצר.');

  const usersSnap = await db.ref('users').once('value');
  const live = new Set(Object.keys(usersSnap.val() || {}));
  // אותה הגנה כמו ב-findOrphans: מסד שחזר ריק הוא תקלה, וסריקה שתרוץ עליו
  // תכריז על **כל** קובץ בדלי כיתום.
  if (!live.size) throw new Error('אין אף משתמש ב-users. כנראה תקלת הרשאה — נעצר.');

  const [files] = await bucket.getFiles();
  console.log(`🔎 ${files.length} קבצים בדלי, ${live.size} משתמשים חיים.`);

  const orphans = [];
  const unknown = [];
  let totalBytes = 0;
  let orphanBytes = 0;

  for (const f of files) {
    const size = Number(f.metadata?.size || 0);
    totalBytes += size;
    const [prefix, uid] = f.name.split('/');
    if (NON_USER_PREFIXES.includes(prefix)) continue;
    if (!UID_PREFIXES.includes(prefix)) {
      // קידומת שלא מוכרת לסקריפט אינה "לא יתומה" — היא **לא נבדקה**, וזה
      // הבדל שחייב להופיע בדוח. אחרת קידומת חדשה שמישהו יוסיף תיעלם בשקט.
      unknown.push(f.name);
      continue;
    }
    if (uid && !live.has(uid)) {
      orphans.push({ name: f.name, uid, prefix, size });
      orphanBytes += size;
    }
  }

  console.log(`\nנפח כולל: ${mb(totalBytes)}MB.`);

  // ההיקף שנסרק, תמיד — לא רק החריגים. דוח שמדווח רק מה שחרג אינו מבדיל
  // בין "נסרקו 500 קבצים וכולם תקינים" לבין "הדלי ריק": שתי התוצאות נראות
  // זהות למי שקורא, וה"0 יתומים" השני אינו אומר דבר על בריאות המערכת.
  // מספר הקבצים לפי קידומת הוא גם הדרך לראות ש-Storage בכלל בשימוש.
  const scanned = new Map();
  for (const f of files) {
    const prefix = f.name.split('/')[0];
    scanned.set(prefix, (scanned.get(prefix) || 0) + 1);
  }
  annotate.notice(
    `נסרקו ${files.length} קבצים ב-Storage (${mb(totalBytes)}MB) — ${orphans.length} יתומים`,
    [
      `משתמשים חיים: ${live.size}`,
      `קבצים יתומים: ${orphans.length} (${mb(orphanBytes)}MB)`,
      `קבצים שלא נבדקו: ${unknown.length}`,
      '',
      ...[...scanned.entries()].sort((a, b) => b[1] - a[1]).map(([p, c]) => `${String(c).padStart(5)}  ${p}/`),
    ]
  );

  if (unknown.length) {
    console.log(`\n⚠️ ${unknown.length} קבצים בקידומות שהסקריפט אינו מכיר — לא נבדקו:`);
    for (const n of unknown.slice(0, annotate.MAX_LINES)) console.log(`   ${n}`);
    annotate.notice(`${unknown.length} קבצים לא נבדקו (קידומת לא מוכרת)`, unknown);
  }

  if (!orphans.length) {
    console.log('\n✅ לא נמצאו קבצים יתומים.');
    if (unknown.length) throw withFindings([`${unknown.length} קבצים בקידומת שאינה מוכרת — לא נבדקו.`]);
    return;
  }

  const byPrefix = new Map();
  for (const o of orphans) byPrefix.set(o.prefix, (byPrefix.get(o.prefix) || 0) + 1);
  console.log(`\n🔎 ${orphans.length} קבצים יתומים, ${mb(orphanBytes)}MB:`);
  for (const [prefix, count] of [...byPrefix.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${String(count).padStart(5)}  ${prefix}`);
  }

  const lines = orphans.map((o) => `${o.name}   (${mb(o.size)}MB, uid ${o.uid})`);
  for (const l of lines.slice(0, annotate.MAX_LINES)) console.log(`   ${l}`);
  annotate.notice(`${orphans.length} קבצים יתומים ב-Storage (${mb(orphanBytes)}MB)`, lines);

  console.log('\n(סריקה בלבד — הסקריפט הזה לא מוחק דבר.)');

  const findings = [`${orphans.length} קבצים יתומים (${mb(orphanBytes)}MB).`];
  if (unknown.length) findings.push(`${unknown.length} קבצים בקידומת שאינה מוכרת — לא נבדקו.`);
  throw withFindings(findings);
}

withAdmin((h) => run(h), 'production').catch((e) => {
  // שתי סיבות שונות לגמרי לאותו job אדום, ואסור שייראו זהות: סריקה שלא
  // הצליחה לרוץ (הרשאה, דלי, מסד ריק) לעומת סריקה שרצה כשורה ומצאה משהו.
  // הראשונה אומרת שאיננו יודעים מה מצב ה-Storage; השנייה אומרת בדיוק מה הוא.
  const found = Array.isArray(e.findings);
  const title = found ? 'סריקת ה-Storage מצאה ממצאים' : 'סריקת ה-Storage נכשלה';
  console.error(`${found ? '🚨' : '❌'} ${title}:`, e.message);
  annotate.error(title, e.message);
  process.exitCode = 1;
});
