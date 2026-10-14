import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '../../..');

/** The directory holding the disc image and other local-only material. */
export const vendorDir = join(repoRoot, 'vendor');

/** Where the disc is extracted: `$TWTW_CD`, or `vendor/cd`. */
export const cdDir = resolve(process.env['TWTW_CD'] ?? join(vendorDir, 'cd'));

/**
 * The disc image: `$TWTW_ISO`, or the only `.iso` file in `vendor/`. Returns an error message
 * instead when there is none or more than one.
 */
export function locateIso(): { path: string } | { error: string } {
  const explicit = process.env['TWTW_ISO'];
  if (explicit !== undefined) return { path: resolve(explicit) };
  const names = existsSync(vendorDir) ? readdirSync(vendorDir) : [];
  const isos = names.filter((name) => name.toLowerCase().endsWith('.iso'));
  if (isos.length !== 1) {
    const found = isos.length === 0 ? 'none found' : `found ${isos.join(', ')}`;
    return { error: `Put exactly one disc image (.iso) in ${vendorDir}, or set TWTW_ISO (${found}).` };
  }
  return { path: join(vendorDir, isos[0]!) };
}
