// מציג אילו גיבויים קיימים. הצעד הראשון בכל שחזור — כדי שהשם שנמסר
// ל-restore-database.js יהיה מועתק ולא מנוחש.
'use strict';
const { withAdmin } = require('./lib/admin');

const PREFIX = 'backups/';

withAdmin(async ({ bucket }) => {
  const [files] = await bucket.getFiles({ prefix: PREFIX });
  if (!files.length) {
    console.log('אין גיבויים. אם זו לא ההרצה הראשונה — זו תקלה.');
    return;
  }
  files
    .sort((a, b) => String(b.name).localeCompare(String(a.name)))
    .forEach((f) => {
      const kb = (Number(f.metadata?.size || 0) / 1024).toFixed(1);
      console.log(`${f.name}  ${kb}KB  ${f.metadata?.timeCreated || ''}`);
    });
  console.log(`\nסה"כ ${files.length} גיבויים.`);
}).catch((e) => {
  console.error('❌', e.message);
  process.exitCode = 1;
});
