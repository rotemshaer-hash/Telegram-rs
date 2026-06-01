from telethon import TelegramClient, events
from telethon.sessions import StringSession
from telethon.errors import FloodWaitError, ChatWriteForbiddenError
import os
import asyncio
import logging
import re
import sys
from datetime import datetime, timezone

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s  %(levelname)-8s  %(message)s',
    datefmt='%H:%M:%S',
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────────────────────
def _env(key, cast=str):
    val = os.environ.get(key)
    if not val:
        log.critical(f"Missing required env var: {key}")
        sys.exit(1)
    try:
        return cast(val)
    except (ValueError, TypeError):
        log.critical(f"Invalid value for {key} — expected {cast.__name__}")
        sys.exit(1)

API_ID   = _env('API_ID', int)
API_HASH = _env('API_HASH')
SESSION  = _env('SESSION_STRING')
TARGET   = _env('TARGET_GROUP', int)
SOURCES  = [int(s.strip()) for s in _env('SOURCE_GROUPS').split(',') if s.strip()]

# ── Keywords ──────────────────────────────────────────────────────────────────
_HE_AR = [
    # Hebrew
    'איראן', 'ישראל', 'לבנון', 'חיזבאללה', 'מלחמה', 'טיל', 'טילים',
    'תקיפה', 'הפסקת אש', 'נתניהו', 'טראמפ', 'גרעין',
    # Arabic
    'إيران', 'إسرائيل', 'لبنان', 'حزب الله', 'حرب', 'صاروخ',
]
# English uses word-boundary matching to avoid false positives
# ("hardware" ≠ "war", "awareness" ≠ "war", etc.)
_EN = {
    'iran', 'israel', 'lebanon', 'hezbollah', 'war', 'missile',
    'ceasefire', 'idf', 'nuclear', 'attack',
}
_en_re = re.compile(
    r'\b(' + '|'.join(re.escape(k) for k in sorted(_EN)) + r')\b',
    re.IGNORECASE,
)

def has_keyword(text):
    if not text:
        return False
    # Hebrew/Arabic: simple substring match (no case in these scripts)
    if any(k in text for k in _HE_AR):
        return True
    # English: whole-word only
    return bool(_en_re.search(text))

# ── Runtime state ─────────────────────────────────────────────────────────────
_forwarded = 0
_seen = set()   # (chat_id, msg_id) — prevents forwarding the same message twice

client = TelegramClient(StringSession(SESSION), API_ID, API_HASH)

# ── Message handler ───────────────────────────────────────────────────────────
@client.on(events.NewMessage(chats=SOURCES))
async def handler(event):
    global _forwarded
    msg = event.message
    key = (event.chat_id, msg.id)

    if not msg.text or key in _seen or not has_keyword(msg.text):
        return

    _seen.add(key)
    # Prevent unbounded memory growth on long-running deployments
    if len(_seen) > 10_000:
        _seen.clear()

    source = getattr(event.chat, 'title', None) or str(event.chat_id)
    ts     = datetime.now(timezone.utc).strftime('%H:%M UTC')
    log.info(f"↪  [{source}]  {msg.text[:70]!r}")

    body = f"📢 {source}  ·  {ts}\n{'─' * 32}\n{msg.text}"

    for attempt in range(1, 4):
        try:
            await client.send_message(TARGET, body)
            _forwarded += 1
            log.info(f"✓  Forwarded #{_forwarded}  (msg_id={msg.id})")
            return
        except FloodWaitError as e:
            log.warning(f"FloodWait — sleeping {e.seconds}s  (attempt {attempt}/3)")
            await asyncio.sleep(e.seconds)
        except ChatWriteForbiddenError:
            log.error("Cannot write to target group — check account permissions")
            return
        except Exception as exc:
            wait = 2 ** attempt
            log.warning(f"Send failed: {exc}  — retry in {wait}s  (attempt {attempt}/3)")
            await asyncio.sleep(wait)

    log.error(f"Gave up on msg_id={msg.id} after 3 attempts")


# ── Hourly heartbeat ──────────────────────────────────────────────────────────
async def heartbeat():
    while True:
        await asyncio.sleep(3600)
        log.info(f"♡  Heartbeat — {_forwarded} forwarded | {len(_seen)} IDs cached")


# ── Entry point ───────────────────────────────────────────────────────────────
async def main():
    for line in (
        "┌──────────────────────────────────────┐",
        "│   Telegram Intel Bot  ·  v2.0        │",
        "└──────────────────────────────────────┘",
    ):
        log.info(line)

    log.info(f"Sources  : {len(SOURCES)} group(s)  →  target {TARGET}")
    log.info(f"Keywords : {len(_HE_AR) + len(_EN)}  (HE + AR + EN word-boundary)")

    await client.connect()
    if not await client.is_user_authorized():
        log.critical("Session not authorized — regenerate SESSION_STRING")
        return

    me = await client.get_me()
    log.info(f"Account  : {me.first_name}  (@{me.username or me.id})")
    log.info("Ready — listening for messages…\n")

    asyncio.create_task(heartbeat())
    await client.run_until_disconnected()
    log.info(f"Disconnected — {_forwarded} messages forwarded this session")


asyncio.run(main())
