import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseManifest } from '@twtw/engine';
import { buildManifest } from '@twtw/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { formatManifest } from './manifest.ts';

describe('formatManifest', () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'twtw-data-'));
    await mkdir(join(root, 'B', 'SUB'), { recursive: true });
    await writeFile(join(root, 'B', 'SUB', 'X.BIN'), 'xyz');
    await writeFile(join(root, 'B', 'A.BIN'), '');
    await writeFile(join(root, 'ROOT.TXT'), 'hello');
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('formats JSON that round-trips through parseManifest', async () => {
    const manifest = await buildManifest(root);
    const text = formatManifest(manifest);
    expect(parseManifest(JSON.parse(text))).toEqual(manifest);
    expect(formatManifest(manifest)).toBe(text);
  });
});
