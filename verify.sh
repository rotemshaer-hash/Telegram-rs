#!/bin/bash
# verify.sh — בדיקת תקינות index.html לפני כל push
FILE="index.html"
ERRORS=()
CHECKS=0

check() {
  local desc="$1"
  local pattern="$2"
  CHECKS=$((CHECKS+1))
  grep -qE "$pattern" "$FILE" || ERRORS+=("❌ חסר: $desc")
}

echo "🔍 בודק index.html..."

# גרסה
check "APP_VERSION"                     "APP_VERSION="

# פונקציות ליבה
check "firebaseLogin"                   "async function firebaseLogin"
check "firebaseLogout"                  "async function firebaseLogout"
check "showFullRegistrationDetails"     "function showFullRegistrationDetails"
check "onAuthStateChanged"              "onAuthStateChanged"
check "go() function"                   "^function go\("
check "render() function"              "^function render\("
check "_startAdminAlertsListener"       "_startAdminAlertsListener"

# מסכים
check "מסך Login"                       "^function Login\("
check "מסך Home"                        "^function Home\("
check "מסך StudentPending"              "^function StudentPending\("
check "מסך TeacherPending"              "^function TeacherPending\("
check "מסך Splash"                      "^function Splash\("

# UI קריטי
check "כפתור צפה בכל פרטי ההרשמה"     "צפה בכל פרטי ההרשמה"
check "gradient כותרת כהה"             "linear-gradient\(150deg,#0F1A1F"
check "מערך CATS"                       "const CATS="
check "GPS timeout 20000"               "20000"
check "listener לסטוריז"               "ref\('stories'\)"
check "שם האפליקציה Lamdeni"           "Lamdeni"

if [ ${#ERRORS[@]} -gt 0 ]; then
  echo ""
  echo "🚨 נמצאו ${#ERRORS[@]} בעיות:"
  for e in "${ERRORS[@]}"; do echo "  $e"; done
  echo ""
  echo "תקן לפני push!"
  exit 1
fi

echo "✅ כל $CHECKS הבדיקות עברו — אפשר לעלות"
exit 0
