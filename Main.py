TelegramClient, events
from telethon.sessions import StringSession
import os
import asyncio

API_ID = int(os.environ['API_ID'])
API_HASH = os.environ['API_HASH']
SESSION = os.environ.get('SESSION_STRING', '')
print(f"Session length: {len(SESSION)}")
TARGET = int(os.environ['TARGET_GROUP'])
SOURCES = os.environ['SOURCE_GROUPS'].split(',')

KEYWORDS = [
    'איראן','ישראל','לבנון','חיזבאללה','מלחמה','טיל',
    'iran','israel','lebanon','hezbollah','war','missile',
    'إيران','إسرائيل','لبنان','حرب'
]

client = TelegramClient(StringSession(SESSION), API_ID, API_HASH)

def has_keyword(text):
    if not text:
        return False
    t = text.lower()
    return any(k.lower() in t for k in KEYWORDS)

@client.on(events.NewMessage(chats=SOURCES))
async def handler(event):
    if has_keyword(event.message.text):
        await client.send_message(TARGET, f"📢 {event.message.text}")

async def main():
    await client.connect()
    if not await client.is_user_authorized():
        print("Not authorized!")
        return
    print("Bot running...")
    await client.run_until_disconnected()
