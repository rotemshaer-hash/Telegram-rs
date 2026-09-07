// תרגיל שחזור — שבועי, אל staging בלבד.
//
// ── למה זה קיים ──
//
// עד היום היה לפרויקט גיבוי יומי מאומת, אבל **השחזור מעולם לא רץ**. גיבוי
// שאיש לא שחזר ממנו הוא הנחה: הוא נראה תקין, הוא נפרס כ-JSON, והשאלה אם
// db.ref('/').set() עליו באמת מחזיר אפליקציה עובדת נשארה לא נבדקת. הביקורת
// החיצונית ביקשה במפורש "restore-to-staging ותרגיל שחזור תקופתי", וצדקה:
// הפעם היחידה שבה כדאי לגלות ששחזור לא עובד היא לא הפעם שבה צריך אותו.
//
// ── הגבול, וזה כל העניין ──
//
// הסקריפט קורא מהייצור וכותב ל-staging. הוא לעולם לא כותב לייצור:
//   1. lib/admin.js מסרב לתת יעד staging שמצביע על פרויקט הייצור.
//   2. כאן, שוב, לפני הכתיבה — כי בדיקה אחת שנשענת על קובץ אחר היא בדיוק
//      סוג ההגנה שנשברת כשמישהו משנה את הקובץ ההוא.
// שכבה כפולה לכתיבה שדורסת מסד שלם היא לא פרנויה, היא פרופורציה.
'use strict';
const { withBothEnvs, DB_URL, PROJECT_ID } = require('./lib/admin');

const PREFIX = 'backups/';

async function newestBackup(bucket) {
  const [files] = await bucket.getFiles({ prefix: PREFIX });
  // גיבויי pre-restore אינם גיבוי יומי — הם תוצר של שחזור קודם, ולתרגיל
  // צריך את מה שהמערכת מייצרת מעצמה.
  const daily = files.filter((f) => !f.name.includes('pre-restore-'));
  if (!daily.length) throw new Error('אין גיבוי יומי לתרגל עליו.');
  daily.sort((a, b) => String(b.name).localeCompare(String(a.name)));
  return daily[0];
}

// ספירה רקורסיבית — המדד שמשווים לפניו ואחריו. לא מדפיסים תוכן: הלוג ציבורי.
function countNodes(value) {
  if (value === null || typeof value !== 'object') return 1;
  return Object.values(value).reduce((n, v) => n + countNodes(v), 1);
}

async function run({ production, staging }) {
  if (staging.dbUrl === DB_URL || staging.projectId === PROJECT_ID) {
    throw new Error('יעד התרגיל הוא הייצור. נעצר לפני הכתיבה.');
  }
  console.log(`🎯 יעד: ${staging.projectId} (מקור: ${production.projectId})`);

  const file = await newestBackup(production.bucket);
  const [buf] = await file.download();
  const data = JSON.parse(buf.toString('utf8'));
  if (!data || typeof data !== 'object' || !Object.keys(data).length) {
    throw new Error(`הגיבוי ${file.name} ריק או פגום — התרגיל נכשל כאן, וזה בדיוק מה שהוא נועד לגלות.`);
  }
  const expectedTop = Object.keys(data).length;
  const expectedNodes = countNodes(data);
  console.log(`📦 ${file.name} · ${(buf.length / 1024).toFixed(1)}KB · ${expectedTop} צמתים ראשיים · ${expectedNodes} צמתים בסך הכל`);

  await staging.db.ref('/').set(data);

  // הבדיקה האמיתית: קוראים בחזרה מ-staging ומשווים. שחזור שדיווח הצלחה
  // וכתב חלקית הוא בדיוק הכשל שהתרגיל קיים בשבילו.
  const back = (await staging.db.ref('/').once('value')).val();
  if (!back) throw new Error('אחרי השחזור staging חזר ריק.');
  const gotTop = Object.keys(back).length;
  const gotNodes = countNodes(back);
  if (gotTop !== expectedTop || gotNodes !== expectedNodes) {
    throw new Error(
      `השחזור חלקי: ${gotTop}/${expectedTop} צמתים ראשיים, ${gotNodes}/${expectedNodes} צמתים בסך הכל.`
    );
  }

  await staging.db.ref('_drill').set({
    at: Date.now(), from: file.name, topLevel: gotTop, nodes: gotNodes,
  });

  console.log(`✅ התרגיל עבר · ${gotTop} צמתים ראשיים, ${gotNodes} צמתים · אומת בקריאה חוזרת מ-staging`);
  console.log('RTO: משך הריצה הזו הוא זמן השחזור בפועל.');
}

withBothEnvs(run).catch((e) => {
  console.error('❌ תרגיל השחזור נכשל:', e.message);
  process.exitCode = 1;
});
