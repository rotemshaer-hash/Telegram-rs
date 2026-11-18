import IcalExpander from 'ical-expander';
import { config } from './config.js';

const NOT_CONFIGURED = 'היומן עדיין לא מחובר (חסר GOOGLE_CALENDAR_ICS_URL בהגדרות השרת).';
const DAY_MS = 24 * 60 * 60 * 1000;
const CACHE_MS = 5 * 60 * 1000;

let cache: { fetchedAt: number; ics: string } | null = null;

async function getIcs(): Promise<string> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_MS) return cache.ics;
  const res = await fetch(config.calendarIcsUrl);
  if (!res.ok) throw new Error(`calendar fetch failed: ${res.status}`);
  cache = { fetchedAt: Date.now(), ics: await res.text() };
  return cache.ics;
}

/** YYYY-MM-DD of a moment, as seen in Israel. */
function israelDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone }).format(d);
}

function formatWhen(start: Date, allDay: boolean): string {
  return new Intl.DateTimeFormat('he-IL', {
    timeZone: config.timezone,
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    ...(allDay ? {} : { hour: '2-digit', minute: '2-digit' }),
  }).format(start);
}

interface IcalTime {
  isDate: boolean;
  year: number;
  month: number;
  day: number;
  toJSDate(): Date;
}

/** `from` / `to` are YYYY-MM-DD dates in Israel time, both inclusive. */
export async function listEvents(from: string, to: string): Promise<string> {
  if (!config.calendarIcsUrl) return NOT_CONFIGURED;
  const expander = new IcalExpander({ ics: await getIcs(), maxIterations: 1000 });
  // Widen the window by a day on each side, then filter by the Israel-local date,
  // so time-zone offsets can't drop an event at the edge of the range.
  const after = new Date(Date.parse(`${from}T00:00:00Z`) - DAY_MS);
  const before = new Date(Date.parse(`${to}T00:00:00Z`) + 2 * DAY_MS);
  const { events, occurrences } = expander.between(after, before);

  const items = [
    ...events.map((e) => ({ start: e.startDate as unknown as IcalTime, summary: e.summary, location: e.location })),
    ...occurrences.map((o) => ({
      start: o.startDate as unknown as IcalTime,
      summary: o.item.summary,
      location: o.item.location,
    })),
  ]
    .map((e) => {
      const allDay = e.start.isDate;
      const day = allDay
        ? `${e.start.year}-${String(e.start.month).padStart(2, '0')}-${String(e.start.day).padStart(2, '0')}`
        : israelDate(e.start.toJSDate());
      const startDate = allDay ? new Date(`${day}T12:00:00Z`) : e.start.toJSDate();
      return { ...e, allDay, day, startDate };
    })
    .filter((e) => e.day >= from && e.day <= to)
    .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

  if (items.length === 0) return 'אין אירועים ביומן בטווח הזה.';
  return items
    .map((e) => `${formatWhen(e.startDate, e.allDay)}${e.allDay ? ' (כל היום)' : ''} — ${e.summary || '(ללא שם)'}${e.location ? ` @ ${e.location}` : ''}`)
    .join('\n');
}

/** "2026-11-20T15:30" or "2026-11-20" (all day), Israel wall-clock time. */
function compact(local: string): string {
  return local.replace(/[-:]/g, '').replace(/(T\d{4})$/, '$100');
}

function addToLocal(local: string, ms: number): string {
  const allDay = !local.includes('T');
  const d = new Date(Date.parse(allDay ? `${local}T00:00:00Z` : `${local}:00Z`) + ms);
  const iso = d.toISOString();
  return allDay ? iso.slice(0, 10) : iso.slice(0, 16);
}

/**
 * A Google Calendar "add event" link. Nothing is saved until Rotem opens the
 * link and taps Save himself — the bot never writes to the calendar.
 */
export function calendarLink(input: {
  title: string;
  start: string;
  end?: string;
  details?: string;
  location?: string;
}): string {
  const allDay = !input.start.includes('T');
  const end = input.end ?? addToLocal(input.start, allDay ? DAY_MS : 60 * 60 * 1000);
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: input.title,
    dates: `${compact(input.start)}/${compact(end)}`,
    ctz: config.timezone,
  });
  if (input.details) params.set('details', input.details);
  if (input.location) params.set('location', input.location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
