// Drushe — שליחת push למכשירים של משתמש: אנדרואיד דרך FCM, iOS דרך APNs. נקודה אחת לכל הפונקציות.
//
// tokensVal = הערך של fcmTokens שמסונן ל-uid (טוקן → {uid, platform}). טוקן בלי platform הוא אנדרואיד (כך נרשמו כולם עד היום).

const { sendApns } = require('./apns');

function splitTokens(tokensVal) {
  const fcm = []; const ios = [];
  Object.keys(tokensVal || {}).forEach((t) => ((tokensVal[t] || {}).platform === 'ios' ? ios : fcm).push(t));
  return { fcm, ios };
}

// admin = firebase-admin. msg = { title, body, data }. מוחק טוקנים מתים. מחזיר { sent, failed, pruned }.
async function pushToTokens(admin, db, tokensVal, msg, { apnsOptions } = {}) {
  const { fcm, ios } = splitTokens(tokensVal);
  let sent = 0; let failed = 0; const dead = [];

  if (fcm.length) {
    const res = await admin.messaging().sendEachForMulticast({
      tokens: fcm,
      notification: { title: msg.title, body: msg.body },
      data: msg.data || {},
      android: { priority: 'high', notification: { channelId: 'default', sound: 'default' } },
    });
    sent += res.successCount; failed += res.failureCount;
    (res.responses || []).forEach((r, i) => {
      const code = r.error && r.error.code;
      if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') dead.push(fcm[i]);
    });
  }
  if (ios.length) {
    const r = await sendApns(ios, msg, apnsOptions);
    sent += r.sent; failed += r.failed; dead.push(...r.dead);
  }
  await Promise.all(dead.map((t) => db.ref('fcmTokens/' + t).remove().catch(() => {})));
  return { sent, failed, pruned: dead.length };
}

module.exports = { pushToTokens, splitTokens };
