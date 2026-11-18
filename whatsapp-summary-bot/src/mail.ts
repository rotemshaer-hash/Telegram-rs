import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { config } from './config.js';

const NOT_CONFIGURED = 'המייל עדיין לא מחובר (חסרים GMAIL_ADDRESS / GMAIL_APP_PASSWORD בהגדרות השרת).';
const MAX_BODY_CHARS = 6000;

function enabled(): boolean {
  return Boolean(config.gmailAddress && config.gmailAppPassword);
}

// Read-only access: the mailbox is opened with readOnly, so nothing is ever
// marked as read, moved, deleted or sent.
async function withAllMail<T>(fn: (client: ImapFlow) => Promise<T>): Promise<T> {
  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: config.gmailAddress, pass: config.gmailAppPassword },
    logger: false,
  });
  await client.connect();
  try {
    // Gmail localizes folder names, so find "All Mail" by its special-use flag.
    const boxes = await client.list();
    const allMail = boxes.find((b) => b.specialUse === '\\All')?.path ?? 'INBOX';
    const lock = await client.getMailboxLock(allMail, { readOnly: true });
    try {
      return await fn(client);
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => undefined);
  }
}

function formatDate(value: Date | string | undefined): string {
  if (!value) return '?';
  const d = new Date(value);
  return new Intl.DateTimeFormat('he-IL', {
    timeZone: config.timezone,
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

export async function searchEmail(query: string, max: number): Promise<string> {
  if (!enabled()) return NOT_CONFIGURED;
  return withAllMail(async (client) => {
    const uids = await client.search({ gmraw: query }, { uid: true });
    if (!uids || uids.length === 0) return 'לא נמצאו מיילים.';
    const newest = uids.slice(-max);
    const messages = await client.fetchAll(newest.join(','), { uid: true, envelope: true }, { uid: true });
    const time = (d: Date | string | undefined) => (d ? new Date(d).getTime() : 0);
    messages.sort((a, b) => time(b.envelope?.date) - time(a.envelope?.date));
    return messages
      .map((m) => {
        const from = m.envelope?.from?.[0];
        const sender = from ? `${from.name ?? ''} <${from.address ?? ''}>`.trim() : '?';
        return `uid=${m.uid} | ${formatDate(m.envelope?.date)} | מאת: ${sender} | נושא: ${m.envelope?.subject ?? ''}`;
      })
      .join('\n');
  });
}

export async function readEmail(uid: number): Promise<string> {
  if (!enabled()) return NOT_CONFIGURED;
  return withAllMail(async (client) => {
    const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
    if (!msg || !msg.source) return 'המייל לא נמצא.';
    const parsed = await simpleParser(msg.source);
    let body = parsed.text?.trim() ?? '';
    if (!body && typeof parsed.html === 'string') {
      body = parsed.html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }
    if (body.length > MAX_BODY_CHARS) body = `${body.slice(0, MAX_BODY_CHARS)}\n[...המשך המייל קוצר]`;
    const header = [
      `מאת: ${parsed.from?.text ?? '?'}`,
      `נושא: ${parsed.subject ?? ''}`,
      `תאריך: ${formatDate(parsed.date)}`,
    ];
    const attachments = parsed.attachments.map((a) => a.filename ?? 'קובץ').join(', ');
    if (attachments) header.push(`קבצים מצורפים (שמות בלבד): ${attachments}`);
    return `${header.join('\n')}\n\n${body}`;
  });
}
