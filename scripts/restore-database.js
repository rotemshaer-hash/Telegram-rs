// שחזור מסד הנתונים מגיבוי.
//
// ⚠️ זהו הסקריפט המסוכן ביותר בריפו. הוא דורס את **כל** המסד. הרצה שגויה
// שלו היא בדיוק התרחיש שהגיבוי נועד למנוע, ולכן הוא בנוי כך שיהיה קשה
// להריץ אותו בטעות ובלתי אפשרי להריץ אותו "כמעט נכון":
//
//   1. חייב ALLOW_RESTORE=yes בסביבה — כדי שהרצה מקרית לא תעשה כלום.
//   2. חייב ‎--from=<שם הגיבוי המדויק> — טעות הקלדה עוצרת, לא משחזרת.
//   3. לוקח גיבוי-לפני-שחזור ראשון — כך ששחזור שגוי הוא עצמו הפיך.
//
// שימוש:
//   node scripts/list-backups.js
//   ALLOW_RESTORE=yes node scripts/restore-database.js --from=backups/2026-09-07T08-00-00Z.json
'use strict';
const { withAdmin } = require('./lib/admin');

const PREFIX = 'backups/';

function arg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

async function run({ db, bucket }) {
  if (process.env.ALLOW_RESTORE !== 'yes') {
    throw new Error('שחזור חסום. להריץ עם ALLOW_RESTORE=yes, במודע.');
  }
  const from = arg('from');
  if (!from || !from.startsWith(PREFIX)) {
    throw new Error(`חסר --from=${PREFIX}<שם הקובץ>. הרץ list-backups.js כדי לראות מה קיים.`);
  }

  const file = bucket.file(from);
  const [exists] = await file.exists();
  if (!exists) throw new Error(`הגיבוי ${from} לא נמצא.`);

  const [buf] = await file.download();
  const data = JSON.parse(buf.toString('utf8'));
  if (!data || typeof data !== 'object' || !Object.keys(data).length) {
    throw new Error('הגיבוי ריק או פגום. לא משחזרים ממנו.');
  }

  // גיבוי-לפני-שחזור. אם מתברר שהשחזור היה מהקובץ הלא נכון, יש לאן לחזור.
  const before = await db.ref('/').once('value');
  const beforeJson = JSON.stringify(before.val() || {});
  const safety = `${PREFIX}pre-restore-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}Z.json`;
  await bucket.file(safety).save(beforeJson, {
    contentType: 'application/json',
    metadata: { cacheControl: 'no-store' },
  });
  console.log(`🛟 המצב הנוכחי נשמר ב-${safety} (${(beforeJson.length / 1024).toFixed(1)}KB)`);

  await db.ref('/').set(data);
  console.log(`✅ שוחזר מ-${from} · ${Object.keys(data).length} צמתים ראשיים`);
  console.log('בדוק את האפליקציה עכשיו. אם משהו לא נכון — שחזר מ-' + safety);
}

withAdmin(run).catch((e) => {
  console.error('❌ השחזור לא בוצע:', e.message);
  process.exitCode = 1;
});
