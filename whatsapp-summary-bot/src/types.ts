export interface StoredMessage {
  sender: string;
  text: string;
  timestampMs: number;
}

export interface GroupMessages {
  groupJid: string;
  groupName: string;
  messages: StoredMessage[];
}

export type BotStatus =
  | 'starting'
  | 'waiting_for_pairing_code'
  | 'connected'
  | 'disconnected'
  | 'error';

export interface StatusState {
  status: BotStatus;
  pairingCode?: string;
  errorMessage?: string;
  matchedGroups: string[];
  missingGroups: string[];
  lastSummaryAt?: string;
  connectedAt?: string;
}
