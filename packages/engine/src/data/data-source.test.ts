import { describe, expect, it } from 'vitest';
import { DataNotFoundError, normalizeDataPath } from './data-source.ts';
import { FileIndex } from './file-index.ts';
import { MemoryDataSource } from './memory-source.ts';

describe('normalizeDataPath', () => {
  it.each([
    ['DKCODE/TWTW.PNG', 'DKCODE/TWTW.PNG'],
    ['\\ARTICLE1\\AIRP\\AIRP0m.DIB', 'ARTICLE1/AIRP/AIRP0m.DIB'],
    ['/a//b/', 'a/b'],
  ])('%s → %s', (path, expected) => {
    expect(normalizeDataPath(path)).toBe(expected);
  });

  it.each(['', '/', 'a/../b', './a', 'a/\0'])('rejects %j', (path) => {
    expect(() => normalizeDataPath(path)).toThrow(RangeError);
  });
});

describe('FileIndex', () => {
  const index = new FileIndex(['DKCODE/TWTW.PNG', 'ARTICLE1/AIRP/AIRP0M.DIB']);

  it('resolves any spelling to the stored path', () => {
    expect(index.resolve('dkcode/twtw.png')).toBe('DKCODE/TWTW.PNG');
    expect(index.resolve('\\ARTICLE1\\airp\\AIRP0m.dib')).toBe('ARTICLE1/AIRP/AIRP0M.DIB');
    expect(index.resolve('ARTICLE1/AIRP')).toBeUndefined();
    expect(index.has('nope')).toBe(false);
    expect(index.size).toBe(2);
  });

  it('builds from a manifest', () => {
    const fromManifest = FileIndex.fromManifest({ version: 1, files: [{ path: 'A/B.TXT', size: 1 }] });
    expect([...fromManifest.paths()]).toEqual(['A/B.TXT']);
  });

  it('rejects names that differ only in case', () => {
    expect(() => new FileIndex(['A.TXT', 'a.txt'])).toThrow(/case/);
  });
});

describe('MemoryDataSource', () => {
  const source = new MemoryDataSource([['DIR/FILE.BIN', Uint8Array.of(1, 2)]]);

  it('reads ignoring case and separators', async () => {
    expect(await source.read('dir\\file.bin')).toEqual(Uint8Array.of(1, 2));
    expect(await source.exists('Dir/File.Bin')).toBe(true);
    expect(await source.exists('DIR/OTHER.BIN')).toBe(false);
    expect(source.reads).toEqual(['DIR/FILE.BIN']);
  });

  it('rejects a missing file with DataNotFoundError', async () => {
    await expect(source.read('DIR/OTHER.BIN')).rejects.toBeInstanceOf(DataNotFoundError);
  });
});
