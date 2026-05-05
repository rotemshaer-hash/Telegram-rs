from telethon.sync import TelegramClient, events
from telethon.sessions import StringSession
import os

API_ID = int(os.environ['API_ID'])
API_HASH = os.environ['API_HASH']
SESSION = os.environ['SESSION_STRING']
TARGET = int(os.environ['TARGET_GROUP'])
SOURCES = os.environ['SOURCE_GROUPS'].split(',')

KEYWORDS = [
    'איראן','ישראל','לבנון','חיזבאללה','מלחמה','טיל',
    'iran','israel','lebanon','hezbollah','war','missile',
    'إيران','إسرائيل','لبنان','حرب'
]

def has_keyword(text):
    if not text:
        return False
    return any(k.lower() in text.lower() for k in KEYWORDS)

with TelegramClient(StringSession(SESSION), API_ID, API_HASH) as client:
    print("Bot running...")

    @client.on(events.NewMessage(chats=SOURCES))
    async def handler(event):
        if has_keyword(event.message.text):
            await client.send_message(TARGET, f"📢 {event.message.text}")

    client.run_until_disconnected()
