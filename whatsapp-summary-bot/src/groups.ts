import { readFileSync } from 'fs';
import type { WASocket } from '@whiskeysockets/baileys';
import { config } from './config.js';

export function loadConfiguredGroupNames(): string[] {
  // Preferred in production: a GROUPS env var, group names separated by "|" —
  // the JSON file below is gitignored (group names can be sensitive) so it
  // won't exist on a server deployed straight from GitHub. "|" (not a
  // newline) is used because some hosts' env-var storage (systemd
  // EnvironmentFile, some dashboards) can't hold a multi-line value reliably.
  if (config.groupsEnv && config.groupsEnv.trim()) {
    return config.groupsEnv
      .split('|')
      .map((name) => name.trim())
      .filter((name) => name.length > 0);
  }

  let raw: string;
  try {
    raw = readFileSync(config.groupsConfigPath, 'utf-8');
  } catch {
    throw new Error(
      `No GROUPS environment variable set, and could not read ${config.groupsConfigPath}. ` +
        'Either set GROUPS (one group name per line), or create the file from groups.config.example.json.',
    );
  }
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || !parsed.every((v) => typeof v === 'string')) {
    throw new Error(`${config.groupsConfigPath} must be a JSON array of group name strings.`);
  }
  return parsed.map((name) => name.trim()).filter((name) => name.length > 0);
}

export interface ResolvedGroups {
  /** groupJid -> configured group name */
  matched: Map<string, string>;
  missing: string[];
}

export async function resolveGroups(sock: WASocket): Promise<ResolvedGroups> {
  const configuredNames = loadConfiguredGroupNames();
  const allGroups = await sock.groupFetchAllParticipating();

  const byName = new Map<string, string>();
  for (const [jid, metadata] of Object.entries(allGroups)) {
    if (metadata?.subject) {
      byName.set(metadata.subject.trim(), jid);
    }
  }

  const matched = new Map<string, string>();
  const missing: string[] = [];
  for (const name of configuredNames) {
    const jid = byName.get(name);
    if (jid) {
      matched.set(jid, name);
    } else {
      missing.push(name);
    }
  }

  return { matched, missing };
}
