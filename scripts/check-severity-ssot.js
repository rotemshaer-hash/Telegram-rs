// החומרה וה-SLA של דיווח בטיחות מוגדרים פעמיים, ואסור להם להיפרד.
//
// index.html מחשב אותם (REPORT_SEVERITY_BY_REASON, REPORT_SLA_MS) ו-
// database.rules.json אוכף אותם. חוקי RTDB אינם יכולים לייבא קבוע, ולכן
// המיפוי חייב להופיע בשני הקבצים — וזו בדיוק הכפילות שהחוקה אוסרת.
//
// הבדיקה הזו היא מה שהופך את הכפילות לבטוחה. אם מישהו יוסיף סיבת דיווח או
// ישנה חלון זמן בצד אחד בלבד, החוק ידחה את מה שהלקוח כותב — כלומר **ילד
// שמדווח על סכנה יקבל שגיאה**, בשקט, בלי שאיש יבין למה. עדיף שהפריסה תיעצר.
'use strict';
const fs = require('node:fs');

const html = fs.readFileSync('index.html', 'utf8');
const rules = fs.readFileSync('database.rules.json', 'utf8');
const errors = [];

function block(name) {
  const i = html.indexOf(`const ${name}=`);
  if (i < 0) { errors.push(`${name} לא נמצא ב-index.html`); return null; }
  const open = html.indexOf('{', i);
  const close = html.indexOf('}', open);
  return html.slice(open + 1, close);
}

// REPORT_SLA_MS={critical:2*3600000,...} — מוערך, לא נקרא כטקסט, כדי ש-
// "2*3600000" ו-"7200000" ייחשבו זהים.
const slaSrc = block('REPORT_SLA_MS');
const sevSrc = block('REPORT_SEVERITY_BY_REASON');
if (!slaSrc || !sevSrc) { console.error(errors.join('\n')); process.exit(1); }

const SLA = {};
for (const part of slaSrc.split(',')) {
  const [k, v] = part.split(':');
  if (!k || !v) continue;
  if (!/^[\d*+\s]+$/.test(v)) { errors.push(`ערך SLA לא מספרי: ${part}`); continue; }
  SLA[k.trim()] = Function(`return (${v})`)();
}
const SEV = {};
for (const part of sevSrc.split(',')) {
  const [k, v] = part.split(':');
  if (!k || !v) continue;
  SEV[k.trim()] = v.trim().replace(/['"]/g, '');
}

// חמש הסיבות שאינן ברירת המחדל חייבות להופיע בשם בכלל ה-severity; שתי
// הסיבות שממופות ל-medium נופלות על ברירת המחדל ואינן חייבות להופיע.
for (const [reason, severity] of Object.entries(SEV)) {
  if (severity === 'medium') continue;
  if (!rules.includes(`'${reason}'`)) {
    errors.push(`הסיבה '${reason}' (${severity}) אינה מופיעה בכלל severity ב-database.rules.json`);
  }
}
if (!rules.includes(": 'medium'")) {
  errors.push(`ברירת המחדל 'medium' אינה מופיעה בכלל severity ב-database.rules.json`);
}

// כל חלון זמן חייב להופיע בחוק כמספר מילישניות מפורש.
for (const [severity, ms] of Object.entries(SLA)) {
  if (!rules.includes(String(ms))) {
    errors.push(`חלון ה-SLA של ${severity} (${ms}ms) אינו מופיע בכלל slaDueAt ב-database.rules.json`);
  }
}

// ולהפך: מספר בחוק שאינו אחד מארבעת החלונות פירושו שהחוק והקוד נפרדו.
const inRules = (rules.match(/\? (\d{6,}) :|: (\d{6,})\)/g) || [])
  .map((m) => m.replace(/\D/g, ''));
const known = new Set(Object.values(SLA).map(String));
for (const n of inRules) {
  if (!known.has(n)) errors.push(`database.rules.json מכיל חלון ${n}ms שאינו קיים ב-REPORT_SLA_MS`);
}

// ─── כתובת מסד הבדיקות, גם היא בשני קבצים ──────────────────────────────────
// index.html בוחר לפיה לאן הדפדפן מדבר; scripts/lib/admin.js בוחר לפיה לאן
// תרגיל השחזור כותב. אם הן ייפרדו, אחד משניהם יעבוד מול המסד הלא נכון —
// ובכיוון אחד מהשניים זה אומר כתיבה על נתוני משתמשים אמיתיים.
const adminJs = fs.readFileSync('scripts/lib/admin.js', 'utf8');
const fromAdmin = (adminJs.match(/const STAGING_DB_URL = '([^']+)'/) || [])[1];
const fromHtml = (html.match(/const STAGING_DB_URL = "([^"]+)"/) || [])[1];
if (!fromAdmin) errors.push('STAGING_DB_URL לא נמצא ב-scripts/lib/admin.js');
if (!fromHtml) errors.push('STAGING_DB_URL לא נמצא ב-index.html');
if (fromAdmin && fromHtml && fromAdmin !== fromHtml) {
  errors.push(`כתובת מסד הבדיקות שונה בין הקבצים: index.html=${fromHtml} admin.js=${fromAdmin}`);
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`${Object.keys(SEV).length} סיבות, ${Object.keys(SLA).length} חלונות, וכתובת staging אחת — זהים בשני הקבצים`);
