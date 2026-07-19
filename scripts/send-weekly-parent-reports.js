// Sends the weekly parent progress-report email to every student's registered parent.
// Runs on a schedule via .github/workflows/weekly-parent-reports.yml — never call manually
// against production except for testing (workflow_dispatch), since it emails real parents.
'use strict';
const crypto = require('crypto');
const admin = require('firebase-admin');

const DB_URL = 'https://kidemy-83a17-default-rtdb.firebaseio.com';
const EMAILJS_SERVICE_ID = 'service_h1v7whg';
const EMAILJS_TEMPLATE_ID = 'template_i016jci';
const EMAILJS_PUBLIC_KEY = 'kjqdW8av2HU2kOA8W';
const EMAILJS_PRIVATE_KEY = process.env.EMAILJS_PRIVATE_KEY;
const MAX_HISTORY_LESSONS = 50;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function genToken() {
  return crypto.randomBytes(24).toString('hex').substring(0, 32);
}

function buildEmailBody(studentName, parentName, weekLessons, allLessonsCount, token) {
  const portalUrl = 'https://kidemy-app.netlify.app/?parentView=' + token;
  const sep = '━━━━━━━━━━━━━━━━━━━━━━';
  const lessonLines = weekLessons.map((l, i) => {
    let line = `${i + 1}. 📚 ${l.topic || '—'} | 👨‍🏫 ${l.teacherName || ''} | 📅 ${l.day || ''}`;
    if (l.homework) line += '\n   📎 שיעורי בית: ' + l.homework;
    if (l.notes) line += '\n   💬 הערות: ' + l.notes;
    if (l.rating) line += '\n   ⭐ דירוג: ' + l.rating + '/5';
    return line;
  }).join('\n\n');
  return `שלום ${parentName || 'הורה יקר'} 👋

הנה הדוח השבועי של ${studentName} ב-Drushe 🎓

${sep}
📅 שיעורים השבוע (${weekLessons.length} שיעורים)
${sep}
${weekLessons.length > 0 ? lessonLines : 'לא היו שיעורים השבוע.'}

${sep}
📊 סה"כ שיעורים עד כה: ${allLessonsCount}
${sep}

🔗 לצפייה בכל ההיסטוריה של ${studentName}:
${portalUrl}

הקישור תקף ל-30 יום. לא נדרשת סיסמה!

– צוות Drushe 💙`;
}

async function sendEmail(to, subject, message) {
  const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service_id: EMAILJS_SERVICE_ID,
      template_id: EMAILJS_TEMPLATE_ID,
      user_id: EMAILJS_PUBLIC_KEY,
      accessToken: EMAILJS_PRIVATE_KEY,
      template_params: { to_email: to, subject, message },
    }),
  });
  if (!res.ok) throw new Error(`EmailJS ${res.status}: ${await res.text()}`);
}

async function main() {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) throw new Error('Missing FIREBASE_SERVICE_ACCOUNT_JSON');
  if (!EMAILJS_PRIVATE_KEY) throw new Error('Missing EMAILJS_PRIVATE_KEY');

  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)),
    databaseURL: DB_URL,
  });
  const db = admin.database();

  const usersSnap = await db.ref('users').once('value');
  const usersVal = usersSnap.val() || {};
  const students = Object.entries(usersVal)
    .map(([uid, v]) => ({ uid, ...v }))
    .filter((u) => u.parentEmail && u.role !== 'teacher');

  console.log(`Found ${students.length} student(s) with a registered parent email.`);

  const weekAgo = Date.now() - WEEK_MS;
  let sent = 0, skipped = 0, errors = 0;

  for (const stu of students) {
    try {
      const progressSnap = await db.ref('studentProgress/' + stu.uid).once('value');
      const allLessons = [];
      progressSnap.forEach((c) => { allLessons.push({ id: c.key, ...c.val() }); });
      if (allLessons.length === 0) { skipped++; continue; }

      allLessons.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      const weekLessons = allLessons.filter((l) => (l.createdAt || 0) >= weekAgo);

      const token = genToken();
      await db.ref('parentTokens/' + token).set({
        uid: stu.uid,
        parentEmail: stu.parentEmail,
        studentName: stu.name || '',
        weekLessons,
        allLessons: allLessons.slice(0, MAX_HISTORY_LESSONS),
        allLessonsCount: allLessons.length,
        createdAt: Date.now(),
        expiresAt: Date.now() + TOKEN_TTL_MS,
      });

      const body = buildEmailBody(stu.name || '', stu.parentName || '', weekLessons, allLessons.length, token);
      await sendEmail(stu.parentEmail, `📊 דוח שבועי – ${stu.name || ''} | Drushe`, body);
      sent++;
      await new Promise((r) => setTimeout(r, 300));
    } catch (e) {
      console.warn('weekly report error for', stu.uid, e.message);
      errors++;
    }
  }

  console.log(`Done. sent=${sent} skipped=${skipped} errors=${errors}`);
  if (sent === 0 && errors > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
