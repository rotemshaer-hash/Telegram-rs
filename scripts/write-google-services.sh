#!/usr/bin/env bash
# כותב את mobile/android/app/google-services.json מתוך הסוד GOOGLE_SERVICES_JSON.
#
# הקובץ אינו בריפו (ראה mobile/.gitignore) — הריפו ציבורי, והקובץ מזהה את
# פרויקט ה-Firebase. בלעדיו האפליקציה עדיין נבנית ורצה, אבל בלי התראות
# נייטיב: build.gradle מחיל את תוסף google-services רק אם הקובץ קיים.
#
# לכן חסר סוד הוא אזהרה ולא כישלון — אחרת כל בנייה של מפתח בלי הסוד הייתה
# נשברת, במקום פשוט לוותר על הפיצ'ר.
set -euo pipefail

DEST="mobile/android/app/google-services.json"

if [ -z "${GOOGLE_SERVICES_JSON:-}" ]; then
  echo "::warning::GOOGLE_SERVICES_JSON is not set — building without native push notifications."
  exit 0
fi

printf '%s' "$GOOGLE_SERVICES_JSON" > "$DEST"

# אימות מיידי: JSON פגום היה עובר בשקט כאן ומתפוצץ כמאות שורות שגיאת gradle
# בהמשך, או גרוע מכך — נבנה בלי התראות בלי שאיש ישים לב.
if ! python3 -c "import json,sys; json.load(open('$DEST'))" 2>/dev/null; then
  echo "::error::GOOGLE_SERVICES_JSON is not valid JSON. Re-copy it from the Firebase console."
  exit 1
fi

echo "Wrote $DEST ($(wc -c < "$DEST") bytes)"
