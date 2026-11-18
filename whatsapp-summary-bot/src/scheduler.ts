import cron from 'node-cron';
import { config } from './config.js';
import { messageStore } from './store.js';
import { createDailySummary, noActivityMessage, splitForWhatsApp } from './summarize.js';
import { sendSelfMessage } from './whatsapp.js';
import { statusState } from './statusServer.js';

let running = false;

export async function runSummaryNow(): Promise<void> {
  if (running) {
    console.log('Summary already running, skipping overlapping trigger');
    return;
  }
  running = true;
  try {
    const startedAt = Date.now();
    const groups = messageStore.messagesSinceLastSummary();
    const summary = await createDailySummary(groups);
    const text = summary ?? noActivityMessage();

    for (const chunk of splitForWhatsApp(text)) {
      await sendSelfMessage(chunk);
    }

    messageStore.markSummarized(startedAt);
    statusState.lastSummaryAt = new Date().toLocaleString('he-IL', { timeZone: config.timezone });
  } catch (err) {
    console.error('Failed to create/send daily summary:', err);
    // Not marked as summarized on failure — the next attempt (manual trigger,
    // or tomorrow's run) still includes these messages.
  } finally {
    running = false;
  }
}

export function startScheduler(): void {
  const cronExpression = `${config.summaryMinute} ${config.summaryHour} * * *`;
  cron.schedule(cronExpression, () => void runSummaryNow(), { timezone: config.timezone });
  console.log(
    `Daily summary scheduled for ${config.summaryHour}:${String(config.summaryMinute).padStart(2, '0')} ${config.timezone}`,
  );
}
