// Drushe — מיילים על שיעור, נשלחים מהשרת: להורה (אושר / נדחה / הושלם) ולמורה (הזמנה חדשה).
//
// למה זה לא נשלח מהלקוח של המורה: כדי לשלוח אותו הלקוח של המורה היה צריך את
// מייל ההורה, ולכן הוא נכתב לתוך רשומת ההזמנה (studentEmail, parentEmail,
// parentName) — שדות שהמורה קורא. מורה בן 14–18 קיבל כך את הכתובת של הילד ושל
// ההורה שלו, בלי שום צורך בהם. עכשיו הכתובת לא יוצאת מהמסד: המורה אומר רק
// "ההזמנה הזו אושרה/נדחתה/הושלמה", והשרת — שמזהה אותו לפי idToken ולא לפי מה
// שהוא כותב — בודק שזו באמת ההזמנה שלו ובאמת במצב הזה, קורא את הכתובת מהרשומה
// של התלמיד, ושולח נוסח קבוע.
//
// כל מה שבגוף המייל נקרא מהמסד (הזמנה, סיכום שיעור, רשומת התלמיד), לא מהבקשה.
// מייל אחד לכל הזמנה ואירוע: אי אפשר להציף הורה בקריאה חוזרת.

const { admin, initAdmin } = require('../lib/firebase-admin-init');
const { sendViaEmailJS } = require('../lib/emailjs');
const ALLOWED_ORIGINS = require('../lib/allowed-origins');
const { FAKE_DOMAIN } = require('../lib/internal-email');
const { withinWindowLimit } = require('../lib/rate-limit');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
// requested: מיילים את המורה (מהתלמיד שהזמין); השאר: מיילים את ההורה (מהמורה)
const EVENTS = { requested: 'pending', approved: 'approved', rejected: 'rejected', completed: 'completed' };

const clip = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);

function composeRequested(b, link) {
  return {
    subject: `📅 הזמנה חדשה — ${clip(b.studentName, 60) || 'תלמיד'} — Drushe`,
    body: `שלום,\n\nיש לך הזמנה חדשה:\n\n👤 תלמיד: ${clip(b.studentName, 60)}\n📅 ${clip(b.day, 40)} בשעה ${clip(b.time, 20)}\n💰 מחיר השיעור: ${Number(b.price) > 0 ? '₪' + Number(b.price) : 'חינם (שיעור ניסיון)'}\n\nכנס לאפליקציה כדי לאשר את ההזמנה:\n(את התשלום מתאמים ישירות עם התלמיד — Drushe אינה מעורבת בו)\n${link}\n\n– צוות Drushe`,
  };
}

function compose(event, b, stu, summary, link) {
  const parent = clip(stu.parentName, 60) || 'הורה יקר';
  const child = clip(stu.name || b.studentName, 60);
  const teacher = clip(b.teacherName, 60);
  const day = clip(b.day, 40);
  const time = clip(b.time, 20);
  if (event === 'approved') {
    const url = /^https?:\/\//i.test(b.jitsiUrl || '') ? clip(b.jitsiUrl, 300) : '';
    return {
      subject: `✅ שיעור אושר – ${child}`,
      body: `שלום ${parent} 👋\n\nהשיעור של ${child} אושר!\n\n👨‍🏫 מורה: ${teacher}\n📅 יום: ${day}\n🕐 שעה: ${time}\n${url ? '🔗 קישור לשיעור: ' + url : ''}\n\nניתן לעקוב באפליקציה:\n${link}\n\n– צוות Drushe 💙`,
    };
  }
  if (event === 'rejected') {
    return {
      subject: `❌ שיעור נדחה – ${child}`,
      body: `שלום ${parent} 👋\n\nלצערנו, השיעור של ${child} נדחה ע"י המורה.\n\n👨‍🏫 מורה: ${teacher}\n📅 יום: ${day}\n🕐 שעה: ${time}\n\nניתן להזמין שיעור אחר באפליקציה:\n${link}\n\n– צוות Drushe 💙`,
    };
  }
  const topic = clip(summary.topic, 200);
  const notes = clip(summary.notes, 1000);
  const homework = clip(summary.homework, 1000);
  return {
    subject: `✅ שיעור הושלם – ${child} | Drushe`,
    body: `שלום ${parent} 👋\n\nהשיעור של ${child} הסתיים בהצלחה! 🎓\n\n👨‍🏫 מורה: ${teacher}\n📅 תאריך: ${day}\n📚 נושא: ${topic}${notes ? '\n💬 הערות: ' + notes : ''}${homework ? '\n\n📎 שיעורי בית:\n' + homework : ''}\n\n💡 תזכורת: תוכלו להתחבר בכל עת עם שם המשתמש והסיסמה של ${child || 'הילד/ה'} כדי לראות את כל ההיסטוריה, השיחות וההזמנות.\n\n– צוות Drushe 💙`,
  };
}

exports.handler = async (event) => {
  const origin = event.headers.origin || event.headers.Origin || '';
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
  const reply = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_e) { return reply(400, { error: 'Invalid JSON' }); }

  const kind = Object.prototype.hasOwnProperty.call(EVENTS, body.event) ? body.event : null;
  const bookingId = String(body.bookingId || '');
  if (!kind || !/^[-A-Za-z0-9_]{1,40}$/.test(bookingId)) return reply(400, { error: 'Invalid request' });
  if (!body.idToken) return reply(401, { error: 'idToken is required' });

  let uid;
  try {
    initAdmin();
    uid = (await admin.auth().verifyIdToken(body.idToken)).uid;
  } catch (_e) {
    return reply(401, { error: 'invalid or expired session' });
  }

  try {
    const db = admin.database();
    if (!(await withinWindowLimit(db, 'lessonMailRateLimit', uid, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS))) {
      return reply(429, { error: 'Too many requests' });
    }

    // אותו תנאי כמו בחוקי הנתונים: רק משתמש מאושר ולא חסום שולח מייל בשם Drushe
    const [verified, blocked] = await Promise.all([
      db.ref('users/' + uid + '/verified').get(),
      db.ref('userBlocks/' + uid).get(),
    ]);
    if (verified.val() !== true || blocked.exists()) return reply(403, { error: 'account is not active' });

    const b = (await db.ref('bookings/' + bookingId).get()).val();
    if (!b) return reply(403, { error: 'no such booking' });
    // הזמנה שבה אותו אדם הוא גם התלמיד וגם המורה היא דרך להפעיל את המייל מול כתובת שהוא בחר
    if (b.studentId === b.teacherId) return reply(409, { error: 'invalid booking' });
    if (!(await db.ref('teachers/' + b.teacherId).get()).exists()) return reply(409, { error: 'no such teacher' });
    const byStudent = kind === 'requested';
    if ((byStudent ? b.studentId : b.teacherId) !== uid) return reply(403, { error: 'not your booking' });
    if (b.status !== EVENTS[kind]) return reply(409, { error: 'booking is not ' + EVENTS[kind] });
    if (!b.studentId) return reply(409, { error: 'no student' });

    // המקבל: המורה (הכתובת שלו נקראת מ-teacherPrivate, שרק הוא והשרת קוראים) או ההורה
    let to = '';
    let stu = {};
    if (byStudent) {
      const priv = (await db.ref('teacherPrivate/' + b.teacherId).get()).val() || {};
      to = String(priv.notificationEmail || priv.email || '').trim();
    } else {
      // שלושה שדות בלבד — לא כל הרשומה (ברשומות ישנות יש בה תמונות base64)
      const [parentEmail, parentName, name] = await Promise.all(
        ['parentEmail', 'parentName', 'name'].map(async (k) => (await db.ref('users/' + b.studentId + '/' + k).get()).val())
      );
      stu = { parentEmail, parentName, name };
      // הכתובת ש-parent-consent נעלה בשרת קודמת לכתובת ברשומת המשתמש, שהילד עורך בעצמו
      const locked = (await db.ref('parentContact/' + b.studentId + '/email').get()).val();
      to = String(locked || stu.parentEmail || '').trim();
    }
    if (!EMAIL_RE.test(to) || to.toLowerCase().endsWith(FAKE_DOMAIN)) return reply(200, { ok: true, sent: false });

    const summary = kind === 'completed'
      ? ((await db.ref('teacherSummaries/' + uid + '/' + bookingId).get()).val() || {})
      : {};

    // מייל אחד לכל הזמנה ואירוע — הטרנזקציה נכשלת אם כבר נשלח
    const claim = await db.ref('lessonMailSent/' + bookingId + '_' + kind).transaction((cur) => (cur ? undefined : Date.now()));
    if (!claim.committed) return reply(200, { ok: true, sent: false, duplicate: true });

    const { subject, body: text } = byStudent ? composeRequested(b, ALLOWED_ORIGINS[0]) : compose(kind, b, stu, summary, ALLOWED_ORIGINS[0]);
    try {
      await sendViaEmailJS(to, subject, text);
    } catch (mailErr) {
      console.error('[lesson-mail] send failed:', mailErr.message);
      await db.ref('lessonMailSent/' + bookingId + '_' + kind).remove().catch(() => {});
      await db.ref('adminNotifs').push({
        type: 'lessonMailFailed', from: clip(b.teacherName, 60), bookingId, event: kind,
        error: String(mailErr.message).slice(0, 200), read: false, createdAt: Date.now(),
      });
      return reply(502, { error: 'mail_failed' });
    }
    return reply(200, { ok: true, sent: true });
  } catch (err) {
    console.error('[lesson-mail]', err);
    return reply(500, { error: 'server_error' });
  }
};
