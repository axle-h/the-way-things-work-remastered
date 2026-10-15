import { DataNotFoundError } from '@twtw/engine';
import { describe, expect, it } from 'vitest';
import { parseDebugHash } from '../src/debug-hash.ts';
import { ByteCache } from '../src/byte-cache.ts';
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
    const source = await HttpDataSource.open('/data/', { fetch: fakeFetch });
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
    const source = await HttpDataSource.open('/data/', { fetch: fakeFetch });
    const before = requested.length;
    await expect(source.read('NOPE.BIN')).rejects.toBeInstanceOf(DataNotFoundError);
    expect(requested.length).toBe(before); // not even requested
    await expect(source.read('gone/file.bin')).rejects.toBeInstanceOf(DataNotFoundError);
  });

  it('fails to open without a manifest', async () => {
    await expect(HttpDataSource.open('/elsewhere/', { fetch: fakeFetch })).rejects.toThrow(/HTTP 404/);
  });
});

describe('HttpDataSource cache and prefetch', () => {
  it('knows sizes from the manifest', async () => {
    const source = await HttpDataSource.open('/data/', { fetch: fakeFetch });
    expect(source.sizeOf('dkcode/twtw.png')).toBe(2);
    expect(source.sizeOf('nope')).toBeUndefined();
  });

  it('serves a prefetched file from memory, and a read joins a prefetch in flight', async () => {
    const source = await HttpDataSource.open('/data/', { fetch: fakeFetch });
    const before = requested.length;
    const prefetching = source.prefetch('DKCODE/TWTW.PNG');
    const reading = source.read('dkcode/twtw.png');
    expect(await prefetching).toBe(true);
    expect(await reading).toEqual(Uint8Array.of(7, 8));
    expect(await source.read('DKCODE/TWTW.PNG')).toEqual(Uint8Array.of(7, 8));
    expect(requested.length - before).toBe(1);
  });

  it('never rejects a prefetch', async () => {
    const source = await HttpDataSource.open('/data/', { fetch: fakeFetch });
    expect(await source.prefetch('NOPE.BIN')).toBe(false);
    expect(await source.prefetch('gone/file.bin')).toBe(false);
  });

  it('fetches again once the cache is off', async () => {
    const source = await HttpDataSource.open('/data/', { fetch: fakeFetch, cacheBytes: 0 });
    const before = requested.length;
    await source.read('DKCODE/TWTW.PNG');
    await source.read('DKCODE/TWTW.PNG');
    expect(requested.length - before).toBe(2);
  });
});

describe('ByteCache', () => {
  const bytes = (n: number) => new Uint8Array(n);

  it('drops the least recently used entries over its budget', () => {
    const cache = new ByteCache(10, 10);
    cache.set('a', bytes(4));
    cache.set('b', bytes(4));
    cache.get('a'); // a is now the most recently used
    cache.set('c', bytes(4));
    expect([cache.has('a'), cache.has('b'), cache.has('c')]).toEqual([true, false, true]);
    expect(cache.bytes).toBe(8);
  });

  it('does not keep entries larger than its limit, and replaces entries in place', () => {
    const cache = new ByteCache(100, 10);
    cache.set('big', bytes(11));
    expect(cache.has('big')).toBe(false);
    cache.set('a', bytes(5));
    cache.set('a', bytes(3));
    expect([cache.size, cache.bytes]).toEqual([1, 3]);
    cache.delete('a');
    expect([cache.size, cache.bytes]).toEqual([0, 0]);
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
