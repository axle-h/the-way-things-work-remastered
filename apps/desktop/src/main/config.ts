// The desktop app's own settings, in `config.json` in Electron's userData folder: which disc to use.
// (The web app's settings live in its localStorage, which Electron also keeps in userData.)
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DiscKind } from '@twtw/web/desktop-bridge';

export interface DesktopConfig {
  /** The disc last chosen and accepted. */
  readonly disc: { readonly kind: DiscKind; readonly path: string } | null;
}

export const EMPTY_CONFIG: DesktopConfig = { disc: null };

export const CONFIG_NAME = 'config.json';

/** Reads the config; a missing or unreadable file is the empty config. */
export async function loadConfig(directory: string): Promise<DesktopConfig> {
  let text: string;
  try {
    text = await readFile(join(directory, CONFIG_NAME), 'utf8');
  } catch {
    return EMPTY_CONFIG;
  }
  return parseConfig(text);
}

/** Validates the config's JSON, dropping anything unexpected. */
export function parseConfig(text: string): DesktopConfig {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return EMPTY_CONFIG;
  }
  const disc = (json as { disc?: { kind?: unknown; path?: unknown } } | null)?.disc;
  if (
    typeof disc === 'object' &&
    disc !== null &&
    (disc.kind === 'iso' || disc.kind === 'directory') &&
    typeof disc.path === 'string' &&
    disc.path !== ''
  ) {
    return { disc: { kind: disc.kind, path: disc.path } };
  }
  return EMPTY_CONFIG;
}

/** Writes the config, replacing the old file only once the new one is complete. */
export async function saveConfig(directory: string, config: DesktopConfig): Promise<void> {
  const path = join(directory, CONFIG_NAME);
  await writeFile(`${path}.tmp`, `${JSON.stringify(config, null, 2)}\n`);
  await rename(`${path}.tmp`, path);
}
