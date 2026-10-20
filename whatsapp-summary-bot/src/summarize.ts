import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';
import type { GroupMessages } from './types.js';

const client = new Anthropic({ apiKey: config.anthropicApiKey });

const NO_ACTIVITY_MESSAGE = 'לא הייתה היום פעילות באף אחת מהקבוצות שעליהן אני עוקב.';

const SYSTEM_PROMPT = `אתה עוזר שמסכם צ'אטים של קבוצות וואטסאפ בשביל אדם אחד, בעברית, לקריאה מהירה בנייד.
תקבל תמלול של הודעות מהיום, מחולק לפי קבוצות. תחזיר סיכום יומי אחד, במבנה הבא בדיוק, בעברית:

📌 חשוב עכשיו
- פריט לכל דבר שמבקשים/פונים אליו אישית, שאלה שמחכה לתשובה שלו, דדליין/תאריך, שינוי תוכנית או בעיה דחופה.
- כל פריט: *שם הקבוצה* — מי כתב — ומה צריך לעשות. שורה אחת לכל פריט.
- אם אין שום דבר כזה, כתוב בדיוק: "אין דברים דחופים היום" ועבור להמשך.

✅ החלטות שהתקבלו
- רשימת החלטות שסוכמו היום, שורה לכל החלטה, עם שם הקבוצה.
- אם אין החלטות, כתוב "לא התקבלו החלטות היום".

🗂️ סיכום לפי קבוצה
- לכל קבוצה שהייתה בה פעילות: כותרת עם שם הקבוצה, ואחריה 2-3 שורות שמסכמות על מה דיברו.
- קבוצה בלי פעילות — פשוט לא מופיעה כאן.

🔁 לזכור מחר
- פריטים שכדאי לו לזכור או לעקוב אחריהם למחר. אם אין, כתוב "אין דבר מיוחד לזכור".

כתוב בעברית פשוטה וקצרה, בלי הקדמות ובלי סיכום-על-הסיכום. אל תמציא מידע שלא קיים בתמלול.`;

function formatTime(timestampMs: number): string {
  return new Intl.DateTimeFormat('he-IL', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: config.timezone,
  }).format(new Date(timestampMs));
}

function buildTranscript(groups: GroupMessages[]): string {
  return groups
    .map((group) => {
      const lines = group.messages
        .map((m) => `[${formatTime(m.timestampMs)}] ${m.sender}: ${m.text}`)
        .join('\n');
      return `### קבוצה: ${group.groupName}\n${lines}`;
    })
    .join('\n\n');
}

/**
 * Returns the full summary text, or null when there was nothing to summarize
 * (in which case no Claude API call is made at all).
 */
export async function createDailySummary(groups: GroupMessages[]): Promise<string | null> {
  const activeGroups = groups.filter((g) => g.messages.length > 0);
  if (activeGroups.length === 0) {
    return null;
  }

  const transcript = buildTranscript(activeGroups);

  const response = await client.messages.create({
    model: config.claudeModel,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: transcript }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  return textBlock?.type === 'text' ? textBlock.text : null;
}

export function noActivityMessage(): string {
  return NO_ACTIVITY_MESSAGE;
}

const MAX_CHUNK_LENGTH = 3500;

/** Splits a long summary into WhatsApp-friendly chunks, breaking between paragraphs/sections. */
export function splitForWhatsApp(text: string): string[] {
  if (text.length <= MAX_CHUNK_LENGTH) return [text];

  const paragraphs = text.split(/\n\n+/);
  const chunks: string[] = [];
  let current = '';

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length > MAX_CHUNK_LENGTH && current) {
      chunks.push(current);
      current = paragraph;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);

  return chunks;
}
