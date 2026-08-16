// Drushe push sender — serverless FCM relay on Netlify Functions.
//
// למה צריך שרת בכלל: שליחת FCM דורשת את מפתח ה-service account. אילו הוא
// היה בתוך האפליקציה, כל אחד היה מחלץ אותו ומציף התראות לכל המשתמשים, ולכן
// גוגל מחייבת שהשליחה תצא משרת. אותו שיקול בדיוק כמו ב-ai-assistant.js עם
// המפתח של Anthropic.
//
// מה הפונקציה הזו *לא* עושה: היא לא מאמינה למה שהלקוח מספר לה. הלקוח לא
// שולח את הזהות שלו ולא את טקסט ההתראה — הוא רק אומר "שלחתי הודעה ל-X",
// והשרת מאמת מול מסד הנתונים שזה באמת קרה וקורא את הטקסט משם. אחרת כל
// משתמש מחובר היה יכול לשגר לכל אחד אחר התראה עם תוכן שרירותי, וזו
// אפליקציה שילדים משתמשים בה.

const admin = require('firebase-admin');

const DATABASE_URL = 'https://kidemy-83a17-default-rtdb.firebaseio.com';

// הודעה נחשבת "טרייה" רק אם נכתבה ממש עכשיו. חלון צר חוסם ניסיון לשגר שוב
// ושוב התראה על אותה הודעה ישנה כדי להציק למישהו.
const FRESH_MESSAGE_WINDOW_MS = 60 * 1000;

// תקרה גסה נגד הצפה. משתמש אמיתי לא שולח 40 הודעות בדקה; מי שכן — לא יקבל
// התראות נוספות, אבל ההודעות עצמן ימשיכו להישמר כרגיל.
const RATE_LIMIT_MAX = 40;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

let _initialized = false;
function initAdmin() {
  if (_initialized) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not set');
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(raw)),
      databaseURL: DATABASE_URL,
    });
  }
  _initialized = true;
}

// אותו חישוב כמו getChatId() באפליקציה — מזהה הצ'אט נגזר משני ה-uid
// הממוינים, ולכן אי אפשר "לכוון" אותו לצ'אט של אנשים אחרים.
function chatIdFor(a, b) {
  return [a, b].sort().join('_');
}

async function withinRateLimit(db, uid) {
  const ref = db.ref('pushRateLimit/' + uid);
  const now = Date.now();
  const result = await ref.transaction((cur) => {
    if (!cur || now - (cur.windowStart || 0) > RATE_LIMIT_WINDOW_MS) {
      return { windowStart: now, count: 1 };
    }
    return { windowStart: cur.windowStart, count: (cur.count || 0) + 1 };
  });
  return (result.snapshot.val()?.count || 0) <= RATE_LIMIT_MAX;
}

// טוקן שנמחק מהמכשיר או פג נשאר תלוי במסד וגורם לכישלון בכל שליחה עתידית.
// ניקוי מיידי שומר על הצומת נקי בלי עבודת תחזוקה ידנית.
async function pruneDeadTokens(db, tokens, responses) {
  const dead = [];
  responses.forEach((r, i) => {
    const code = r.error?.code;
    if (code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-registration-token') {
      dead.push(tokens[i]);
    }
  });
  await Promise.all(dead.map((t) => db.ref('fcmTokens/' + t).remove().catch(() => {})));
  return dead.length;
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (_e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { idToken, toUid, type } = payload;
  if (!idToken || !toUid) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'idToken and toUid are required' }) };
  }
  // רק סוג אחד נתמך כרגע. אלוסטה סגורה ולא if/else פתוח, כדי שהוספת סוג
  // תחייב גם לכתוב לו אימות משלו ולא תוכל להיכנס בטעות בלי אחד.
  if (type !== 'newMessage') {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unsupported notification type' }) };
  }

  try {
    initAdmin();
  } catch (e) {
    console.error('[send-push] init failed:', e.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server not configured' }) };
  }

  const db = admin.database();

  try {
    // 1. מי השולח באמת — נקבע מהטוקן החתום, לא ממה שהלקוח טוען.
    let senderUid;
    try {
      senderUid = (await admin.auth().verifyIdToken(idToken)).uid;
    } catch (_e) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid auth token' }) };
    }
    if (senderUid === toUid) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Cannot notify yourself' }) };
    }

    if (!(await withinRateLimit(db, senderUid))) {
      return { statusCode: 429, headers, body: JSON.stringify({ error: 'Rate limit exceeded' }) };
    }

    // 2. אימות שההודעה באמת נשלחה — כאן נקבע גם תוכן ההתראה.
    const chatId = chatIdFor(senderUid, toUid);
    const lastSnap = await db.ref('messages/' + chatId).limitToLast(1).get();
    const last = lastSnap.exists() ? Object.values(lastSnap.val())[0] : null;
    if (!last || last.from !== senderUid) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'No matching message from sender' }) };
    }
    if (Date.now() - (last.createdAt || 0) > FRESH_MESSAGE_WINDOW_MS) {
      return { statusCode: 409, headers, body: JSON.stringify({ error: 'Message is not recent' }) };
    }

    // 3. שם השולח נקרא מהמסד, לא מהלקוח — אחרת אפשר היה להתחזות לכל אחד.
    const senderName =
      (await db.ref('users/' + senderUid + '/name').get()).val() || 'משתמש';
    const body = last.text ? String(last.text).substring(0, 100) : '🎤 הודעה קולית';

    // 4. הטוקנים של הנמען.
    const tokensSnap = await db.ref('fcmTokens').orderByChild('uid').equalTo(toUid).get();
    const tokens = tokensSnap.exists() ? Object.keys(tokensSnap.val()) : [];
    if (!tokens.length) {
      return { statusCode: 200, headers, body: JSON.stringify({ sent: 0, reason: 'No registered devices' }) };
    }

    const res = await admin.messaging().sendEachForMulticast({
      tokens,
      notification: { title: '💬 ' + senderName, body },
      // fromUid/fromName נקראים ע"י pushNotificationActionPerformed באפליקציה
      // כדי לפתוח את הצ'אט הנכון בהקשה.
      data: { type: 'newMessage', fromUid: senderUid, fromName: senderName },
      android: { priority: 'high', notification: { channelId: 'default', sound: 'default' } },
    });

    const pruned = await pruneDeadTokens(db, tokens, res.responses);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ sent: res.successCount, failed: res.failureCount, pruned }),
    };
  } catch (e) {
    console.error('[send-push] failed:', e);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to send notification' }) };
  }
};
