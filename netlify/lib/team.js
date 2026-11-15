// חברי צוות — בדיקה אחת לכל פונקציות השרת.
//
// חבר צוות הוא דגל team/<uid> ב-RTDB, שנכתב רק מ-netlify/functions/team-roles.js (הבעלים). אותו דגל נקרא גם בחוקי
// ה-RTDB, ולכן הסרה חלה מיד — בלי טוקן שצריך לחכות שיפוג. ב-Storage אין גישה ל-RTDB, ולכן שם נקרא claim ('team')
// על הטוקן; הוא נמחק בהסרה, ועד שעה אחרי ההסרה מי שכבר מחובר יכול עדיין לקרוא תמונות זהות מ-Storage בלבד.
async function isTeamMember(db, uid) {
  if (!uid) return false;
  return (await db.ref('team/' + uid).get()).val() === true;
}

module.exports = { isTeamMember };
