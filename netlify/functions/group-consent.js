// Drushe — אישור הורה לקבוצה מסוימת, לפני שהמוביל יכול לקבל את הילד.
//
// מה היה: ההורה אישר פעם אחת, בהרשמה, "באופן כללי", והנוסח אמר שחלק מהקבוצות נפגשות פיזית בלי הורים.
// אחר כך כל ילד יכול היה לבקש להצטרף לכל קבוצה, והמוביל לקבל אותו — וההורה שמע על כך, במקרה הטוב,
// במייל *אחרי* שהילד כבר אושר (group-mail.js). כלומר הסכמה כללית לסוג של פעילות, לא הסכמה למפגש הזה,
// במקום הזה, עם המוביל הזה, בגילאים האלה. מי שמבקש להוכיח שההורים ידעו צריך להראות שההורה אישר *את
// הקבוצה*, לא את האפליקציה.
//
// מה עכשיו: בקשת הצטרפות שולחת להורה מייל עם פרטי הקבוצה (מקום, יום, שעה, מוביל, טווח גילים) וקישור
// אישי. רק כשההורה לוחץ, השרת כותב groupMembers/<קבוצה>/<ילד>/parentApprovedAt — שדה שהילד והמוביל
// לא יכולים לכתוב (החוקים מתירים אותו רק למנהל, ו-firebase-admin עוקף חוקים), והחוקים אינם מתירים
// status='approved' בלעדיו. המוביל לא יכול לקבל ילד שהורהו לא אישר, גם אם יפנה ישירות למסד.
//
// הטוקן הוא אמצעי הזיהוי היחיד של ההורה: 32 בייטים אקראיים, נוצר ונשלח מהשרת, הילד לא רואה אותו
// (אותו עיקרון כמו parent-consent.js — אם הילד מחזיק את הטוקן, "אישור ההורה" הוא פעולה שלו).

const crypto = require('crypto');
const { admin, initAdmin } = require('../lib/firebase-admin-init');
const { sendViaEmailJS } = require('../lib/emailjs');
const ALLOWED_ORIGINS = require('../lib/allowed-origins');
const { FAKE_DOMAIN } = require('../lib/internal-email');
const { withinWindowLimit } = require('../lib/rate-limit');
const { GROUP_EMERGENCY_PHONE } = require('../lib/safety-contact');

const TOKEN_RE = /^[a-f0-9]{64}$/;
const ID_RE = /^[-A-Za-z0-9_]{1,128}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONSENT_DAYS = 14;
const CREATE_MAX = 10;              // בקשות לשעה לכל ילד: מספיק לכמה קבוצות, לא להצפת תיבת הורה
const CREATE_IP_MAX = 60;
const READ_MAX = 30;                // info/approve/decline לדקה לכל כתובת
const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

const clip = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);

// מה שההורה רואה ומה שנשמר כראיה — אותו תיאור, נגזר מרשומת הקבוצה ולא מהבקשה.
function snapshotOf(g) {
  return {
    title: clip(g.title, 80),
    teacherName: clip(g.teacherName, 60),
    location: clip(g.location, 120),
    day: clip(g.day, 40),
    time: clip(g.time, 20),
    minAge: Number(g.minAge),
    maxAge: Number(g.maxAge),
  };
}
const sameSnapshot = (a, b) => ['title', 'teacherName', 'location', 'day', 'time', 'minAge', 'maxAge'].every((k) => a[k] === b[k]);

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

  const action = body.action;
  if (!['request', 'info', 'approve', 'decline'].includes(action)) return reply(400, { error: 'Invalid action' });
  const ip = event.headers['x-nf-client-connection-ip'] || event.headers['client-ip'] || 'unknown';
  const ua = String(event.headers['user-agent'] || '').slice(0, 300);

  try {
    initAdmin();
    const db = admin.database();

    // ── request: הילד מבקש, השרת שולח להורה ──────────────────────────────────────────────
    if (action === 'request') {
      const groupId = String(body.groupId || '');
      if (!ID_RE.test(groupId)) return reply(400, { error: 'Invalid request' });
      if (!body.idToken) return reply(401, { error: 'idToken is required' });
      let uid; let ownEmail;
      try {
        const decoded = await admin.auth().verifyIdToken(body.idToken);
        uid = decoded.uid; ownEmail = String(decoded.email || '').trim().toLowerCase();
        if (decoded.firebase && decoded.firebase.sign_in_provider === 'anonymous') return reply(403, { error: 'guests cannot join groups' });
      } catch (_e) {
        return reply(401, { error: 'invalid or expired session' });
      }

      if (!(await withinWindowLimit(db, 'groupConsentRateLimit', uid, CREATE_MAX, HOUR))) return reply(429, { error: 'Too many requests' });
      if (!(await withinWindowLimit(db, 'groupConsentIpRateLimit', ip, CREATE_IP_MAX, HOUR))) return reply(429, { error: 'Too many requests' });

      const member = (await db.ref('groupMembers/' + groupId + '/' + uid).get()).val();
      if (!member || member.status !== 'pending') return reply(409, { error: 'no pending request for this group' });
      if (member.parentApprovedAt) return reply(200, { ok: true, alreadyApproved: true });

      const g = (await db.ref('groups/' + groupId).get()).val();
      if (!g || g.status !== 'open') return reply(409, { error: 'group_not_open' });
      const minAge = Number(g.minAge); const maxAge = Number(g.maxAge);
      if (!Number.isFinite(minAge) || !Number.isFinite(maxAge)) return reply(409, { error: 'group_no_age_range' });

      const [age, name] = await Promise.all(['age', 'name'].map(async (k) => (await db.ref('users/' + uid + '/' + k).get()).val()));
      const childAge = Number(age);
      if (!Number.isFinite(childAge) || childAge < minAge || childAge > maxAge) return reply(403, { error: 'age_out_of_range', minAge, maxAge });

      // הכתובת שננעלה בהרשמה (parentContact) קודמת לזו שברשומת המשתמש, שהילד עורך בעצמו.
      const stored = (await db.ref('parentContact/' + uid + '/email').get()).val();
      const parentEmail = String(stored || (await db.ref('users/' + uid + '/parentEmail').get()).val() || '').trim();
      if (!EMAIL_RE.test(parentEmail) || parentEmail.toLowerCase().endsWith(FAKE_DOMAIN) || parentEmail.toLowerCase() === ownEmail) {
        return reply(422, { error: 'no_parent_email' });
      }
      const parentName = clip((await db.ref('users/' + uid + '/parentName').get()).val(), 60) || 'הורה יקר';
      const childName = clip(name, 60) || 'ילדך';

      // בקשה פעילה אחת לכל (קבוצה, ילד): הקודמת מתבטלת.
      const key = groupId + '_' + uid;
      const prev = (await db.ref('groupConsentByMember/' + key).get()).val();
      if (prev && TOKEN_RE.test(String(prev))) await db.ref('groupConsent/' + prev + '/expiresAt').set(0).catch(() => {});

      const snap = snapshotOf(g);
      const token = crypto.randomBytes(32).toString('hex');
      await db.ref('groupConsent/' + token).set({
        uid, groupId, childName, parentEmail, snapshot: snap, status: 'pending',
        createdAt: Date.now(), expiresAt: Date.now() + CONSENT_DAYS * 24 * HOUR,
        createdIp: ip, createdUserAgent: ua,
      });
      await db.ref('groupConsentByMember/' + key).set(token);

      const link = ALLOWED_ORIGINS[0] + '/?groupConsent=' + token;
      try {
        await sendViaEmailJS(
          parentEmail,
          'נדרש אישורך — ' + childName + ' ביקש/ה להצטרף לקבוצה "' + snap.title + '"',
          `שלום ${parentName},\n\n` +
          `${childName} ביקש/ה להצטרף לקבוצה ב-Drushe:\n\n` +
          `📌 ${snap.title}\n👤 מוביל/ה: ${snap.teacherName}\n📅 ${[snap.day, snap.time].filter(Boolean).join(' בשעה ')}\n📍 ${snap.location}\n🎂 גילאים: ${snap.minAge}–${snap.maxAge}\n\n` +
          `**חלק מהקבוצות נפגשות פיזית, ללא נוכחות הורים, והמוביל הוא נער או נערה בני 14–18.** ` +
          `${childName} לא יתקבל/תתקבל לקבוצה בלי אישורכם — הבקשה לא מגיעה למוביל כבקשה שאפשר לאשר עד שתאשרו.\n\n` +
          `לפרטים ולאישור (או לסירוב):\n${link}\n\n` +
          `הקישור אישי, תקף ל-${CONSENT_DAYS} ימים, ומתייחס לקבוצה הזו בלבד. כל קבוצה נוספת תדרוש אישור נפרד.\n` +
          `לשאלות ולפניות בזמן מפגש אפשר ליצור איתנו קשר: ${GROUP_EMERGENCY_PHONE}.\n\n` +
          `אם אינכם ההורה, או שאינכם מאשרים — התעלמו מהמייל. הילד לא יתקבל.\n\n– צוות Drushe`
        );
      } catch (mailErr) {
        console.error('[group-consent] mail failed:', mailErr.message);
        await db.ref('adminNotifs').push({
          type: 'groupMailFailed', from: childName, groupId, event: 'consentRequest',
          error: String(mailErr.message).slice(0, 200), read: false, createdAt: Date.now(),
        }).catch(() => {});
        return reply(502, { error: 'mail_failed' });
      }
      return reply(200, { ok: true, sent: true });
    }

    // ── info / approve / decline: ההורה, בלי התחברות, עם הטוקן ──────────────────────────────
    const token = String(body.token || '');
    if (!TOKEN_RE.test(token)) return reply(400, { error: 'Invalid token' });
    if (!(await withinWindowLimit(db, 'groupConsentReadRateLimit', ip, READ_MAX, MINUTE))) return reply(429, { error: 'Too many requests' });

    const ref = db.ref('groupConsent/' + token);
    const rec = (await ref.get()).val();
    if (!rec) return reply(404, { error: 'not_found' });
    if (Date.now() > (rec.expiresAt || 0)) return reply(410, { error: 'expired' });

    if (action === 'info') {
      return reply(200, {
        childName: rec.childName || '', status: rec.status || 'pending',
        group: rec.snapshot || {}, emergencyPhone: GROUP_EMERGENCY_PHONE,
      });
    }

    const { uid, groupId } = rec;
    const g = (await db.ref('groups/' + groupId).get()).val();
    const member = (await db.ref('groupMembers/' + groupId + '/' + uid).get()).val();
    if (!g || (g.status !== 'open' && g.status !== 'full')) return reply(410, { error: 'group_closed' });
    if (!member || member.status !== 'pending') return reply(409, { error: 'request_gone' });
    // ההורה אישר קבוצה מסוימת. אם משהו בה השתנה מאז, הוא לא אישר את מה שהיא עכשיו.
    if (!sameSnapshot(rec.snapshot || {}, snapshotOf(g))) return reply(409, { error: 'group_changed' });

    const next = action === 'approve' ? 'approved' : 'declined';
    const claim = await ref.child('status').transaction((cur) => (cur === 'pending' || cur == null ? next : undefined));
    if (!claim.committed) return reply(409, { error: 'already_decided' });

    const now = Date.now();
    await ref.update({ decidedAt: now, decidedIp: ip, decidedUserAgent: ua });
    // תיעוד נפרד מהטוקן — זה מה שמציגים לשאלה "איך הוכחתם שההורה אישר את הקבוצה הזו".
    await db.ref('groupConsentLog/' + groupId + '_' + uid).push({
      decision: next, uid, groupId, childName: rec.childName || '', parentEmail: rec.parentEmail || '',
      snapshot: rec.snapshot || {}, at: now, ip, userAgent: ua,
      sameDevice: !!(rec.createdIp && rec.createdIp === ip && rec.createdUserAgent === ua),
    });

    if (next === 'approved') {
      await db.ref('groupMembers/' + groupId + '/' + uid + '/parentApprovedAt').set(now);
      await db.ref('userGroups/' + uid + '/' + groupId + '/parentApprovedAt').set(now).catch(() => {});
    } else {
      await db.ref('groupMembers/' + groupId + '/' + uid + '/status').set('rejected');
      await db.ref('userGroups/' + uid + '/' + groupId + '/status').set('rejected').catch(() => {});
    }
    return reply(200, { ok: true, decision: next, childName: rec.childName || '' });
  } catch (err) {
    console.error('[group-consent]', err);
    return reply(500, { error: 'server_error' });
  }
};
