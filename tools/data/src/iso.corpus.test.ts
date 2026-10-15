/**
 * Corpus test (PLAN §5.3): reads the real disc image with the TypeScript ISO 9660 reader and
 * compares every file, byte for byte, with the extracted disc in vendor/cd (or $TWTW_CD). The
 * image is $TWTW_ISO, or the only `.iso` in vendor/. Skips when either is absent, as on CI.
 */
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MANIFEST_NAME, parseManifest, type Manifest } from '@twtw/engine';
import { openIso, type IsoEntry, type IsoImage } from '@twtw/formats';
import { openFileSource, type FileBlockSource } from '@twtw/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cdDir, locateIso } from './paths.ts';

const manifestPath = join(cdDir, MANIFEST_NAME);

const located = locateIso();
const missing =
  'error' in located
    ? located.error
    : !existsSync(located.path)
      ? `${located.path} not found`
      : !existsSync(manifestPath)
        ? `${manifestPath} not found (extract the disc with \`pnpm data\` or set TWTW_CD)`
        : null;

if (missing !== null || 'error' in located) {
  describe('ISO 9660 corpus (disc image)', () => {
    it.skip(`skipped: ${missing}`, () => {});
  });
} else {
  const isoPath = located.path;
  describe('ISO 9660 corpus (disc image)', () => {
    let source: FileBlockSource;
    let iso: IsoImage;
    let manifest: Manifest;
    const files: IsoEntry[] = [];

    beforeAll(async () => {
      source = await openFileSource(isoPath);
      iso = await openIso(source);
      manifest = parseManifest(JSON.parse(readFileSync(manifestPath, 'utf8')));
      for await (const entry of iso.walk()) if (!entry.isDirectory) files.push(entry);
    });

    afterAll(async () => {
      await source?.close();
    });

    it('is the expected volume', () => {
      expect(iso.volumeLabel).toBe('DKMMTWTW');
      expect(iso.logicalBlockSize).toBe(2048);
      expect(iso.descriptors.map((descriptor) => descriptor.type)).toEqual([1]);
      expect(iso.hasJoliet).toBe(false);
      expect(iso.hasRockRidge).toBe(false);
      expect(iso.volumeSpaceSize * iso.logicalBlockSize).toBeLessThanOrEqual(source.size);
    });

    it('lists exactly the files of the manifest, with the same sizes', () => {
      expect(files).toHaveLength(2337);
      const fromIso = new Map(files.map((entry) => [entry.path.toLowerCase(), entry.size]));
      const fromManifest = new Map(manifest.files.map((file) => [file.path.toLowerCase(), file.size]));
      expect(fromIso).toEqual(fromManifest);
    });

    it('uses only plain records: one extent, not interleaved, not hidden, version 1', () => {
      const unusual = files.filter(
        (entry) => entry.extents.length !== 1 || entry.interleaved || entry.hidden || entry.version !== 1,
      );
      expect(unusual.map((entry) => entry.path)).toEqual([]);
    });

    it('finds every file by path, ignoring case', async () => {
      for (const file of manifest.files) {
        expect((await iso.stat(file.path.toLowerCase())).path).toBe(file.path);
      }
    });

    it('reads every file byte for byte as in the extracted disc', { timeout: 300_000 }, async () => {
      const differing: string[] = [];
      for (const entry of files) {
        const [ours, theirs] = await Promise.all([
          iso.readFile(entry),
          readFile(join(cdDir, ...entry.path.split('/'))),
        ]);
        if (!Buffer.from(ours.buffer, ours.byteOffset, ours.byteLength).equals(theirs)) {
          differing.push(entry.path);
        }
      }
      expect(differing).toEqual([]);
    });
  });
}
