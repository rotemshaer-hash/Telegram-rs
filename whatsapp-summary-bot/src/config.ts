function required(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

export const config = {
  anthropicApiKey: required('ANTHROPIC_API_KEY'),
  whatsappPhoneNumber: required('WHATSAPP_PHONE_NUMBER').replace(/[^0-9]/g, ''),
  claudeModel: process.env.CLAUDE_MODEL?.trim() || 'claude-opus-5-5',
  authDir: process.env.AUTH_DIR?.trim() || './data/auth',
  groupsConfigPath: process.env.GROUPS_CONFIG_PATH?.trim() || './groups.config.json',
  /** Group names separated by "|". Preferred in production — the JSON file is
   *  gitignored and won't exist on a server deployed straight from GitHub. */
  groupsEnv: process.env.GROUPS,
  port: Number(process.env.PORT) || 3000,
  dataDir: process.env.DATA_DIR?.trim() || './data',
  retentionDays: Number(process.env.MESSAGE_RETENTION_DAYS) || 7,
  assistantModel: process.env.ASSISTANT_MODEL?.trim() || 'claude-opus-5-5',
  gmailAddress: process.env.GMAIL_ADDRESS?.trim() || '',
  gmailAppPassword: process.env.GMAIL_APP_PASSWORD?.replace(/\s/g, '') || '',
  calendarIcsUrl: process.env.GOOGLE_CALENDAR_ICS_URL?.trim() || '',
  summaryHour: 7,
  summaryMinute: 30,
  timezone: 'Asia/Jerusalem',
  manualTriggerPhrase: 'סכם עכשיו',
};

if (!/^[0-9]{8,15}$/.test(config.whatsappPhoneNumber)) {
  throw new Error(
    'WHATSAPP_PHONE_NUMBER must be digits only, in international format (e.g. 972501234567)',
  );
}
