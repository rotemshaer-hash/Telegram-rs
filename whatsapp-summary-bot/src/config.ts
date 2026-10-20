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
  port: Number(process.env.PORT) || 3000,
  summaryHour: 21,
  summaryMinute: 0,
  timezone: 'Asia/Jerusalem',
  manualTriggerPhrase: 'סכם עכשיו',
};

if (!/^[0-9]{8,15}$/.test(config.whatsappPhoneNumber)) {
  throw new Error(
    'WHATSAPP_PHONE_NUMBER must be digits only, in international format (e.g. 972501234567)',
  );
}
