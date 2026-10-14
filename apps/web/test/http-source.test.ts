import { DataNotFoundError } from '@twtw/engine';
import { describe, expect, it } from 'vitest';
import { parseDebugHash } from '../src/debug-hash.ts';
import { HttpDataSource } from '../src/http-source.ts';
import { indexedToRgba } from '../src/rgba.ts';

const files: Record<string, Uint8Array | string> = {
  '/data/manifest.json': JSON.stringify({
    version: 1,
    files: [
      { path: 'DKCODE/TWTW.PNG', size: 2 },
      { path: 'DIR WITH SPACE/A#B.DIB', size: 1 },
      { path: 'GONE/FILE.BIN', size: 1 },
    ],
  }),
  '/data/DKCODE/TWTW.PNG': Uint8Array.of(7, 8),
  '/data/DIR%20WITH%20SPACE/A%23B.DIB': Uint8Array.of(9),
};

const requested: string[] = [];
const fakeFetch: typeof fetch = (input) => {
  const url = String(input);
  requested.push(url);
  const body = files[url];
  return Promise.resolve(body === undefined ? new Response(null, { status: 404 }) : new Response(body));
};

describe('HttpDataSource', () => {
  it('resolves names through the manifest and fetches them as stored', async () => {
    const source = await HttpDataSource.open('/data/', fakeFetch);
    expect(await source.read('dkcode\\twtw.png')).toEqual(Uint8Array.of(7, 8));
    expect(await source.read('dir with space/a#b.dib')).toEqual(Uint8Array.of(9));
    expect(await source.exists('DKCODE/TWTW.EXE')).toBe(false);
    expect(requested).toEqual([
      '/data/manifest.json',
      '/data/DKCODE/TWTW.PNG',
      '/data/DIR%20WITH%20SPACE/A%23B.DIB',
    ]);
  });

  it('rejects files missing from the manifest or the server', async () => {
    const source = await HttpDataSource.open('/data/', fakeFetch);
    const before = requested.length;
    await expect(source.read('NOPE.BIN')).rejects.toBeInstanceOf(DataNotFoundError);
    expect(requested.length).toBe(before); // not even requested
    await expect(source.read('gone/file.bin')).rejects.toBeInstanceOf(DataNotFoundError);
  });

  it('fails to open without a manifest', async () => {
    await expect(HttpDataSource.open('/elsewhere/', fakeFetch)).rejects.toThrow(/HTTP 404/);
  });
});

describe('parseDebugHash', () => {
  it.each([
    ['', { page: null, popups: [], presentation: null }],
    ['#page=410776', { page: 410776, popups: [], presentation: null }],
    [
      '#page=1538,popup=2534,popup=7&presentation=wine',
      { page: 1538, popups: [2534, 7], presentation: 'wine' },
    ],
    ['#page=abc,popup=-1,other=3', { page: null, popups: [], presentation: null }],
  ])('%j', (hash, expected) => {
    expect(parseDebugHash(hash)).toEqual(expected);
  });
});

describe('indexedToRgba', () => {
  it('looks every index up in the palette', () => {
    const palette = new Uint8Array(768);
    palette.set([1, 2, 3], 0);
    palette.set([250, 251, 252], 255 * 3);
    const out = new Uint8ClampedArray(8);
    indexedToRgba(Uint8Array.of(255, 0), palette, out);
    expect([...out]).toEqual([250, 251, 252, 255, 1, 2, 3, 255]);
  });
});
