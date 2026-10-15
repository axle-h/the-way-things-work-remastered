// Where the desktop smoke tests find the app and the disc image.
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '../../..');

/** The built app (scripts/build.ts). */
export const appDir = resolve(import.meta.dirname, '../dist/app');

/** The disc image: `$TWTW_ISO`, or the only `.iso` file in `vendor/`; `null` if there is none. */
export function findIso(): string | null {
  const explicit = process.env['TWTW_ISO'];
  if (explicit !== undefined) return existsSync(explicit) ? resolve(explicit) : null;
  const vendor = join(repoRoot, 'vendor');
  const isos = existsSync(vendor)
    ? readdirSync(vendor).filter((name) => name.toLowerCase().endsWith('.iso'))
    : [];
  return isos.length === 1 ? join(vendor, isos[0]!) : null;
}
