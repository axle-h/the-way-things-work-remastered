import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataNotFoundError } from '@twtw/engine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DirectoryDataSource } from './fs-source.ts';

describe('DirectoryDataSource', () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'twtw-fs-source-'));
    await mkdir(join(root, 'DKCODE'));
    await writeFile(join(root, 'DKCODE', 'TWTW.PNG'), Uint8Array.of(1, 2, 3));
    await writeFile(join(root, '.hidden'), 'x');
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('walks the directory when there is no manifest', async () => {
    const source = await DirectoryDataSource.open(root);
    expect([...source.index.paths()]).toEqual(['DKCODE/TWTW.PNG']);
    expect(await source.read('dkcode\\twtw.png')).toEqual(Uint8Array.of(1, 2, 3));
    expect(await source.exists('DKCODE/twtw.PNG')).toBe(true);
    await expect(source.read('DKCODE/TWTW.EXE')).rejects.toBeInstanceOf(DataNotFoundError);
  });

  it('uses the manifest when there is one', async () => {
    const manifest = {
      version: 1,
      files: [
        { path: 'DKCODE/TWTW.PNG', size: 3 },
        { path: 'ONLY/IN.MANIFEST', size: 1 },
      ],
    };
    await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest));
    const source = await DirectoryDataSource.open(root);
    expect(await source.exists('only/in.manifest')).toBe(true);
    expect(await source.read('dkcode/TWTW.png')).toEqual(Uint8Array.of(1, 2, 3));
  });
});
