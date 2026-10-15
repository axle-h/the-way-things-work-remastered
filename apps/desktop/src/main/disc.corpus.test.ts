/**
 * Corpus test: the real disc passes the checks the desktop app makes before using it, both as the
 * image ($TWTW_ISO, or the only .iso in vendor/) and as the extracted folder (vendor/cd or $TWTW_CD).
 * Skips for each one that is absent, as on CI. Nothing from the disc is stored.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDisc } from './disc.ts';

const repoRoot = resolve(import.meta.dirname, '../../../..');
const vendor = join(repoRoot, 'vendor');
const isoPath = ((): string | null => {
  const explicit = process.env['TWTW_ISO'];
  if (explicit !== undefined) return existsSync(explicit) ? explicit : null;
  const isos = existsSync(vendor)
    ? readdirSync(vendor).filter((name) => name.toLowerCase().endsWith('.iso'))
    : [];
  return isos.length === 1 ? join(vendor, isos[0]!) : null;
})();
const cdPath = resolve(process.env['TWTW_CD'] ?? join(vendor, 'cd'));

describe('the disc passes the desktop app checks', () => {
  it.skipIf(isoPath === null)(
    `as a disc image${isoPath === null ? ' (skipped: no .iso in vendor/ or $TWTW_ISO)' : ''}`,
    async () => {
      const disc = await openDisc('iso', isoPath!);
      try {
        expect(disc.manifest.files).toHaveLength(2337);
        expect((await disc.read('dkcode/twtw.png')).length).toBeGreaterThan(0);
      } finally {
        await disc.close();
      }
    },
  );

  it.skipIf(!existsSync(cdPath))(
    `as a folder${existsSync(cdPath) ? '' : ` (skipped: ${cdPath} not found)`}`,
    async () => {
      const disc = await openDisc('directory', cdPath);
      expect(disc.manifest.files).toHaveLength(2337);
      await disc.close();
    },
  );
});
