// כתובת המנהל — הגדרה אחת לכל פונקציות השרת.
//
// חוקת הפרויקט קובעת ש-ADMIN_EMAIL הוא מקור אמת יחיד, אבל הבודק
// (scripts/validate.sh) סופר רק בתוך index.html — ולכן ארבע פונקציות
// (notify, group-mail, account-cleanup, report-alert) החזיקו כל אחת עותק
// משלה של המחרוזת, בלי שהבדיקה תתפוס את זה. כתובת שתשתנה במקום אחד ולא
// בשאר שולחת התראות ניהול לכתובת מתה. מכאן — אחת.
const ADMIN_EMAIL = 'rotemshaer@gmail.com';

module.exports = { ADMIN_EMAIL };
