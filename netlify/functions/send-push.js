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

// מניעת שיגור חוזר: זוכרים לאיזו הודעה כבר נשלחה התראה בכל צ'אט.
//
// קודם לכן נבדק כאן חלון זמן של דקה מול last.createdAt — אבל אותה חותמת
// נכתבת ב-Date.now() *של מכשיר השולח*, בעוד ההשוואה רצה בשעון השרת. מכשיר
// שהשעון שלו מפגר בדקה גרם לדחיית כל התראה שלו, בשקט מוחלט: ההודעה נשלחת,
// ההתראה לא מגיעה, ואף אחד לא רואה שגיאה. הכשל גם עקבי לאותו משתמש, כך
// שהוא היה נראה כמו "התראות לא עובדות אצלי" בלי שום דרך לאבחן.
//
// דדופ לפי מפתח ההודעה נותן את אותה הגנה בלי לסמוך על שעונים: אפשר לשגר
// התראה רק על ההודעה האחרונה בצ'אט, ורק פעם אחת. הצומת מתחת לשורש ולכן
// חסום ללקוחות ממילא (חוקי השורש מגבילים למנהל), והפונקציה ניגשת אליו
// דרך firebase-admin שעוקף חוקים.
const DEDUPE_PATH = 'pushDedupe';

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
    const lastVal = lastSnap.exists() ? lastSnap.val() : null;
    const lastKey = lastVal ? Object.keys(lastVal)[0] : null;
    const last = lastKey ? lastVal[lastKey] : null;
    if (!last || last.from !== senderUid) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'No matching message from sender' }) };
    }

    // התראה אחת לכל היותר לכל הודעה. transaction ולא set, כדי ששתי קריאות
    // במקביל על אותה הודעה לא יעברו שתיהן ויגיעו כשתי התראות כפולות.
    const dedupeRef = db.ref(DEDUPE_PATH + '/' + chatId);
    const dedupe = await dedupeRef.transaction(cur => (cur === lastKey ? undefined : lastKey));
    if (!dedupe.committed) {
      return { statusCode: 409, headers, body: JSON.stringify({ error: 'Already notified for this message' }) };
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
