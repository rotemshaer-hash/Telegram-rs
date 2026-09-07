// Drushe — כתיבת התראות. הדרך היחידה שבה משתמש אחד יכול להתריע לאחר.
//
// מה שהיה, ולמה זה נסגר: החוק על notifications/$uid/$notifId היה
// ‎".write": "auth != null" — כלומר כל משתמש מחובר, כולל אורח אנונימי, יכול
// היה לכתוב התראה בפיד של כל משתמש אחר שה-uid שלו ידוע לו (ו-uid של מורה
// גלוי לכל מחובר). ה-‎.validate הגביל את *צורת* האובייקט ואת ה-type לרשימה
// סגורה — אבל ברשימה הזו יש 'adminMessage', ותוכן ההתראה לא הוגבל בכלל.
// כלומר אפשר היה לשלוח לקטין ספציפי הודעה שנראית ככה: 📣 "הודעה מהמנהל".
// באפליקציה שבה מבוגרים מתכתבים עם קטינים, התחזות להנהלה היא בדיוק הווקטור
// שממנו רוצים להימנע.
//
// העיקרון כאן זהה ל-send-push.js: **השרת לא מאמין ללקוח.** הלקוח לא אומר מי
// הוא — הוא שולח idToken, והשרת יודע. והלקוח לא אומר "מותר לי להתריע לזה" —
// השרת קורא את הרשומה שעליה ההתראה מדברת (הזמנה, שיחה, קבוצה, דרוש, שאלה)
// ומוודא ששני הצדדים הם באמת שני הצדדים שלה.
//
// שם השולח נגזר תמיד בשרת מ-users/<uid>/name ולא מהמטען, כי הוא מה שמוצג
// כזהות בפיד — וזה החלק שאסור שיהיה ניתן לזיוף.

const { admin, initAdmin } = require('../lib/firebase-admin-init');

const ADMIN_EMAIL = 'rotemshaer@gmail.com';

// נדיב לשימוש אמיתי (כל הודעה בצ'אט מייצרת התראה), נמוך מספיק כדי שהצפה
// של פיד של מישהו אחר תיעצר.
const RATE_LIMIT_MAX = 120;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

// חלון שבו הודעה נחשבת "נשלחה עכשיו". מונע שיגור חוזר של התראה על הודעה
// ישנה כדי להציק — אותו שיקול בדיוק כמו ב-send-push.js.
const RECENT_MESSAGE_MS = 120 * 1000;

// ── מה מותר לעבור מהלקוח ──────────────────────────────────────────────────
// טקסט חופשי מוגבל באורך. הוא לא מסוכן יותר ממה שהשולח יכול לכתוב בצ'אט
// ממילא — אבל הוא כן חייב תקרה, אחרת אפשר לדחוף מסמך שלם לפיד.
const TEXT_FIELDS = {
  preview: 140, message: 300, groupTitle: 80, teacherName: 60,
  studentName: 60, childName: 60, day: 40, time: 20, targetName: 60,
};
const ID_FIELDS = ['bookingId', 'groupId', 'teacherId', 'teacherUid', 'briefId', 'qaId'];
const NUM_FIELDS = ['price', 'amount', 'daysLeft', 'stars', 'ts'];

const BOOKING_TYPES = ['newBooking', 'bookingApproved', 'bookingRejected', 'bookingCancelled', 'lessonSummary', 'rateLesson', 'lessonCompleted'];
const GROUP_TYPES = ['groupJoin', 'groupApproved', 'groupRejected'];
const QA_TYPES = ['newQuestion', 'questionAnswered'];
const BRIEF_TYPES = ['briefProposal', 'briefAccepted'];
// אלה נשלחות רק על ידי המנהל. הן מדברות בשם הפלטפורמה, ולכן משתמש רגיל
// שמנסה לשלוח אחת מהן נדחה — זה הליבה של התיקון הזה.
const ADMIN_TYPES = ['adminMessage', 'accountApproved', 'teacherApproved', 'studentApproved', 'newTeacher', 'newUser', 'newVideo', 'newPost', 'newReview', 'newReport', 'newStory'];

async function withinRateLimit(db, uid) {
  const ref = db.ref('notifyRateLimit/' + uid);
  const now = Date.now();
  const result = await ref.transaction((cur) => {
    if (!cur || now - (cur.windowStart || 0) > RATE_LIMIT_WINDOW_MS) {
      return { windowStart: now, count: 1 };
    }
    return { windowStart: cur.windowStart, count: (cur.count || 0) + 1 };
  });
  return (result.snapshot.val()?.count || 0) <= RATE_LIMIT_MAX;
}

// שני הצדדים של ההתראה חייבים להיות בדיוק שני הצדדים של ההזמנה — בלי קשר
// לכיוון, כי גם המורה מתריע לתלמיד וגם להפך.
function isBookingPair(booking, a, b) {
  if (!booking) return false;
  const s = booking.studentId, t = booking.teacherId;
  return (s === a && t === b) || (s === b && t === a);
}

function getChatId(a, b) {
  return [a, b].sort().join('_');
}

async function verifyRelationship(db, { type, fromUid, toUid, ctx }) {
  if (BOOKING_TYPES.includes(type)) {
    if (!ctx.bookingId) return 'bookingId is required';
    const booking = (await db.ref('bookings/' + ctx.bookingId).get()).val();
    if (!isBookingPair(booking, fromUid, toUid)) return 'not a party to that booking';
    return null;
  }

  if (type === 'newMessage') {
    // חייבת להיות הודעה אמיתית, מהשולח, שנשלחה ממש עכשיו.
    const chatId = getChatId(fromUid, toUid);
    const snap = await db.ref('messages/' + chatId).orderByKey().limitToLast(1).get();
    let last = null;
    snap.forEach((c) => { last = c.val(); });
    if (!last || last.from !== fromUid) return 'no recent message from you in that chat';
    if (Date.now() - (last.createdAt || 0) > RECENT_MESSAGE_MS) return 'no recent message from you in that chat';
    return null;
  }

  if (GROUP_TYPES.includes(type)) {
    if (!ctx.groupId) return 'groupId is required';
    const group = (await db.ref('groups/' + ctx.groupId).get()).val();
    if (!group) return 'group not found';
    if (type === 'groupJoin') {
      // המצטרף מתריע לבעל הקבוצה, ולא לאף אחד אחר.
      if (toUid !== group.teacherId) return 'that group belongs to someone else';
    } else if (fromUid !== group.teacherId) {
      // אישור/דחייה — רק בעל הקבוצה.
      return 'only the group owner may approve or reject';
    }
    return null;
  }

  if (QA_TYPES.includes(type)) {
    const teacherUid = ctx.teacherUid || ctx.teacherId;
    if (!teacherUid) return 'teacherUid is required';
    if (!(await db.ref('teachers/' + teacherUid).get()).exists()) return 'teacher not found';
    if (type === 'newQuestion' && toUid !== teacherUid) return 'questions notify the teacher only';
    if (type === 'questionAnswered' && fromUid !== teacherUid) return 'only the teacher answers';
    return null;
  }

  if (BRIEF_TYPES.includes(type)) {
    if (!ctx.briefId) return 'briefId is required';
    const brief = (await db.ref('parentBriefs/' + ctx.briefId).get()).val();
    if (!brief) return 'brief not found';
    if (type === 'briefProposal' && toUid !== brief.parentUid) return 'that brief belongs to someone else';
    if (type === 'briefAccepted' && fromUid !== brief.parentUid) return 'only the brief owner accepts';
    return null;
  }

  if (type === 'referralJoined') {
    // הרשומה נכתבת פעם אחת בלבד על ידי המשתמש המופנה (ראה referrals
    // ב-database.rules.json), ולכן היא ראיה מספקת שההפניה אמיתית.
    if (!(await db.ref('referrals/' + toUid + '/' + fromUid).get()).exists()) {
      return 'no referral from you to that user';
    }
    return null;
  }

  if (type === 'trialReminder') {
    if (fromUid !== toUid) return 'trialReminder is a reminder to yourself';
    return null;
  }

  if (ADMIN_TYPES.includes(type)) return 'that notification type is admin-only';
  return 'unknown notification type';
}

// בונה את ההתראה. שדות הזהות נגזרים בשרת; מהלקוח עוברים רק שדות תצוגה
// מוגבלים באורך ובסוג.
function buildNotification(type, fromUid, senderName, ctx, isAdminCaller) {
  const notif = { type, read: false, createdAt: Date.now() };
  if (type !== 'trialReminder') {
    notif.fromUid = fromUid;
    notif.from = senderName;
  }
  // המנהל מדבר בשם הפלטפורמה ולא בשם עצמו — "מורה חדש נרשם" מציג את שם
  // המורה, לא את שם המנהל.
  if (isAdminCaller && typeof ctx.from === 'string') notif.from = ctx.from.slice(0, 60);

  for (const [field, max] of Object.entries(TEXT_FIELDS)) {
    if (typeof ctx[field] === 'string' && ctx[field]) notif[field] = ctx[field].slice(0, max);
  }
  for (const field of ID_FIELDS) {
    if (typeof ctx[field] === 'string' && ctx[field]) notif[field] = ctx[field].slice(0, 128);
  }
  for (const field of NUM_FIELDS) {
    if (typeof ctx[field] === 'number' && Number.isFinite(ctx[field])) notif[field] = ctx[field];
  }
  return notif;
}

exports.handler = async (event) => {
  const ALLOWED_ORIGINS = [
    'https://kidemy-app.netlify.app',
    'capacitor://localhost',
    'http://localhost',
  ];
  const origin = event.headers.origin || event.headers.Origin || '';
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (_e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { idToken, toUid, type } = body;
  const ctx = body.ctx && typeof body.ctx === 'object' ? body.ctx : {};
  if (!idToken) return { statusCode: 401, headers, body: JSON.stringify({ error: 'idToken is required' }) };
  if (typeof toUid !== 'string' || !toUid || toUid.length > 128) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'toUid is required' }) };
  }
  if (typeof type !== 'string' || !type) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'type is required' }) };
  }

  let fromUid, callerEmail;
  try {
    initAdmin();
    const decoded = await admin.auth().verifyIdToken(idToken);
    fromUid = decoded.uid;
    callerEmail = decoded.email || '';
  } catch {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'invalid or expired session' }) };
  }

  try {
    const db = admin.database();
    if (!(await withinRateLimit(db, fromUid))) {
      return { statusCode: 429, headers, body: JSON.stringify({ error: 'too many notifications' }) };
    }

    // המנהל עובר את בדיקת היחסים — הוא הצד שמאשר, דוחה ומודיע בשם
    // הפלטפורמה, ואין רשומת "יחסים" שמתארת את זה.
    const isAdminCaller = callerEmail === ADMIN_EMAIL;
    if (!isAdminCaller) {
      const problem = await verifyRelationship(db, { type, fromUid, toUid, ctx });
      if (problem) {
        return { statusCode: 403, headers, body: JSON.stringify({ error: problem }) };
      }
    }

    let senderName = '';
    try {
      senderName = (await db.ref('users/' + fromUid + '/name').get()).val() || '';
    } catch (_e) { /* שם חסר אינו סיבה לבלוע התראה */ }

    await db.ref('notifications/' + toUid).push(
      buildNotification(type, fromUid, senderName, ctx, isAdminCaller)
    );
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error('[notify]', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'server_error' }) };
  }
};
