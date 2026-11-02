// Drushe — התראה לטלפון המנהל על דיווח חמור או קריטי.
//
// עד עכשיו דיווח כזה הגיע רק כמייל ופעמון בתוך האפליקציה: המנהל גילה אותו רק כשפתח אחד מהשניים.
// בדיווח על בטיחות של ילד, "יעד טיפול 2 שעות" דורש שהטלפון יצלצל.
//
// הלקוח לא שולח טקסט ולא חומרה — רק מזהה דיווח. השרת קורא את הדיווח מהמסד, מוודא שהמדווח הוא הקורא,
// שהחומרה אכן גבוהה/קריטית, ושולח התראה אחת לכל דיווח (reportPushed/<id> נתפס בטרנזקציה).

const { admin, initAdmin } = require('../lib/firebase-admin-init');
const ALLOWED_ORIGINS = require('../lib/allowed-origins');
const { withinWindowLimit } = require('../lib/rate-limit');

const ADMIN_EMAIL = 'rotemshaer@gmail.com';
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const PUSH_SEVERITIES = ['critical', 'high'];
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

const clip = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);

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
  const reportId = String(body.reportId || '');
  if (!ID_RE.test(reportId)) return reply(400, { error: 'Invalid request' });

  let uid;
  try {
    initAdmin();
    uid = (await admin.auth().verifyIdToken(body.idToken)).uid;
  } catch (_e) {
    return reply(401, { error: 'invalid or expired session' });
  }

  try {
    const db = admin.database();
    if (!(await withinWindowLimit(db, 'reportAlertRateLimit', uid, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS))) {
      return reply(429, { error: 'Too many requests' });
    }
    const report = (await db.ref('reports/' + reportId).get()).val();
    if (!report || report.reporterId !== uid) return reply(403, { error: 'no such report' });
    if (!PUSH_SEVERITIES.includes(report.severity)) return reply(200, { sent: 0, reason: 'not urgent' });

    const claimed = await db.ref('reportPushed/' + reportId).transaction((cur) => (cur ? undefined : Date.now()));
    if (!claimed.committed) return reply(200, { sent: 0, duplicate: true });

    let adminUid;
    try { adminUid = (await admin.auth().getUserByEmail(ADMIN_EMAIL)).uid; } catch (_e) { return reply(200, { sent: 0, reason: 'no admin' }); }
    const snap = await db.ref('fcmTokens').orderByChild('uid').equalTo(adminUid).get();
    const tokens = snap.exists() ? Object.keys(snap.val()) : [];
    if (!tokens.length) return reply(200, { sent: 0, reason: 'No registered devices' });

    const res = await admin.messaging().sendEachForMulticast({
      tokens,
      notification: {
        title: report.severity === 'critical' ? '🚨 דיווח קריטי ב-Drushe' : '🚩 דיווח חמור ב-Drushe',
        body: clip((report.reasonLabel || '') + ' · ' + (report.targetName || report.targetType || ''), 120),
      },
      data: { type: 'report', reportId },
      android: { priority: 'high', notification: { channelId: 'default', sound: 'default' } },
    });
    return reply(200, { sent: res.successCount, failed: res.failureCount });
  } catch (e) {
    console.error('[report-alert] failed:', e);
    return reply(500, { error: 'Failed to send notification' });
  }
};
