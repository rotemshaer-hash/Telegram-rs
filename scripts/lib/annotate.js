// הערות (annotations) של GitHub Actions — הגדרה אחת.
//
// למה זה קיים בכלל: הלוג של ריצה מוגש מאחסון חיצוני ולא מ-api.github.com,
// כך שסשן שאין לו גישה לאותו שרת אינו קורא אותו; ובנייד צריך לפתוח שלב בתוך
// job כדי לראות אותו. הערה יושבת בראש דף הריצה, נפתחת בלחיצה אחת, ונקראת
// דרך ה-API. כל סקריפט ops כאן שמייצר מידע שמישהו צריך לקרוא — רשימת
// מועמדות למחיקה, מה נמחק בפועל, סיבת כישלון — מוציא אותו דרך כאן.
//
// הקידוד אינו קוסמטי: שורה חדשה או סימן אחוז בתוך ההודעה מסיימים את פקודת
// ה-workflow באמצע, והרשימה נחתכת בלי שום סימן שמשהו חסר.
'use strict';

// GitHub מציג לכל היותר 10 הערות לשלב, ולכן רשימה היא **הערה אחת** עם כל
// השורות ולא הערה לכל שורה — 32 פריטים היו נחתכים ל-10 בשקט.
// התקרה כאן היא על מספר השורות בהערה, למקרה שסריקה תחזיר אלפים.
const MAX_LINES = 200;

function escape(s) {
  return String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

function emit(level, title, body) {
  if (!process.env.GITHUB_ACTIONS) return;
  console.log(`::${level} title=${escape(title)}::${escape(body)}`);
}

function notice(title, lines) {
  const shown = lines.slice(0, MAX_LINES);
  if (lines.length > shown.length) shown.push(`… ועוד ${lines.length - shown.length}`);
  emit('notice', title, shown.join('\n'));
}

function error(title, message) {
  emit('error', title, message);
}

module.exports = { notice, error, escape, MAX_LINES };
