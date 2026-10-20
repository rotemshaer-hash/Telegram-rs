# WhatsApp Group Summary Bot

Reads a configured list of WhatsApp groups (read-only — never replies, reacts,
or messages anyone), and once a day at 21:00 Asia/Jerusalem sends a Hebrew
summary of the day to your own "Message Yourself" chat via the Claude API.
Messages are kept in memory only, and only until the summary is built — never
written to disk, and media is never stored.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in `ANTHROPIC_API_KEY` and
   `WHATSAPP_PHONE_NUMBER` (digits only, international format, e.g.
   `972501234567`).
3. List the exact names of the WhatsApp groups to follow — either the
   `GROUPS` env var (one name per line) or, for local dev, copy
   `groups.config.example.json` to `groups.config.json`. `GROUPS` wins if
   both are set. Use `GROUPS` in production: the JSON file is gitignored on
   purpose (group names can be sensitive), so it won't exist on a server
   deployed straight from GitHub.
4. `npm run dev` (or `npm run build && npm start` for production).
5. Open the status page at `http://localhost:3000` (or whatever `PORT` is
   set to) — it shows the WhatsApp pairing code once the socket connects.
   In WhatsApp: Settings → Linked Devices → Link a Device → "Link with phone
   number instead" → enter that code.

## How it works

- `src/whatsapp.ts` — Baileys connection, pairing-code login, persisted auth
  state (`AUTH_DIR`, must be a persistent volume in production), and the
  read-only message filter (only configured groups + the manual trigger in
  your own chat; everything else is ignored, not stored, not replied to).
- `src/groups.ts` — loads `groups.config.json` and matches names against the
  groups Baileys reports the account participates in.
- `src/store.ts` — in-memory-only message buffer, cleared after a summary is
  sent successfully.
- `src/summarize.ts` — builds the transcript and calls the Claude API
  (model configurable via `CLAUDE_MODEL`, default `claude-opus-5-5`).
- `src/scheduler.ts` — the 21:00 `Asia/Jerusalem` cron job, and the same
  summary logic used by the manual "סכם עכשיו" trigger.
- `src/statusServer.ts` — a tiny phone-friendly status page: shows the
  pairing code, connection state, and any group names from the config that
  weren't found.

## Manual trigger

Send yourself (in your own "Message Yourself" chat) the exact text
`סכם עכשיו` to generate and send an immediate summary of everything
collected so far, without waiting for 21:00.

## Required environment variables

See `.env.example`. Never commit `.env` or the `AUTH_DIR` contents —
both are gitignored.
