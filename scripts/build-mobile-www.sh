#!/bin/bash
# אורז את האתר לתוך mobile/www כדי שהאפליקציה תרוץ מתוך עצמה ולא תטען אתר חי.
#
# למה זה קיים: capacitor.config.json מגדיר server.url, כלומר האפליקציה פותחת
# את https://kidemy-app.netlify.app בתוך WebView. באנדרואיד זה עובד, וזה גם מה
# שמאפשר לעדכון להגיע למכשיר בלי בנייה חדשה — ולכן שם זה נשאר.
#
# אפל דוחה את זה. Guideline 4.2 (Minimum Functionality) קובע שאפליקציה שהיא
# בעיקר מעטפת לאתר אינה מספיקה כדי להיות באפ סטור, וזו סיבת הדחייה הנפוצה
# ביותר. הדרך לעמוד בכך היא שהתוכן ייארז בתוך האפליקציה.
#
# הסקריפט מעתיק את כל מה שהאתר צריך בזמן ריצה. הוא לא מעתיק קבצי פיתוח
# (workflows, בדיקות, חוקי DB) — הם לא חלק ממה שרץ במכשיר, ואין סיבה לשלוח
# אותם לחנות.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WWW="$ROOT/mobile/www"

echo "==> אורז את האתר אל $WWW"
rm -rf "$WWW"
mkdir -p "$WWW"

# הדף הראשי + הדפים שהאפליקציה מקשרת אליהם ישירות (מדיניות פרטיות, תנאים,
# בטיחות ילדים, מחיקת חשבון). בגרסה ארוזה href="/privacy.html" מצביע פנימה,
# ולכן הקבצים האלה חייבים להיות כאן — אחרת הקישורים יובילו לשום מקום.
FILES=(
  index.html
  privacy.html
  terms.html
  child-safety.html
  delete-account.html
  manifest.json
  sw.js
  favicon-32.png
  icon-180.png
  icon-192.png
  icon-512.png
)

for f in "${FILES[@]}"; do
  if [ -f "$ROOT/$f" ]; then
    cp "$ROOT/$f" "$WWW/$f"
    echo "    ✓ $f"
  else
    echo "    ✗ חסר: $f" >&2
    exit 1
  fi
done

# בדיקת שפיות: אם index.html הועתק ריק או קטן בצורה חשודה, עדיף להיכשל כאן
# מאשר לגלות את זה כשהאפליקציה עולה ריקה במכשיר של בודק מטעם אפל.
SIZE=$(wc -c < "$WWW/index.html")
if [ "$SIZE" -lt 100000 ]; then
  echo "✗ index.html שהועתק הוא $SIZE בתים — קטן מדי, משהו השתבש" >&2
  exit 1
fi

echo "==> נארזו ${#FILES[@]} קבצים · index.html: $SIZE בתים"
