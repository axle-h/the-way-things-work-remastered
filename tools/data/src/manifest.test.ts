import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseManifest } from '@twtw/engine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildManifest, formatManifest } from './manifest.ts';

describe('buildManifest', () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'twtw-data-'));
    await mkdir(join(root, 'B', 'SUB'), { recursive: true });
    await writeFile(join(root, 'B', 'SUB', 'X.BIN'), 'xyz');
    await writeFile(join(root, 'B', 'A.BIN'), '');
    await writeFile(join(root, 'ROOT.TXT'), 'hello');
    await writeFile(join(root, '.hidden'), 'skip');
    await writeFile(join(root, 'manifest.json'), '{}');
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('lists files with / separators, sorted, without hidden files or the manifest', async () => {
    expect(await buildManifest(root)).toEqual({
      version: 1,
      files: [
        { path: 'B/A.BIN', size: 0 },
        { path: 'B/SUB/X.BIN', size: 3 },
        { path: 'ROOT.TXT', size: 5 },
      ],
    });
  });

  it('formats JSON that round-trips through parseManifest', async () => {
    const manifest = await buildManifest(root);
    const text = formatManifest(manifest);
    expect(parseManifest(JSON.parse(text))).toEqual(manifest);
    expect(formatManifest(manifest)).toBe(text);
  });
});
