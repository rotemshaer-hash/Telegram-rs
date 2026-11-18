import { config } from './config.js';
import { messageStore } from './store.js';
import { connectWhatsApp, sendSelfMessage } from './whatsapp.js';
import { startStatusServer, statusState } from './statusServer.js';
import { startScheduler, runSummaryNow } from './scheduler.js';

startStatusServer();

connectWhatsApp({
  onPairingCode: (code) => {
    statusState.status = 'waiting_for_pairing_code';
    statusState.pairingCode = code;
    console.log(`Pairing code: ${code}`);
  },

  onConnected: (selfJid) => {
    statusState.status = 'connected';
    statusState.pairingCode = undefined;
    statusState.connectedAt = new Date().toISOString();
    console.log(`Connected as ${selfJid}`);
  },

  onDisconnected: (reason) => {
    statusState.status = 'disconnected';
    console.log(`Disconnected: ${reason}`);
  },

  onGroupsResolved: (matched, missing) => {
    statusState.matchedGroups = [...matched.values()];
    statusState.missingGroups = missing;
    if (missing.length > 0) {
      const text =
        'לא מצאתי בוואטסאפ את הקבוצות הבאות מקובץ ההגדרות (בדוק שהשם מדויק):\n' +
        missing.map((name) => `- ${name}`).join('\n');
      void sendSelfMessage(text).catch((err) => console.error('Failed to send missing-groups notice:', err));
    }
  },

  onGroupMessage: (groupJid, groupName, message) => {
    messageStore.addMessage(groupJid, groupName, message);
  },

  onManualTrigger: () => {
    console.log('Manual "summarize now" trigger received');
    void runSummaryNow();
  },
});

startScheduler();
