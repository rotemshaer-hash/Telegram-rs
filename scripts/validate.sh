#!/bin/bash
# Drushe project constitution validator.
# Runs on every deploy — a non-zero exit blocks the deploy.

set -euo pipefail

FILE="index.html"
ERRORS=0

fail() { echo "❌  $1"; ERRORS=$((ERRORS + 1)); }
pass() { echo "✅  $1"; }

count_pattern() {
  grep -c "$1" "$FILE" 2>/dev/null || echo 0
}

has_pattern() {
  grep -q "$1" "$FILE" 2>/dev/null
}

echo "=== Drushe constitution validator ==="
echo ""

# ── SSOT: each constant defined exactly once ─────────────────────────────────
echo "-- SSOT checks --"

ssot_check() {
  local label="$1" pattern="$2"
  local n
  n=$(count_pattern "$pattern")
  if [ "$n" -eq 1 ]; then
    pass "SSOT: $label (1 definition)"
  else
    fail "SSOT violation: '$label' appears $n times — must be exactly 1"
  fi
}

ssot_check "COMMISSION_RATE"  "const COMMISSION_RATE="
ssot_check "ADMIN_EMAIL"      "const ADMIN_EMAIL="
ssot_check "APP_VERSION"      "const APP_VERSION="

# הדף השחור-שנראה-כמו-לפני-הרשמה (HANDOFF.md, 20.8.2026) התברר כמסך הטעינה
# של דרילס, שאפשר להגיע אליו רק דרך openDiscover(). אם מישהו יוסיף בעתיד עוד
# מקום שקורא go('discover') ישירות — עוקף את בדיקת currentUser שבתוך
# openDiscover() — התקלה חוזרת בלי שהתכוונו. שומר את זה על מקור אמת יחיד.
ssot_check "go('discover') call site (only inside openDiscover())" "go('discover')"

# ההצהרה אינה הערך. הבדיקות למעלה סופרות "const X=" ולכן עברו בזמן שכתובת
# המנהל הייתה כתובה כמחרוזת בשבעה מקומות — כולל KEEP, שמגן על החשבון הזה
# ממחיקה המונית. SSOT הוא על הערך, ולכן הוא נבדק כאן על הערך עצמו.
ssot_check "ADMIN_EMAIL value" "rotemshaer@gmail.com"

# מחיקת משתמש נכשלה שלוש פעמים מאותה סיבה: כל מסלול מחיקה החזיק רשימת
# נתיבים משלו. הרשימות סטו, ו-teacherVerification — תמונת תעודת הזהות של
# הקטין — נשארה במסד אחרי "אפס מערכת" ואחרי מחיקה המונית. הרשימה חיה עכשיו
# רק בתוך deleteAllUserData; אם מישהו יוסיף שנייה, זה ייעצר כאן.
ssot_check "deletion path list (USER_DATA_PATHS)" "const USER_DATA_PATHS="

# מחיר המנוי היה כתוב כמספר קשיח ב-12 מקומות. שינוי מחיר שמפספס אפילו מקום
# אחד מציג למורה שני מחירים שונים באותו מסך הרשמה.
ssot_check "TEACHER_PLAN_PRICE" "const TEACHER_PLAN_PRICE="

echo ""

# ── Required strings (must exist) ────────────────────────────────────────────
echo "-- Required strings --"

require() {
  local label="$1" pattern="$2"
  if has_pattern "$pattern"; then
    pass "Required: $label"
  else
    fail "Missing required: $label — pattern: $pattern"
  fi
}

require "Commission is zero"            "const COMMISSION_RATE=0"
require "Dark header gradient"          "linear-gradient(150deg,#0F1A1F 0%,#0e7a72 45%,#8b2fc9 100%)"
require "Firebase project kidemy-83a17" "kidemy-83a17"
require "App name Drushe"               "Drushe"
require "Student approval listener fn"  "_attachStudentApprovalListener"
require "Student pending guard in render" "verified!==true&&!isAdmin()"

echo ""

# ── Forbidden strings (must NOT exist) ───────────────────────────────────────
echo "-- Forbidden strings --"

forbid() {
  local label="$1" pattern="$2"
  if has_pattern "$pattern"; then
    fail "Forbidden pattern found: $label — pattern: $pattern"
  else
    pass "Not present: $label"
  fi
}

forbid "Wrong app name (Lamdeni)"   "Lamdeni"
forbid "Wrong app name (Kidemy)"    "Kidemy"
forbid "Direct eval()"              "eval("
# שמות שתי הרשימות שהוסרו. חזרה שלהן פירושה שמסלול מחיקה שני נולד מחדש.
forbid "Second deletion path list" "pathsToDelete"
forbid "Third deletion path list"  "allPaths"

echo ""

# ── מחיר המנוי — חוצה קבצים ──────────────────────────────────────────────────
# המחיר לא חי רק ב-index.html. הוא מופיע גם בהודעות הגיוס שנשלחות למורים,
# בתשובות שהוגשו לדירוג הגיל בחנויות ובתיאור העסקי. שינוי מחיר שמעדכן רק את
# הקוד משאיר מורה שמקבל הודעה עם מחיר אחד ורואה באפליקציה מחיר אחר — וזו
# בדיוק הסיבה שהבדיקה הזו סורקת יותר מקובץ אחד, בניגוד לשאר הבדיקות כאן.
echo "-- Price consistency (multi-file) --"

OLD_PRICE="₪79"
PRICE_FILES="index.html mobile/recruiting-messages.txt mobile/age-rating-answers.txt drushe-business-description.txt"
price_violations=0
for f in $PRICE_FILES; do
  [ -f "$f" ] || continue
  if grep -q "$OLD_PRICE" "$f"; then
    fail "Old price $OLD_PRICE still written in $f"
    price_violations=$((price_violations + 1))
  fi
done
[ "$price_violations" -eq 0 ] && pass "Old price $OLD_PRICE absent from all price-bearing files"

echo ""

# ── כותרות אבטחה ב-netlify.toml ──────────────────────────────────────────────
# כותרת אבטחה שנעלמת לא שוברת כלום ולא מייצרת שגיאה — היא פשוט מפסיקה להגן.
# באפליקציה שמחזיקה מידע על קטינים זו לא תקלה שאפשר לגלות מאוחר.
echo "-- Security headers --"

hdr_check() {
  if grep -q "$1" netlify.toml 2>/dev/null; then
    pass "Header present: $1"
  else
    fail "Security header missing from netlify.toml: $1"
  fi
}

hdr_check "X-Content-Type-Options"
hdr_check "Referrer-Policy"
hdr_check "X-Frame-Options"
hdr_check "Permissions-Policy"
hdr_check "Strict-Transport-Security"

echo ""

# ── Result ────────────────────────────────────────────────────────────────────
if [ "$ERRORS" -gt 0 ]; then
  echo "🚫  Validation FAILED — $ERRORS violation(s). Deploy blocked."
  exit 1
else
  echo "✅  All checks passed. Deploy may proceed."
  exit 0
fi
