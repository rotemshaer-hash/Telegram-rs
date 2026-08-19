// Drushe Service Worker
//
// ה-SW הזה קיים לצורך אחד בלבד: לאפשר התקנה כ-PWA. הוא לא שומר כלום במטמון
// ולא מגיש כלום בעצמו — הדפדפן מטפל בכל הבקשות כרגיל.
//
// היה כאן גם מטפל fetch שהכריז "always fetch from network — bypass all caches"
// והריץ fetch(e.request,{cache:'no-store'}) על כל בקשה. הוא נמחק, משלוש סיבות
// שכל אחת מהן מספיקה:
//
//   1. הוא היה מיותר מעצם הגדרתו. "תמיד מהרשת, בלי מטמון" היא בדיוק ההתנהגות
//      שמתקבלת כשאין מטפל fetch — רק בלי לנתב כל בקשה דרך thread של ה-SW.
//   2. ה-fallback שלו היה מת. caches.match() היה הגיבוי היחיד, אבל install
//      ו-activate מוחקים את כל ה-caches, ולכן הוא תמיד היה ריק. לא הייתה כאן
//      שום תמיכת offline — רק אשליה שלה.
//   3. המחיר היה 12.5 שניות. נמדד בכרומיום עם האטת מעבד של מכשיר אנדרואיד
//      בינוני, על localhost כלומר בלי זמן רשת בכלל: first-paint 340ms בלי
//      ה-SW מול 13,044ms איתו. פי 38.
//
// skipWaiting + clients.claim נשמרים כדי שגרסה חדשה תיכנס לתוקף בפתיחה הבאה
// בלי שהמשתמש יצטרך לסגור את האפליקציה לגמרי.
//
// אם בעתיד תידרש תמיכת offline אמיתית, היא נבנית כ-cache-first על נכסים
// סטטיים עם רשימה מפורשת — לא כ-pass-through שמנתב הכל דרך ה-SW.

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
