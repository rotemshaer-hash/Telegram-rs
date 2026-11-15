// שליחת מייל דרך EmailJS ב-REST, מהשרת. הגדרה אחת — password-reset.js ו-
// parent-consent.js השתמשו קודם בשני עותקים זהים, בדיוק מה שה-SSOT בחוקת
// הפרויקט אוסר.
//
// שלושת המזהים האלה אינם סודות: הם מוטבעים ב-index.html, שהוא קובץ ציבורי
// בריפו ציבורי, וכל דפדפן שטוען את האפליקציה מקבל אותם.
const { render: renderEmail, esc } = require('../../email-design');
const ALLOWED_ORIGINS = require('./allowed-origins');
const EMAILJS_SERVICE_ID = 'service_h1v7whg';
const EMAILJS_TEMPLATE_ID = 'template_i016jci';
const EMAILJS_PUBLIC_KEY = 'kjqdW8av2HU2kOA8W';

async function post(params) {
  const body = {
    service_id: EMAILJS_SERVICE_ID,
    template_id: EMAILJS_TEMPLATE_ID,
    user_id: EMAILJS_PUBLIC_KEY,
    template_params: params,
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

// message = הטקסט הגולמי (כמו תמיד); message_html = אותו תוכן, מעוצב בצבעי Drushe (email-design.js, מקור אחד גם לדפדפן).
// התבנית ב-EmailJS צריכה להציג את {{{message_html}}}; תבנית שעוד לא עודכנה ממשיכה להציג את message בלי שום שינוי.
//
// רשת ביטחון: אם EmailJS דוחה את הגרסה המעוצבת (4xx), אותו תוכן נשלח שוב כטקסט פשוט וקריא. מייל אישור הורה שלא יצא
// הוא ילד שלא יכול להצטרף — עדיף מייל לא יפה מאשר מייל שאבד. אם גם הגרסה הפשוטה נדחית, הכשל עולה לקורא כמו תמיד.
async function sendViaEmailJS(toEmail, subject, message) {
  const designed = renderEmail({ subject, text: message, siteUrl: ALLOWED_ORIGINS[0] });
  try {
    return await post({ to_email: toEmail, subject, message, message_html: designed });
  } catch (e) {
    if (!/^EmailJS 4\d\d/.test(String(e.message))) throw e;
    console.error('[emailjs] designed email refused, resending as plain text:', e.message);
    const plain = '<div dir="rtl" style="white-space:pre-wrap;font-family:Arial,sans-serif;font-size:15px;line-height:1.7;color:#0F1A1F">' + esc(message) + '</div>';
    return post({ to_email: toEmail, subject, message, message_html: plain });
  }
}

module.exports = { sendViaEmailJS };
