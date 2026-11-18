import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';
import { config } from './config.js';
import type { GroupMessages, StoredMessage } from './types.js';

interface PersistedMessage extends StoredMessage {
  groupJid: string;
  groupName: string;
}

interface StoreFile {
  lastSummaryAtMs: number;
  messages: PersistedMessage[];
}

/**
 * Group text messages, kept on the server's disk for MESSAGE_RETENTION_DAYS so
 * the assistant can answer questions about them; older ones are deleted.
 * Media is never stored — only a placeholder like "[תמונה]".
 */
class MessageStore {
  private readonly path = join(config.dataDir, 'messages.json');
  private readonly retentionMs = config.retentionDays * 24 * 60 * 60 * 1000;
  private data: StoreFile = { lastSummaryAtMs: 0, messages: [] };
  private ids = new Set<string>();
  private saveTimer: NodeJS.Timeout | null = null;

  constructor() {
    mkdirSync(config.dataDir, { recursive: true });
    try {
      this.data = JSON.parse(readFileSync(this.path, 'utf-8')) as StoreFile;
    } catch {
      // First run, or an unreadable file — start empty.
    }
    this.prune();
    for (const m of this.data.messages) this.ids.add(m.id);
  }

  addMessage(groupJid: string, groupName: string, message: StoredMessage): void {
    if (this.ids.has(message.id)) return;
    this.ids.add(message.id);
    this.data.messages.push({ ...message, groupJid, groupName });
    this.scheduleSave();
  }

  /** Everything since the last successful summary, grouped by group. */
  messagesSinceLastSummary(): GroupMessages[] {
    this.prune();
    const byGroup = new Map<string, GroupMessages>();
    for (const m of this.data.messages) {
      if (m.timestampMs <= this.data.lastSummaryAtMs) continue;
      let g = byGroup.get(m.groupJid);
      if (!g) {
        g = { groupJid: m.groupJid, groupName: m.groupName, messages: [] };
        byGroup.set(m.groupJid, g);
      }
      g.messages.push(m);
    }
    for (const g of byGroup.values()) g.messages.sort((a, b) => a.timestampMs - b.timestampMs);
    return [...byGroup.values()];
  }

  markSummarized(atMs: number): void {
    this.data.lastSummaryAtMs = atMs;
    this.scheduleSave();
  }

  search(opts: { query?: string; group?: string; sinceMs?: number; limit: number }): PersistedMessage[] {
    this.prune();
    const query = opts.query?.trim().toLowerCase();
    const group = opts.group?.trim().toLowerCase();
    return this.data.messages
      .filter(
        (m) =>
          (!opts.sinceMs || m.timestampMs >= opts.sinceMs) &&
          (!group || m.groupName.toLowerCase().includes(group)) &&
          (!query ||
            m.text.toLowerCase().includes(query) ||
            m.sender.toLowerCase().includes(query)),
      )
      .sort((a, b) => b.timestampMs - a.timestampMs)
      .slice(0, opts.limit);
  }

  private prune(): void {
    const cutoff = Date.now() - this.retentionMs;
    const before = this.data.messages.length;
    this.data.messages = this.data.messages.filter((m) => m.timestampMs >= cutoff);
    if (this.data.messages.length !== before) {
      this.ids = new Set(this.data.messages.map((m) => m.id));
      this.scheduleSave();
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      const tmp = `${this.path}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.data));
      renameSync(tmp, this.path);
    }, 2000);
  }
}

export const messageStore = new MessageStore();
