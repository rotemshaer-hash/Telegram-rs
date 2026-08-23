// אתחול firebase-admin — הגדרה אחת לשלוש הפונקציות שמשתמשות בו.
//
// עד כה כל אחת מ-parent-consent, password-reset ו-send-push החזיקה עותק זהה
// של initAdmin(), כולל כתובת בסיס הנתונים. שלושה עותקים של אותו קוד אתחול
// הם בדיוק מה שה-SSOT בחוקת הפרויקט אוסר.
//
// ── למה זה נבנה מחדש דווקא עכשיו ──
//
// AWS Lambda מגבילה את *סך* משתני הסביבה של הפונקציה ל-4KB, ו-Netlify
// מזריקה עשרות משתנים משלה לתוך אותו תקציב. FIREBASE_SERVICE_ACCOUNT_JSON
// תפס 2,375 בתים — יותר ממחצית — והאתר עמד במרחק 37 בתים מהגבול בלי שאיש
// ידע. התוספת הבאה, כל תוספת שהיא, שברה את הפריסה עם
// "Failed to create function", והאתר החי נתקע על גרסה ישנה.
//
// אבל מתוך 2,375 הבתים האלה, רק המפתח הפרטי הוא סוד. project_id מופיע
// ב-index.html, ב-netlify.toml, בקבצי ה-workflow ובחוקת הפרויקט;
// client_email הוא כתובת של חשבון שירות, לא אישור גישה, והוא ממילא כתוב
// בטקסט של אזהרה ב-deploy-firebase-rules.yml. שמירתם ב"כספת" לא הוסיפה
// הגנה — היא רק צרכה מהתקציב היחיד שבאמת מוגבל כאן.
//
// FIREBASE_PRIVATE_KEY לבדו הוא כ-1,700 בתים במקום 2,375: כ-645 בתים
// פנויים, פי 17 מהמרווח שהיה.
const admin = require('firebase-admin');

const PROJECT_ID = 'kidemy-83a17';
const CLIENT_EMAIL = 'firebase-adminsdk-fbsvc@kidemy-83a17.iam.gserviceaccount.com';
const DATABASE_URL = 'https://kidemy-83a17-default-rtdb.firebaseio.com';

function buildCredential() {
  const key = process.env.FIREBASE_PRIVATE_KEY;
  if (key) {
    // שדה טקסט של משתנה סביבה הופך שורות חדשות ל-\n מילולי. מפתח PEM חייב
    // שורות אמיתיות, ולכן שתי הצורות מתקבלות — אחרת ההדבקה "נראית נכון"
    // ונכשלת באימות בזמן ריצה.
    return admin.credential.cert({
      projectId: PROJECT_ID,
      clientEmail: CLIENT_EMAIL,
      privateKey: key.includes('\\n') ? key.replace(/\\n/g, '\n') : key,
    });
  }

  // נפילה לאחור לקובץ השירות המלא. נשמרת כדי שהמעבר לא ידרוש לשנות קוד
  // וסביבה באותו רגע — כל עוד המשתנה הישן קיים, שום דבר לא נשבר.
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error('לא הוגדר FIREBASE_PRIVATE_KEY ולא FIREBASE_SERVICE_ACCOUNT_JSON');
  }
  return admin.credential.cert(JSON.parse(raw));
}

let _initialized = false;
function initAdmin() {
  if (_initialized) return;
  if (!admin.apps.length) {
    admin.initializeApp({ credential: buildCredential(), databaseURL: DATABASE_URL });
  }
  _initialized = true;
}

module.exports = { admin, initAdmin, DATABASE_URL, PROJECT_ID, CLIENT_EMAIL };
