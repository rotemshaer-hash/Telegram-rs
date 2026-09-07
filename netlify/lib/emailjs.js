// שליחת מייל דרך EmailJS ב-REST, מהשרת. הגדרה אחת — password-reset.js ו-
// parent-consent.js השתמשו קודם בשני עותקים זהים, בדיוק מה שה-SSOT בחוקת
// הפרויקט אוסר.
//
// שלושת המזהים האלה אינם סודות: הם מוטבעים ב-index.html, שהוא קובץ ציבורי
// בריפו ציבורי, וכל דפדפן שטוען את האפליקציה מקבל אותם.
const EMAILJS_SERVICE_ID = 'service_h1v7whg';
const EMAILJS_TEMPLATE_ID = 'template_i016jci';
const EMAILJS_PUBLIC_KEY = 'kjqdW8av2HU2kOA8W';

async function sendViaEmailJS(toEmail, subject, message) {
  const body = {
    service_id: EMAILJS_SERVICE_ID,
    template_id: EMAILJS_TEMPLATE_ID,
    user_id: EMAILJS_PUBLIC_KEY,
    template_params: { to_email: toEmail, subject, message },
  };
  // EmailJS חוסם קריאות שאינן מהדפדפן אלא אם נשלח מפתח פרטי. אם הוא מוגדר,
  // שולחים אותו; אם לא, הקריאה עשויה להיחסם — ואז הזרימה נופלת להתראה למנהל
  // אצל הקורא, ולא נעלמת בשקט.
  if (process.env.EMAILJS_PRIVATE_KEY) body.accessToken = process.env.EMAILJS_PRIVATE_KEY;

  const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('EmailJS ' + res.status + ': ' + (await res.text()).slice(0, 200));
  return true;
}

module.exports = { sendViaEmailJS };
