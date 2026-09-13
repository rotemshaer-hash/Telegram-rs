// ניטור — הפריט האחרון ברשימת החוסמים שאפשר לסגור בלי הבעלים.
//
// ── מה "ניטור אמיתי" אומר כאן ──
//
// הביקורת ביקשה alerts על כשלי פונקציות, על דחיות חוקים, על מכסת ה-AI, על
// חריגת SLA במודרציה, ועל כשלי מייל/push/פריסה. חלק מזה דורש תשתית שאין
// (Cloud Logging, ניתוח rules denials), אבל **רוב האותות כבר קיימים במסד** —
// האפליקציה כותבת אותם, ופשוט איש לא הסתכל.
//
// לכן זה לא בונה מערך ניטור. הוא קורא את מה שכבר נכתב, ומחליט מה חורג.
//
// ── למה Issue ולא מייל ──
//
// כי הבעלים עובד מטלפון, GitHub כבר שולח לו התראה, ויש כבר שני מקומות
// בפרויקט שפותחים Issue בכישלון. ערוץ שלישי היה מוסיף מקום נוסף לפספס.
//
// ── הכלל שקובע אם משהו נכשל בשקט ──
//
// גיבוי שלא רץ אתמול הוא ממצא. דיווח בטיחות שחרג מה-SLA הוא ממצא. שגיאות
// לקוח שקפצו הן ממצא. הכל נמדד מול הנתונים, לא מול תחושה, ומודפס כמספרים
// בלבד — הלוג ציבורי, והרשומות האלה נושאות שמות של קטינים.
'use strict';
const { withAdmin } = require('./lib/admin');

const DAY = 24 * 3600 * 1000;
// ברירת המחדל של התקרה היומית ב-netlify/functions/ai-assistant.js. משמשת רק
// כשאין ערך ב-adminConfig/aiDailyMax, בדיוק כמו שם.
const AI_DAILY_DEFAULT = 1500;

// חלונות הטיפול לפי חומרה — חייבים להישאר זהים ל-REPORT_SLA_MS ב-index.html.
// check-severity-ssot.js כבר אוכף את השוויון הזה מול database.rules.json,
// וכאן משתמשים ב-slaDueAt שהאפליקציה כבר חישבה ושהחוקים כבר אימתו, במקום
// לחשב מחדש ולהמציא עותק שלישי.

function severityRank(s) {
  return { critical: 3, high: 2, medium: 1, low: 0 }[s] ?? 1;
}

async function run({ db, bucket }) {
  const now = Date.now();
  const findings = [];
  const notes = [];

  // ── 1. הגיבוי: האם יש גיבוי מהיממה האחרונה ──
  // גיבוי שנכשל בשקט גרוע מאין גיבוי, כי הוא נותן ביטחון שאין לו כיסוי.
  // ה-workflow פותח Issue כשהוא נופל — אבל לא כשהוא **לא רץ בכלל**.
  try {
    const [files] = await bucket.getFiles({ prefix: 'backups/' });
    const daily = files.filter((f) => !f.name.includes('pre-restore-'));
    const newest = daily
      .map((f) => Date.parse(f.metadata?.timeCreated || ''))
      .filter(Number.isFinite)
      .sort((a, b) => b - a)[0];
    if (!newest) {
      findings.push('אין אף גיבוי בדלי.');
    } else {
      const ageH = Math.round((now - newest) / 3600000);
      if (ageH > 30) findings.push(`הגיבוי האחרון בן ${ageH} שעות — הריצה היומית לא עבדה.`);
      else notes.push(`גיבוי אחרון: לפני ${ageH} שעות`);
    }
  } catch (e) {
    findings.push(`לא ניתן לקרוא את דלי הגיבויים: ${e.message}`);
  }

  // ── 2. דיווחי בטיחות שחרגו מה-SLA ──
  // ההבטחה למשתמש היא זמן טיפול לפי חומרה. באנר בפאנל הניהול מראה חריגה,
  // אבל רק למי שפותח את הפאנל. דיווח קריטי שחרג הוא ילד שממתין לתשובה.
  const reports = (await db.ref('reports').once('value')).val() || {};
  const open = Object.values(reports).filter((r) => r && r.status === 'open');
  const breached = open.filter((r) => r.slaDueAt && now > r.slaDueAt);
  if (breached.length) {
    const worst = breached.sort((a, b) => severityRank(b.severity) - severityRank(a.severity))[0];
    findings.push(
      `${breached.length} דיווחים חרגו מיעד הטיפול (החמור ביותר: ${worst.severity || 'medium'}).`
    );
  }
  const criticalOpen = open.filter((r) => r.severity === 'critical').length;
  if (criticalOpen) notes.push(`${criticalOpen} דיווחים קריטיים פתוחים`);
  notes.push(`${open.length} דיווחים פתוחים בסך הכל`);

  // ── 3. מכסת ה-AI ומתג הכיבוי ──
  const cfg = (await db.ref('adminConfig').once('value')).val() || {};
  if (cfg.aiEnabled === false) notes.push('⚠️ עוזר ה-AI כבוי');
  const usage = (await db.ref('aiUsage').once('value')).val() || {};
  const today = new Date().toISOString().slice(0, 10);
  // aiUsage/<YYYY-MM-DD> = {count, updatedAt, alerted} — נכתב ב-
  // netlify/functions/ai-assistant.js, ו-todayKey() שם הוא UTC כמו כאן.
  const usedToday = Number(usage?.[today]?.count || 0);
  const cap = Number(cfg.aiDailyMax || AI_DAILY_DEFAULT);
  if (usedToday >= cap) findings.push(`תקרת ה-AI היומית מוצתה: ${usedToday}/${cap}.`);
  else if (usedToday >= cap * 0.8) findings.push(`ה-AI עבר 80% מהתקרה: ${usedToday}/${cap}.`);
  else if (usedToday) notes.push(`AI היום: ${usedToday}/${cap}`);

  // ── 4. שגיאות לקוח ביממה האחרונה ──
  // האפליקציה כותבת כל שגיאת JS שלא נתפסה. עד היום איש לא קרא את זה אלא
  // אם נכנס לפאנל — כלומר קריסה אצל משתמשים יכלה להימשך ימים בלי שאיש ידע.
  const errs = (await db.ref('clientErrors').once('value')).val() || {};
  // השדה הוא createdAt — זה מה ש-_reportClientError כותב ב-index.html.
  const recent = Object.values(errs).filter((e) => e && Number(e.createdAt) > now - DAY);
  if (recent.length >= 25) findings.push(`${recent.length} שגיאות לקוח ב-24 השעות האחרונות.`);
  else if (recent.length) notes.push(`${recent.length} שגיאות לקוח ב-24 שעות`);

  // ── 5. כשלים בשליחה שהאפליקציה כבר מדווחת עליהם למנהל ──
  const adminNotifs = (await db.ref('adminNotifs').once('value')).val() || {};
  const failKinds = ['chatDeliveryFailed', 'registrationFailed', 'idPhotoUploadFailed'];
  const fails = Object.values(adminNotifs).filter(
    (n) => n && failKinds.includes(n.type) && Number(n.createdAt) > now - DAY
  );
  if (fails.length) findings.push(`${fails.length} כשלי מסירה/הרשמה/העלאה ב-24 שעות.`);

  // ── דוח ──
  console.log('— מצב —');
  for (const n of notes) console.log(`  · ${n}`);
  if (!findings.length) {
    console.log('\n✅ אין ממצאים.');
    return;
  }
  console.log(`\n🚨 ${findings.length} ממצאים:`);
  for (const f of findings) console.log(`  • ${f}`);
  // הכישלון הוא מכוון: הוא מה שפותח את ה-Issue ושולח את ההתראה.
  const err = new Error(findings.join(' | '));
  err.findings = findings;
  throw err;
}

withAdmin(run).catch((e) => {
  console.error('❌', e.message);
  process.exitCode = 1;
});
