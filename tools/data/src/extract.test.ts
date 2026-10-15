import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bytesSource, openIso } from '@twtw/formats';
import { buildIso } from '@twtw/formats/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { extractIso } from './extract.ts';

describe('extractIso', () => {
  let root: string;
  const big = Uint8Array.from({ length: 3 << 20 }, (_, i) => (i * 13) & 0xff); // several copy chunks
  const date = new Date(Date.UTC(1994, 7, 7, 14, 37, 32));

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'twtw-extract-'));
    const { bytes } = buildIso({
      root: [
        { name: 'SETUP.EXE', data: Uint8Array.of(1, 2, 3), date },
        { name: 'DKCODE', date, children: [{ name: 'BIG.ANI', data: big, date }] },
        { name: 'EMPTY.TXT', data: new Uint8Array(0) },
      ],
    });
    await extractIso(await openIso(bytesSource(bytes)), root);
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('writes files with the disc names, without versions', async () => {
    expect((await readdir(root)).sort()).toEqual(['DKCODE', 'EMPTY.TXT', 'SETUP.EXE']);
    expect(await readdir(join(root, 'DKCODE'))).toEqual(['BIG.ANI']);
    expect(new Uint8Array(await readFile(join(root, 'SETUP.EXE')))).toEqual(Uint8Array.of(1, 2, 3));
    // Buffer.equals: a deep toEqual over 3 MB is slow enough to time out under load.
    expect((await readFile(join(root, 'DKCODE', 'BIG.ANI'))).equals(big)).toBe(true);
    expect((await stat(join(root, 'EMPTY.TXT'))).size).toBe(0);
  });

  it('sets modification times from the directory records', async () => {
    expect((await stat(join(root, 'SETUP.EXE'))).mtime).toEqual(date);
    expect((await stat(join(root, 'DKCODE'))).mtime).toEqual(date);
    expect((await stat(join(root, 'DKCODE', 'BIG.ANI'))).mtime).toEqual(date);
  });
});
