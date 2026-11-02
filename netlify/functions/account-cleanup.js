// Drushe — ניקוי מה שרק השרת מחזיק על משתמש שנמחק.
//
// מחיקת חשבון מהלקוח (deleteAllUserData) מוחקת את מה שהמשתמש רשאי למחוק. אבל כמה
// רשומות נכתבות רק על ידי השרת, ולכן הלקוח לא יכול להסיר אותן — ובהן כתובת ההורה,
// תיעוד ההסכמה (כתובת רשת ו-user-agent של ההורה), טוקני אישור, טוקני פורטל
// ההורים והסטוריז. הן נשארו במסד אחרי "החשבון נמחק בהצלחה", וזה בדיוק מה שהמחיקה
// אמורה למנוע. הפונקציה הזו מסירה אותן, ורצה לפני שהזדהות המשתמש נמחקת.
//
// מזהים את המבקש לפי idToken, לא לפי גוף הבקשה: משתמש מוחק רק את עצמו. המנהל
// (שמוחק חשבון אחר דרך הפאנל) יכול לציין uid.

const { admin, initAdmin } = require('../lib/firebase-admin-init');
const ALLOWED_ORIGINS = require('../lib/allowed-origins');

const ADMIN_EMAIL = 'rotemshaer@gmail.com';
const UID_RE = /^[A-Za-z0-9_-]{1,128}$/;

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
  if (!body.idToken) return reply(401, { error: 'idToken is required' });

  let uid;
  let isAdmin = false;
  try {
    initAdmin();
    const decoded = await admin.auth().verifyIdToken(body.idToken);
    uid = decoded.uid;
    isAdmin = decoded.email === ADMIN_EMAIL;
    if (body.uid && body.uid !== uid) {
      if (decoded.email !== ADMIN_EMAIL) return reply(403, { error: 'you can only clean up your own account' });
      if (!UID_RE.test(String(body.uid))) return reply(400, { error: 'invalid uid' });
      uid = String(body.uid);
    }
  } catch (_e) {
    return reply(401, { error: 'invalid or expired session' });
  }

  try {
    const db = admin.database();
    // משתמש רגיל מנקה רק חשבון שכבר נמחק. אחרת ילד היה קורא לכאן על עצמו, מוחק את כתובת ההורה
    // ואת תיעוד ההסכמה (ששמורים כדי שהוא לא יוכל לקבוע בעצמו מי "ההורה"), ומתחיל מחדש.
    if (!isAdmin && (await db.ref('users/' + uid).get()).exists()) {
      return reply(409, { error: 'account still exists' });
    }
    const removed = [];
    // מוחקים בעדכון רב-נתיבי אחד לכל 300 נתיבים, לא קריאה סדרתית לכל נתיב: מחיקת חשבון עם מאות שיחות
    // חייבת להיכנס בתקרה של ~10 שניות של Netlify (דוח הביצועים 2.11.2026).
    const pending = [];
    const drop = async (p) => { pending.push(p); removed.push(p); };
    const flush = async () => {
      // עדכון רב-נתיבי נכשל כולו אם נתיב אחד הוא אב של אחר (teacherQA/<uid> מול teacherQA/<uid>/<qa> כשמורה שאל את
      // עצמו) — אז משאירים רק את הנתיב העליון
      const unique = [...new Set(pending)];
      const top = unique.filter((p) => !unique.some((q) => q !== p && p.startsWith(q + '/')));
      for (let i = 0; i < top.length; i += 300) {
        const patch = {};
        top.slice(i, i + 300).forEach((p) => { patch[p] = null; });
        await db.ref().update(patch);
      }
      pending.length = 0;
    };

    // טוקן ההסכמה הפעיל, ואחריו כל השאר שנוצרו עבור המשתמש
    const activeToken = (await db.ref('parentConsentByUid/' + uid).get()).val();
    if (typeof activeToken === 'string' && /^[a-f0-9]{64}$/.test(activeToken)) await drop('parentConsent/' + activeToken);
    const consents = await db.ref('parentConsent').orderByChild('uid').equalTo(uid).get();
    const consentKeys = [];
    consents.forEach((c) => { consentKeys.push(c.key); });
    for (const k of consentKeys) await drop('parentConsent/' + k);

    for (const p of ['parentConsentByUid/' + uid, 'parentContact/' + uid, 'parentConsentLog/' + uid]) await drop(p);

    // פורטל ההורים: טוקנים שנוצרו עבור התלמיד
    const tokens = await db.ref('parentTokens').orderByChild('uid').equalTo(uid).get();
    const tokenKeys = [];
    tokens.forEach((c) => { tokenKeys.push(c.key); });
    for (const k of tokenKeys) await drop('parentTokens/' + k);

    // שיחות: הלקוח לא רשאי למחוק הודעות (חוקי הנתונים — ראיה לא נמחקת בידי משתתף), אז מחיקת חשבון עוברת כאן.
    // הרשימות מגיעות מהלקוח, אבל chatId נבנה תמיד מה-uid של המנוקה, כך שאי אפשר לגעת בשיחה של אחרים.
    const listOf = (v) => (Array.isArray(v) ? v : []).map(String).filter((x) => UID_RE.test(x) && x !== uid).slice(0, 5000);
    for (const partner of listOf(body.chatPartners)) {
      const chatId = [uid, partner].sort().join('_');
      // השיחה מועתקת לארכיון שרק המנהל קורא לפני שהיא נמחקת מהצדדים: מי שדווח עליו לא ימחק את הראיה בכך שימחק
      // את חשבונו. הארכיון נמחק ידנית אחרי 30 יום (RUNBOOK.md, privacy.html).
      const convo = (await db.ref('messages/' + chatId).get()).val();
      if (convo) await db.ref('messageArchive/' + chatId + '/' + uid + '_' + Date.now()).set({ deletedBy: uid, archivedAt: Date.now(), messages: convo });
      await drop('messages/' + chatId);
      await drop('newConversationNotified/' + chatId);
    }
    for (const g of listOf(body.groupIds)) await drop('groupMembers/' + g + '/' + uid);

    // מה שהמשתמש כתב בצמתים ציבוריים: שאלות שהוא שאל, "דרוש" שפרסם, הצעות שהגיש
    for (const p of ['messageStats/' + uid, 'referrals/' + uid, 'teacherQA/' + uid, 'chatStarters/' + uid, 'userBlockedUsers/' + uid, 'userRoles/' + uid, 'approvedTeachers/' + uid]) await drop(p);
    const fcm = await db.ref('fcmTokens').orderByChild('uid').equalTo(uid).get();
    const fcmKeys = [];
    fcm.forEach((c) => { fcmKeys.push(c.key); });
    for (const k of fcmKeys) await drop('fcmTokens/' + k);

    const qaAll = await db.ref('teacherQA').get();
    const qaKeys = [];
    qaAll.forEach((t) => { t.forEach((qa) => { if ((qa.val() || {}).askerUid === uid) qaKeys.push('teacherQA/' + t.key + '/' + qa.key); }); });
    for (const k of qaKeys) await drop(k);

    const briefs = await db.ref('parentBriefs').orderByChild('parentUid').equalTo(uid).get();
    const briefKeys = [];
    briefs.forEach((c) => { briefKeys.push(c.key); });
    for (const k of briefKeys) { await drop('parentBriefs/' + k); await drop('briefProposals/' + k); }

    // ללא תלות בתפקיד שהלקוח שלח: אחרי כשל חלקי הרשומה נוצרת מחדש כ"תלמיד" ותפקיד המורה אבד
    const props = await db.ref('briefProposals').get();
    const propKeys = [];
    props.forEach((b) => { if (b.child(uid).exists()) propKeys.push('briefProposals/' + b.key + '/' + uid); });
    for (const k of propKeys) await drop(k);

    // סטוריז שהמשתמש העלה (נושאים uid, לא מפתחים אותו)
    const stories = await db.ref('stories').orderByChild('uid').equalTo(uid).get();
    const storyKeys = [];
    stories.forEach((c) => { storyKeys.push(c.key); });
    for (const k of storyKeys) await drop('stories/' + k);

    await flush();
    return reply(200, { ok: true, removed: removed.length });
  } catch (err) {
    console.error('[account-cleanup]', err);
    return reply(500, { error: 'server_error' });
  }
};
