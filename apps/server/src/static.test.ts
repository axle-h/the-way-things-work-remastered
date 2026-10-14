import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveFile, urlPathSegments } from './static.ts';

describe('urlPathSegments', () => {
  it('splits and decodes a path', () => {
    expect(urlPathSegments('/DIR/A%20B.BIN?x=1')).toEqual(['DIR', 'A B.BIN']);
    expect(urlPathSegments('/')).toEqual([]);
  });

  it.each(['/../etc/passwd', '/a/%2e%2e/b', '/a//b', '/a/./b', '/a%5Cb', '/%E0%A4%A'])(
    'rejects %s',
    (url) => {
      expect(urlPathSegments(url)).toBeUndefined();
    },
  );
});

describe('resolveFile', () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'twtw-server-'));
    await mkdir(join(root, 'DIR'));
    await writeFile(join(root, 'DIR', 'FILE.BIN'), 'abc');
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('finds an exact path', async () => {
    expect(await resolveFile(root, ['DIR', 'FILE.BIN'], false)).toBe(join(root, 'DIR', 'FILE.BIN'));
  });

  it('ignores case only when asked', async () => {
    expect(await resolveFile(root, ['dir', 'File.bin'], true)).toBe(join(root, 'DIR', 'FILE.BIN'));
    expect(await resolveFile(root, ['dir', 'File.bin'], false)).toBeUndefined();
  });

  it('does not resolve directories or missing files', async () => {
    expect(await resolveFile(root, ['DIR'], true)).toBeUndefined();
    expect(await resolveFile(root, ['DIR', 'MISSING'], true)).toBeUndefined();
  });
});
