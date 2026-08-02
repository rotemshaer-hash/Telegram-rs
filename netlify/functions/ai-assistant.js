// Drushe AI Assistant — serverless proxy to the Claude API.
//
// Runs on Netlify Functions so the Anthropic API key never reaches the
// browser. Requires an ANTHROPIC_API_KEY environment variable set in the
// Netlify site's Build & deploy → Environment settings.
//
// Two grounded modes, both designed to avoid hallucination:
//   "search" — turns a free-text query into structured filters (category,
//              city, max price). The client matches those filters against
//              the REAL teacher list itself; Claude never invents a teacher.
//   "ask"    — answers a safety/policy question using ONLY the platform's
//              own safety-page copy as context, so answers can't drift from
//              what Drushe actually promises parents.

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
const ANTHROPIC_VERSION = '2023-06-01';

const CATEGORY_IDS = [
  'math','english','hebrew','guitar','art','dance','football','chess','coding',
  'cooking','barber','nails','makeup','freelance','photo','design','history',
  'science','tutoring','singing','swimming','robotics','babysit','arabic'
];

const SAFETY_CONTEXT = `
תהליך ההרשמה: כל ילד (מורה או תלמיד) חייב לספק שם, מייל וטלפון של הורה — בלי הורה אין הרשמה.
ההורה מקבל הודעה אוטומטית על ההרשמה ויכול לאשר או לדחות אותה.
כל מורה עובר בדיקה ידנית של צוות Drushe (כולל אימות גיל וזהות) לפני שהוא מופיע לתלמידים.
השיעור הראשון הוא תמיד "שיעור ניסיון" קצר ומפוקח, ושני הצדדים יכולים לעצור בכל שלב.
הורים מקבלים דוח שבועי אוטומטי במייל, יכולים לצפות בכל הצ'אטים של הילד/ה (דרך פרטי ההתחברות של הילד/ה),
ומקבלים עדכון על כל תשלום.
שיעורים מתקיימים אונליין (Zoom / Google Meet / Teams) דרך קישור אישי שהמורה קובע.
אחרי כל שיעור שני הצדדים מדרגים אחד את השני.
אפשר לדווח על כל תוכן או משתמש בלחיצת כפתור, וצוות Drushe מטפל תוך 24 שעות.
Drushe לא גובה עמלה — המורים משלמים מנוי, התלמידים לומדים בחינם מצד האפליקציה (משלמים למורה ישירות).
לשאלות שאין להן תשובה בהקשר הזה, יש להפנות ל-WhatsApp של הצוות ולא לנחש.
`.trim();

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'method not allowed' }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'AI not configured yet — missing ANTHROPIC_API_KEY' }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'invalid JSON body' }) };
  }

  const mode = payload.mode;
  const message = (payload.message || '').toString().slice(0, 600).trim();
  if (!message) return { statusCode: 400, headers, body: JSON.stringify({ error: 'missing message' }) };
  if (mode !== 'search' && mode !== 'ask') {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'mode must be "search" or "ask"' }) };
  }

  let system, maxTokens;
  if (mode === 'search') {
    maxTokens = 300;
    system = `אתה מפרש כוונת חיפוש למורים באפליקציית Drushe, פלטפורמה שבה בני נוער מלמדים ילדים אחרים.
קטגוריות אפשריות (id בלבד): ${CATEGORY_IDS.join(', ')}.
קרא את הבקשה של המשתמש והחזר אך ורק JSON תקני בפורמט הזה, בלי טקסט נוסף לפניו או אחריו:
{"categories": ["id1","id2"], "city": "שם עיר או null", "maxPrice": מספר או null, "reasoning": "משפט קצר בעברית שמסביר איך הבנת את הבקשה"}
- categories: 0-3 מזהי קטגוריה מהרשימה בלבד שהכי מתאימים לבקשה. אם אין התאמה ברורה, מערך ריק.
- אל תמציא קטגוריות שאינן ברשימה. אל תמציא מורים — אתה לא ניגש למאגר המורים בפועל.`;
  } else {
    maxTokens = 1024;
    system = `אתה עוזר ה-AI של Drushe, פלטפורמת שיעורים פרטיים שבה בני נוער מלמדים ילדים אחרים, בפיקוח הורים מלא.
ענה על שאלות של הורים/תלמידים/מורים בעברית, בקצרה וברורות, אך ורק על סמך המידע הבא — אל תמציא מדיניות שלא מופיעה כאן:
---
${SAFETY_CONTEXT}
---
אם השאלה לא נענית מהמידע הזה, אמור זאת בכנות והפנה ליצירת קשר עם צוות Drushe דרך WhatsApp באפליקציה. אל תנחש.`;
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: message }],
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      return { statusCode: res.status, headers, body: JSON.stringify({ error: data?.error?.message || 'Claude API error' }) };
    }

    const text = (data.content || []).map((b) => b.text || '').join('');

    if (mode === 'search') {
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        return { statusCode: 502, headers, body: JSON.stringify({ error: 'could not parse AI response' }) };
      }
      const categories = Array.isArray(parsed.categories) ? parsed.categories.filter((c) => CATEGORY_IDS.includes(c)) : [];
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          categories,
          city: typeof parsed.city === 'string' ? parsed.city : null,
          maxPrice: typeof parsed.maxPrice === 'number' ? parsed.maxPrice : null,
          reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
        }),
      };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ answer: text }) };
  } catch (e) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: e.message || 'network error calling Claude' }) };
  }
};
