import { readFileSync } from 'fs';
import type { WASocket } from '@whiskeysockets/baileys';
import { config } from './config.js';

export function loadConfiguredGroupNames(): string[] {
  let raw: string;
  try {
    raw = readFileSync(config.groupsConfigPath, 'utf-8');
  } catch {
    throw new Error(
      `Could not read groups config file at ${config.groupsConfigPath}. ` +
        'Create it from groups.config.example.json with your group names.',
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
