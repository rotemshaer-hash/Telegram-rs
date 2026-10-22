import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  jidNormalizedUser,
  fetchLatestBaileysVersion,
  type WASocket,
  type WAMessage,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import { config } from './config.js';
import { resolveGroups } from './groups.js';
import type { StoredMessage } from './types.js';

const logger = pino({ level: 'warn' });

export interface WhatsAppCallbacks {
  onPairingCode: (code: string) => void;
  onConnected: (selfJid: string) => void;
  onDisconnected: (reason: string) => void;
  onGroupsResolved: (matched: Map<string, string>, missing: string[]) => void;
  onGroupMessage: (groupJid: string, groupName: string, message: StoredMessage) => void;
  onManualTrigger: () => void;
}

let currentSock: WASocket | null = null;
let selfJid: string | null = null;
let groupJidToName: Map<string, string> = new Map();

function extractText(msg: WAMessage): string | null {
  const m = msg.message;
  if (!m) return null;
  if (m.conversation) return m.conversation;
  if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
  if (m.imageMessage) return m.imageMessage.caption ? `[תמונה] ${m.imageMessage.caption}` : '[תמונה]';
  if (m.videoMessage) return m.videoMessage.caption ? `[סרטון] ${m.videoMessage.caption}` : '[סרטון]';
  if (m.documentMessage) return `[קובץ] ${m.documentMessage.fileName ?? ''}`.trim();
  if (m.audioMessage) return m.audioMessage.ptt ? '[הודעה קולית]' : '[קובץ שמע]';
  if (m.stickerMessage) return '[סטיקר]';
  if (m.locationMessage) return '[שליחת מיקום]';
  if (m.contactMessage) return '[שליחת איש קשר]';
  if (m.buttonsResponseMessage?.selectedDisplayText) return m.buttonsResponseMessage.selectedDisplayText;
  if (m.listResponseMessage?.title) return m.listResponseMessage.title;
  return null;
}

function senderName(msg: WAMessage): string {
  return msg.pushName?.trim() || msg.key.participant?.split('@')[0] || msg.key.remoteJid?.split('@')[0] || 'לא ידוע';
}

function timestampMs(msg: WAMessage): number {
  const ts = msg.messageTimestamp;
  if (typeof ts === 'number') return ts * 1000;
  if (ts && typeof ts.toNumber === 'function') return ts.toNumber() * 1000;
  return Date.now();
}

async function start(callbacks: WhatsAppCallbacks): Promise<void> {
  const { state, saveCreds } = await useMultiFileAuthState(config.authDir);
  const { version } = await fetchLatestBaileysVersion();

  console.log('creating socket, version', version);
  const sock = makeWASocket({
    auth: state,
    version,
    logger,
    markOnlineOnConnect: false,
    printQRInTerminal: false,
  });
  currentSock = sock;

  sock.ev.on('creds.update', saveCreds);

  if (!state.creds.registered) {
    // The pairing-code request fails with "Connection Closed" if the socket's
    // WebSocket handshake hasn't finished yet — how long that takes varies,
    // so retry instead of trusting a single fixed delay.
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    let code: string | undefined;
    for (let attempt = 1; attempt <= 6 && !code; attempt++) {
      await delay(2000);
      try {
        code = await sock.requestPairingCode(config.whatsappPhoneNumber);
      } catch (err) {
        console.log(
          `pairing code attempt ${attempt} failed:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
    if (code) {
      callbacks.onPairingCode(code);
      console.log('got pairing code', code);
    } else {
      logger.error('failed to request pairing code after retries');
    }
  }

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    console.log('connection.update', {
      connection,
      hasQr: !!qr,
      lastDisconnect: lastDisconnect
        ? {
            message: (lastDisconnect.error as Error | undefined)?.message,
            statusCode: (lastDisconnect.error as Boom | undefined)?.output?.statusCode,
            payload: (lastDisconnect.error as Boom | undefined)?.output?.payload,
          }
        : undefined,
    });

    if (connection === 'open') {
      selfJid = jidNormalizedUser(sock.user!.id);
      try {
        const { matched, missing } = await resolveGroups(sock);
        groupJidToName = matched;
        callbacks.onGroupsResolved(matched, missing);
      } catch (err) {
        logger.error(err, 'failed to resolve groups');
      }
      callbacks.onConnected(selfJid);
    } else if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      callbacks.onDisconnected(loggedOut ? 'logged_out' : `code_${statusCode ?? 'unknown'}`);
      currentSock = null;
      if (!loggedOut) {
        setTimeout(() => void start(callbacks), 3000);
      }
    }
  });

  sock.ev.on('messages.upsert', ({ messages, type }) => {
    console.log(
      'messages.upsert',
      type,
      messages.map((m) => ({
        remoteJid: m.key.remoteJid,
        fromMe: m.key.fromMe,
        hasMessage: !!m.message,
        selfJid,
      })),
    );
    if (type !== 'notify' && type !== 'append') return;
    for (const msg of messages) {
      const remoteJid = msg.key.remoteJid;
      if (!remoteJid || msg.message?.protocolMessage) continue;

      // Self-chat: only ever look for the manual "summarize now" trigger.
      if (selfJid && remoteJid === selfJid) {
        if (msg.key.fromMe) {
          const text = extractText(msg);
          if (text) {
            console.log(
              'self-chat text:',
              JSON.stringify(text),
              'codepoints:',
              Array.from(text)
                .map((c) => c.codePointAt(0)!.toString(16))
                .join(' '),
            );
          }
          if (text && text.trim() === config.manualTriggerPhrase) {
            callbacks.onManualTrigger();
          }
        }
        continue;
      }

      // Anything that isn't one of the configured groups is ignored entirely —
      // no storage, no read, no reply.
      if (!remoteJid.endsWith('@g.us')) continue;
      const groupName = groupJidToName.get(remoteJid);
      if (!groupName) continue;

      const text = extractText(msg);
      if (!text) continue;

      callbacks.onGroupMessage(remoteJid, groupName, {
        sender: senderName(msg),
        text,
        timestampMs: timestampMs(msg),
      });
    }
  });
}

export function connectWhatsApp(callbacks: WhatsAppCallbacks): void {
  void start(callbacks);
}

export function getSelfJid(): string | null {
  return selfJid;
}

export async function sendSelfMessage(text: string): Promise<void> {
  if (!currentSock || !selfJid) {
    throw new Error('WhatsApp is not connected — cannot send message');
  }
  await currentSock.sendMessage(selfJid, { text });
}
