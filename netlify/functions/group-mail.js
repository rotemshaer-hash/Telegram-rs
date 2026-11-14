// Drushe — מייל להורה כשהילד מתקבל (או נדחה) לקבוצה ספציפית, נשלח מהשרת.
//
// עד עכשיו קבלה לקבוצה הייתה מייצרת רק התראה בתוך האפליקציה (groupApproved/groupRejected ב-notify.js). בניגוד
// להזמנת שיעור, שבה ההורה תמיד מקבל מייל עם זמן, מורה וקישור — כאן ההורה לא היה שומע כלום על מפגש קבוצתי
// ספציפי, כולל מפגשים שחלקם פיזיים, אלא אם כן נכנס בעצמו לחשבון הילד.
//
// אותו דפוס בדיוק כמו lesson-mail.js: המורה אומר רק "הילד הזה בקבוצה הזו אושר/נדחה", והשרת — מזוהה לפי idToken,
// לא לפי מה שהמורה כותב — בודק שזו באמת הקבוצה שלו ושזה באמת המצב שנכתב, קורא את כתובת ההורה מהרשומה (לא מהבקשה),
// ושולח נוסח קבוע. מייל אחד לכל (קבוצה, ילד, אירוע).

const { admin, initAdmin } = require('../lib/firebase-admin-init');
const { sendViaEmailJS } = require('../lib/emailjs');
const ALLOWED_ORIGINS = require('../lib/allowed-origins');
const { FAKE_DOMAIN } = require('../lib/internal-email');
const { withinWindowLimit } = require('../lib/rate-limit');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ID_RE = /^[-A-Za-z0-9_]{1,128}$/;
const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const EVENTS = { approved: 'approved', rejected: 'rejected', cancelled: 'approved' };
const ADMIN_EMAIL = 'rotemshaer@gmail.com';

const clip = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);

function compose(event, g, child, parentName, link) {
  const parent = clip(parentName, 60) || 'הורה יקר';
  const kid = clip(child, 60);
  const title = clip(g.title, 80) || 'קבוצה';
  const teacher = clip(g.teacherName, 60);
  if (event === 'approved') {
    const where = clip(g.location, 120);
    const when = [clip(g.day, 40), clip(g.time, 20)].filter(Boolean).join(' בשעה ');
    return {
      subject: `✅ ${kid} התקבל/ה לקבוצה "${title}" — Drushe`,
      body: `שלום ${parent} 👋\n\n${kid} התקבל/ה לקבוצה "${title}"${teacher ? ' של ' + teacher : ''}.\n\n${when ? '📅 ' + when + '\n' : ''}${where ? '📍 ' + where + '\n' : ''}\nחלק מהקבוצות נפגשות פיזית, ללא נוכחות הורים. כל קבוצה מאושרת על ידי צוות Drushe לפני שהיא מתפרסמת.\n\nניתן לעקוב באפליקציה:\n${link}\n\n– צוות Drushe 💙`,
    };
  }
  if (event === 'cancelled') {
    // ההורה כבר קיבל מייל עם המקום והשעה. בלי המייל הזה הילד עלול להגיע למקום
    // ואף אחד לא יהיה שם, וההורה לא יידע שהמפגש בוטל (ביקורת רגולציה 11.11.2026).
    const when = [clip(g.day, 40), clip(g.time, 20)].filter(Boolean).join(' בשעה ');
    return {
      subject: `חשוב: הקבוצה "${title}" בוטלה — Drushe`,
      body: `שלום ${parent} 👋\n\nהקבוצה "${title}"${teacher ? ' של ' + teacher : ''}, ש-${kid} היה/תה רשום/ה אליה, בוטלה.\n\n${when ? '📅 המפגש ב' + when + ' לא יתקיים.\n' : 'המפגש הקרוב לא יתקיים.\n'}\nכדאי לוודא ש-${kid} יודע/ת, כדי שלא יגיע/תגיע למקום.\n\nאפשר למצוא קבוצות אחרות באפליקציה:\n${link}\n\n– צוות Drushe 💙`,
    };
  }
  return {
    subject: `${kid} — הבקשה להצטרפות לקבוצה "${title}" — Drushe`,
    body: `שלום ${parent} 👋\n\nהבקשה של ${kid} להצטרף לקבוצה "${title}" לא התקבלה הפעם.\n\nניתן לחפש קבוצות אחרות באפליקציה:\n${link}\n\n– צוות Drushe 💙`,
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
  const groupId = String(body.groupId || '');
  const childUid = String(body.uid || '');
  if (!kind || !ID_RE.test(groupId) || !ID_RE.test(childUid)) return reply(400, { error: 'Invalid request' });
  if (!body.idToken) return reply(401, { error: 'idToken is required' });

  let uid; let email;
  try {
    initAdmin();
    const decoded = await admin.auth().verifyIdToken(body.idToken);
    uid = decoded.uid; email = decoded.email;
  } catch (_e) {
    return reply(401, { error: 'invalid or expired session' });
  }

  try {
    const db = admin.database();
    if (!(await withinWindowLimit(db, 'groupMailRateLimit', uid, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS))) {
      return reply(429, { error: 'Too many requests' });
    }

    const [verified, blocked] = await Promise.all([
      db.ref('users/' + uid + '/verified').get(),
      db.ref('userBlocks/' + uid).get(),
    ]);
    if (verified.val() !== true || blocked.exists()) return reply(403, { error: 'account is not active' });

    const g = (await db.ref('groups/' + groupId).get()).val();
    if (!g) return reply(403, { error: 'no such group' });
    // ביטול יכול להגיע גם מהמנהל, שמשעה קבוצה שאינה שלו.
    const isAdmin = String(email || '').toLowerCase() === ADMIN_EMAIL;
    if (g.teacherId !== uid && !(kind === 'cancelled' && isAdmin)) return reply(403, { error: 'not your group' });
    if (kind === 'cancelled' && g.status !== 'closed' && g.status !== 'cancelled') {
      return reply(409, { error: 'that group is still active' });
    }

    const memberStatus = (await db.ref('groupMembers/' + groupId + '/' + childUid + '/status').get()).val();
    if (memberStatus !== EVENTS[kind]) return reply(409, { error: 'member is not ' + EVENTS[kind] });

    const [parentEmail, parentName, name] = await Promise.all(
      ['parentEmail', 'parentName', 'name'].map(async (k) => (await db.ref('users/' + childUid + '/' + k).get()).val())
    );
    // הכתובת ש-parent-consent נעלה בשרת קודמת לכתובת ברשומת המשתמש, שהילד עורך בעצמו
    const locked = (await db.ref('parentContact/' + childUid + '/email').get()).val();
    const to = String(locked || parentEmail || '').trim();
    if (!EMAIL_RE.test(to) || to.toLowerCase().endsWith(FAKE_DOMAIN)) return reply(200, { ok: true, sent: false });

    // מייל אחד לכל (קבוצה, ילד, אירוע) — הטרנזקציה נכשלת אם כבר נשלח
    const claim = await db.ref('groupMailSent/' + groupId + '_' + childUid + '_' + kind).transaction((cur) => (cur ? undefined : Date.now()));
    if (!claim.committed) return reply(200, { ok: true, sent: false, duplicate: true });

    const { subject, body: text } = compose(kind, g, name, parentName, ALLOWED_ORIGINS[0]);
    try {
      await sendViaEmailJS(to, subject, text);
    } catch (mailErr) {
      console.error('[group-mail] send failed:', mailErr.message);
      await db.ref('groupMailSent/' + groupId + '_' + childUid + '_' + kind).remove().catch(() => {});
      await db.ref('adminNotifs').push({
        type: 'groupMailFailed', from: clip(g.teacherName, 60), groupId, event: kind,
        error: String(mailErr.message).slice(0, 200), read: false, createdAt: Date.now(),
      });
      return reply(502, { error: 'mail_failed' });
    }
    return reply(200, { ok: true, sent: true });
  } catch (err) {
    console.error('[group-mail]', err);
    return reply(500, { error: 'server_error' });
  }
};
