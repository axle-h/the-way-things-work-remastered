import { describe, expect, it } from 'vitest';
import { FormatError } from '../reader.ts';
import { buildIso, type IsoImageSpec } from '../testing/iso-builder.ts';
import { bytesSource, type BlockSource } from './source.ts';
import { IsoPathError, openIso, type IsoImage } from './volume.ts';

/** `length` bytes of a recognisable pattern, different for each seed. */
function pattern(length: number, seed: number): Uint8Array {
  return Uint8Array.from({ length }, (_, i) => (i * 7 + seed * 31 + (i >> 8)) & 0xff);
}

const readme = pattern(100, 1);
const big = pattern(5000, 2); // spans three 2,048-byte blocks
const nested = pattern(2048, 3); // exactly one block
const modified = new Date(Date.UTC(1994, 7, 9, 16, 17, 58));

const sample: IsoImageSpec = {
  volumeLabel: 'TESTDISC',
  root: [
    { name: 'README.TXT', data: readme, date: modified },
    {
      name: 'SUB',
      date: new Date(Date.UTC(1994, 0, 2, 3, 4, 5)),
      children: [
        { name: 'BIG.DAT', data: big },
        { name: 'DEEP', children: [{ name: 'NESTED.BIN', data: nested }] },
      ],
    },
    { name: 'NOEXT.', data: pattern(3, 4) },
    { name: 'EMPTY.TXT', data: new Uint8Array(0) },
  ],
};

async function open(spec: IsoImageSpec = sample): Promise<IsoImage> {
  return openIso(bytesSource(buildIso(spec).bytes));
}

/** Writes a big-endian u32 (the second half of a both-endian field). */
function patchBe32(bytes: Uint8Array, offset: number, value: number): void {
  new DataView(bytes.buffer, bytes.byteOffset).setUint32(offset, value, false);
}

describe('openIso', () => {
  it('reads the primary volume descriptor', async () => {
    const iso = await open();
    expect(iso.volumeLabel).toBe('TESTDISC');
    expect(iso.logicalBlockSize).toBe(2048);
    expect(iso.volumeSpaceSize * 2048).toBe(iso.source.size);
    expect(iso.volumeSetSize).toBe(1);
    expect(iso.fileStructureVersion).toBe(1);
    expect(iso.created).toEqual(new Date(Date.UTC(2000, 0, 1, 12)));
    expect(iso.expires).toBeUndefined();
    expect(iso.descriptors).toEqual([{ type: 1, version: 1, sector: 16 }]);
    expect(iso.hasJoliet).toBe(false);
    expect(iso.hasRockRidge).toBe(false);
    expect(iso.root).toMatchObject({ name: '', path: '', isDirectory: true, size: 2048 });
  });

  it('detects Joliet and Rock Ridge but keeps the primary names', async () => {
    const iso = await open({ ...sample, joliet: true, rockRidge: true });
    expect(iso.hasJoliet).toBe(true);
    expect(iso.hasRockRidge).toBe(true);
    expect(iso.descriptors.map((descriptor) => descriptor.type)).toEqual([1, 2]);
    expect((await iso.listDirectory()).map((entry) => entry.name)).toEqual([
      'README.TXT',
      'SUB',
      'NOEXT',
      'EMPTY.TXT',
    ]);
  });
});

describe('directories and lookup', () => {
  it('lists a directory in disc order, without "." and ".."', async () => {
    const iso = await open();
    const entries = await iso.listDirectory('/');
    expect(entries.map((entry) => [entry.name, entry.isDirectory])).toEqual([
      ['README.TXT', false],
      ['SUB', true],
      ['NOEXT', false],
      ['EMPTY.TXT', false],
    ]);
    expect((await iso.listDirectory('sub')).map((entry) => entry.path)).toEqual(['SUB/BIG.DAT', 'SUB/DEEP']);
  });

  it('strips the ";1" version and a trailing "."', async () => {
    const iso = await open({
      root: [
        { name: 'NOEXT.', data: pattern(1, 0) },
        { name: 'PLAIN.TXT', data: pattern(1, 0), versionSuffix: '' },
        { name: 'V2.TXT', data: pattern(1, 0), versionSuffix: ';2' },
      ],
    });
    const entries = await iso.listDirectory();
    expect(entries.map((entry) => [entry.name, entry.version])).toEqual([
      ['NOEXT', 1],
      ['PLAIN.TXT', undefined],
      ['V2.TXT', 2],
    ]);
  });

  it('looks paths up ignoring case, with or without a leading or doubled "/"', async () => {
    const iso = await open();
    for (const path of [
      'SUB/DEEP/NESTED.BIN',
      'sub/deep/nested.bin',
      '/Sub//Deep/Nested.Bin',
      './SUB/DEEP/NESTED.BIN',
    ]) {
      expect((await iso.stat(path)).path).toBe('SUB/DEEP/NESTED.BIN');
    }
    expect(await iso.stat('')).toBe(iso.root);
    expect(await iso.find('NoExt')).toMatchObject({ name: 'NOEXT', size: 3 });
  });

  it('reports sizes, dates and flags', async () => {
    const iso = await open({
      root: [
        { name: 'A.TXT', data: pattern(10, 0), date: modified },
        { name: 'HIDDEN.TXT', data: pattern(1, 0), flags: 0x01 },
        { name: 'A.TXT', data: pattern(5, 0), flags: 0x04 }, // associated file: not listed
      ],
    });
    const [a, hidden, ...rest] = await iso.listDirectory();
    expect(a).toMatchObject({ name: 'A.TXT', size: 10, modified, hidden: false, interleaved: false });
    expect(hidden).toMatchObject({ name: 'HIDDEN.TXT', hidden: true });
    expect(rest).toEqual([]);
  });

  it('reads directories that span several blocks', async () => {
    const names = Array.from({ length: 150 }, (_, i) => `FILE${String(i).padStart(4, '0')}.DAT`);
    const iso = await open({ root: names.map((name, i) => ({ name, data: pattern(i, i) })) });
    expect(iso.root.size).toBeGreaterThan(2048);
    expect((await iso.listDirectory()).map((entry) => entry.name)).toEqual(names);
    expect(await iso.readFile('file0149.dat')).toEqual(pattern(149, 149));
  });

  it('walks every entry depth first, each directory before its contents', async () => {
    const iso = await open();
    const paths: string[] = [];
    for await (const entry of iso.walk()) paths.push(entry.path);
    expect(paths).toEqual([
      'README.TXT',
      'SUB',
      'SUB/BIG.DAT',
      'SUB/DEEP',
      'SUB/DEEP/NESTED.BIN',
      'NOEXT',
      'EMPTY.TXT',
    ]);
  });
});

describe('reading files', () => {
  it('reads whole files, including ones that cross block boundaries', async () => {
    const iso = await open();
    expect(await iso.readFile('README.TXT')).toEqual(readme);
    expect(await iso.readFile('sub/big.dat')).toEqual(big);
    expect(await iso.readFile('SUB/DEEP/NESTED.BIN')).toEqual(nested);
    expect(await iso.readFile('EMPTY.TXT')).toEqual(new Uint8Array(0));
  });

  it('reads ranges', async () => {
    const iso = await open();
    const entry = await iso.stat('SUB/BIG.DAT');
    expect(await iso.readFileRange(entry, 2000, 100)).toEqual(big.subarray(2000, 2100));
    expect(await iso.readFileRange('SUB/BIG.DAT', 0, 5000)).toEqual(big);
    expect(await iso.readFileRange('SUB/BIG.DAT', 4999, 1)).toEqual(big.subarray(4999));
    expect(await iso.readFileRange('SUB/BIG.DAT', 5000, 0)).toEqual(new Uint8Array(0));
  });

  it('rejects ranges outside the file', async () => {
    const iso = await open();
    await expect(iso.readFileRange('SUB/BIG.DAT', 4990, 11)).rejects.toThrow(RangeError);
    await expect(iso.readFileRange('SUB/BIG.DAT', -1, 1)).rejects.toThrow(RangeError);
    await expect(iso.readFileRange('SUB/BIG.DAT', 0.5, 1)).rejects.toThrow(RangeError);
  });

  it('reads multi-extent files as one', async () => {
    const data = pattern(6000, 9);
    const iso = await open({
      root: [
        { name: 'MULTI.DAT', data, extentLengths: [2048, 2048, 1904] },
        { name: 'AFTER.TXT', data: readme },
      ],
    });
    const entry = await iso.stat('MULTI.DAT');
    expect(entry.size).toBe(6000);
    expect(entry.extents).toHaveLength(3);
    expect(await iso.readFile(entry)).toEqual(data);
    expect(await iso.readFileRange(entry, 2000, 2200)).toEqual(data.subarray(2000, 4200));
    expect((await iso.listDirectory()).map((e) => e.name)).toEqual(['MULTI.DAT', 'AFTER.TXT']);
  });

  it('rejects interleaved files when they are read', async () => {
    const iso = await open({
      root: [{ name: 'MOVIE.DAT', data: pattern(4096, 0), interleave: { unitSize: 1, gap: 1 } }],
    });
    expect((await iso.stat('MOVIE.DAT')).interleaved).toBe(true);
    await expect(iso.readFile('MOVIE.DAT')).rejects.toThrow(/interleaved/);
  });
});

describe('errors', () => {
  it('rejects missing paths and the wrong kind of entry', async () => {
    const iso = await open();
    expect(await iso.find('NOPE.TXT')).toBeUndefined();
    expect(await iso.find('README.TXT/X')).toBeUndefined();
    await expect(iso.stat('SUB/NOPE.TXT')).rejects.toMatchObject({
      name: 'IsoPathError',
      reason: 'not-found',
      path: 'SUB/NOPE.TXT',
    });
    await expect(iso.readFile('NOPE.TXT')).rejects.toThrow(IsoPathError);
    await expect(iso.readFile('SUB')).rejects.toMatchObject({ reason: 'is-a-directory' });
    await expect(iso.listDirectory('README.TXT')).rejects.toMatchObject({ reason: 'not-a-directory' });
    await expect(iso.stat('SUB/..')).rejects.toMatchObject({ reason: 'not-found' });
  });

  it('rejects an image too small to hold a descriptor', async () => {
    await expect(openIso(bytesSource(new Uint8Array(16 * 2048)))).rejects.toThrow(FormatError);
  });

  it('rejects a descriptor without the "CD001" identifier', async () => {
    const { bytes } = buildIso(sample);
    bytes[16 * 2048 + 1] = 0x58;
    await expect(openIso(bytesSource(bytes))).rejects.toThrow(/identifier "XD001"/);
  });

  it('rejects a descriptor set without a terminator', async () => {
    const { bytes } = buildIso(sample);
    bytes[17 * 2048] = 3; // the terminator becomes a partition descriptor; the image then ends
    await expect(openIso(bytesSource(bytes.slice(0, 18 * 2048)))).rejects.toThrow(/terminator/);
  });

  it('rejects a descriptor set without a primary descriptor', async () => {
    const { bytes } = buildIso(sample);
    bytes[16 * 2048] = 0; // boot record
    await expect(openIso(bytesSource(bytes))).rejects.toThrow(/no primary volume descriptor/);
  });

  it('rejects an unsupported logical block size', async () => {
    const { bytes } = buildIso(sample);
    bytes.set([0x00, 0x01, 0x01, 0x00], 16 * 2048 + 128); // 256, both orders
    await expect(openIso(bytesSource(bytes))).rejects.toThrow(/logical block size 256/);
  });

  it('checks both halves of both-endian numbers unless told not to', async () => {
    const { bytes } = buildIso(sample);
    patchBe32(bytes, 16 * 2048 + 84, 12345); // volume space size, big-endian half
    await expect(openIso(bytesSource(bytes))).rejects.toThrow(
      /volume space size: little-endian \d+ and big-endian 12345 differ/,
    );
    const iso = await openIso(bytesSource(bytes), { checkBothEndian: false });
    expect(iso.volumeSpaceSize * 2048).toBe(bytes.length);
  });

  it('checks both-endian numbers in directory records', async () => {
    const { bytes, recordOffsets } = buildIso(sample);
    patchBe32(bytes, recordOffsets.get('SUB/BIG.DAT')! + 14, 1); // data length, big-endian half
    const iso = await openIso(bytesSource(bytes));
    await expect(iso.readFile('README.TXT')).resolves.toEqual(readme);
    await expect(iso.stat('SUB/BIG.DAT')).rejects.toThrow(/data length/);
  });

  it('rejects a malformed directory record', async () => {
    const { bytes, recordOffsets } = buildIso(sample);
    bytes[recordOffsets.get('SUB/BIG.DAT')! + 32] = 200; // identifier longer than the record
    const iso = await openIso(bytesSource(bytes));
    await expect(iso.listDirectory('SUB')).rejects.toThrow(/overruns/);
  });

  it('rejects data past the end of the image', async () => {
    const { bytes } = buildIso(sample);
    const truncated = bytes.slice(0, bytes.length - 2048); // drops NESTED.BIN, the last file's block
    const iso = await openIso(bytesSource(truncated));
    await expect(iso.readFile('SUB/DEEP/NESTED.BIN')).rejects.toThrow(/past the end/);
  });

  it('rejects a source that returns too few bytes', async () => {
    const { bytes } = buildIso(sample);
    const inner = bytesSource(bytes);
    const short: BlockSource = {
      size: inner.size,
      read: async (offset, length) => (await inner.read(offset, length)).subarray(1),
    };
    await expect(openIso(short)).rejects.toThrow(/returned 2047 bytes/);
  });
});
