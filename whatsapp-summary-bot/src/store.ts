import type { GroupMessages, StoredMessage } from './types.js';

/**
 * In-memory only, by design: messages are kept just long enough to build the
 * next summary, then dropped. Nothing here is ever written to disk.
 */
class MessageStore {
  private groups = new Map<string, { groupName: string; messages: StoredMessage[] }>();

  addMessage(groupJid: string, groupName: string, message: StoredMessage): void {
    let entry = this.groups.get(groupJid);
    if (!entry) {
      entry = { groupName, messages: [] };
      this.groups.set(groupJid, entry);
    }
    entry.groupName = groupName;
    entry.messages.push(message);
  }

  hasAnyMessages(): boolean {
    for (const entry of this.groups.values()) {
      if (entry.messages.length > 0) return true;
    }
    return false;
  }

  /** Returns a snapshot of everything collected so far, without clearing it. */
  snapshot(): GroupMessages[] {
    const result: GroupMessages[] = [];
    for (const [groupJid, entry] of this.groups.entries()) {
      if (entry.messages.length > 0) {
        result.push({ groupJid, groupName: entry.groupName, messages: [...entry.messages] });
      }
    }
    return result;
  }

  /** Deletes everything collected so far. Call only after the summary was sent successfully. */
  clear(): void {
    for (const entry of this.groups.values()) {
      entry.messages = [];
    }
  }
}

export const messageStore = new MessageStore();
