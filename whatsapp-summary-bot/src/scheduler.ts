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
    const groups = messageStore.snapshot();
    const summary = await createDailySummary(groups);
    const text = summary ?? noActivityMessage();

    for (const chunk of splitForWhatsApp(text)) {
      await sendSelfMessage(chunk);
    }

    messageStore.clear();
    statusState.lastSummaryAt = new Date().toLocaleString('he-IL', { timeZone: config.timezone });
  } catch (err) {
    console.error('Failed to create/send daily summary:', err);
    // Deliberately don't clear the store on failure — the next attempt (manual
    // trigger, or tomorrow's run) will include today's messages too.
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
