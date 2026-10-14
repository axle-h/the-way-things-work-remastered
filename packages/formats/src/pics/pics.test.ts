import { describe, expect, it } from 'vitest';
import { FormatError } from '../reader.ts';
import { buildPics, packPicsRuns } from '../testing/pics-builder.ts';
import { ByteWriter } from '../writer.ts';
import { compositePicsImage, unpackPicsImage, unpackPicsRuns, type PicsImage } from './image.ts';
import {
  parsePics,
  parsePicsChunk,
  parsePicsHeader,
  picsDuration,
  picsFrameTimes,
  picsSoundtrack,
  PICS_CHUNK_HEADER_SIZE,
} from './parse.ts';

/**
 * Hand-assembled from the tables in docs/formats/pics.md (independently of the test builder):
 * one pre-roll chunk (A = 1, B = 1) and two frame chunks. The first frame carries a 3×2 image
 * (odd width, so rows are padded to 4); the second carries sound only.
 */
function handAssembled(): Uint8Array {
  const w = new ByteWriter('le');
  w.u16(1).u32(2).u16(1).u16(1).u32(16);
  w.u16(1).u16(1).u32(22050).u32(22050).u16(1).u16(8);
  const chunk = (sound: number[], rect: number[], unpacked: number, packed: number[]): void => {
    w.u16(1).u32(sound.length);
    for (const v of rect) w.i16(v);
    w.u32(unpacked).u32(packed.length);
    for (const c of 'funky!') w.u8(c.charCodeAt(0));
    w.bytes(sound).bytes(packed);
  };
  chunk([128, 129, 130], [0, 0, 0, 0], 0, []);
  // Rows: [7 7 7 pad] [1 2 3 pad]: a run of 3, a literal of 1 (padding), a literal of 4.
  chunk([131, 132], [10, 20, 13, 22], 8, [3, 7, 0x81, 0, 0x84, 1, 2, 3, 0]);
  chunk([133], [-5, -1, 9, 300], 0, []);
  return w.toBytes();
}

describe('parsePics', () => {
  it('reads the header, sound format, pre-roll and frame chunks', () => {
    const bytes = handAssembled();
    const pics = parsePics(bytes, 'TEST.ANI');
    expect(pics.header).toEqual({
      formatMarker: 1,
      frameCount: 2,
      preRollFactorA: 1,
      preRollFactorB: 1,
      preRollCount: 1,
      soundFormatSize: 16,
      soundFormat: {
        formatTag: 1,
        channels: 1,
        samplesPerSecond: 22050,
        averageBytesPerSecond: 22050,
        blockAlign: 1,
        bitsPerSample: 8,
        extension: null,
      },
      byteLength: 30,
    });
    expect(pics.chunks).toHaveLength(3);
    expect(pics.preRoll).toEqual([pics.chunks[0]]);
    expect(pics.frames).toEqual(pics.chunks.slice(1));
    expect(pics.trailingBytes).toBe(0);

    const [preRoll, first, second] = pics.chunks;
    expect(preRoll).toMatchObject({ index: 0, offset: 30, byteLength: 31, type: 1, soundByteCount: 3 });
    expect([...(preRoll?.sound ?? [])]).toEqual([128, 129, 130]);
    expect(first).toMatchObject({
      index: 1,
      offset: 61,
      byteLength: PICS_CHUNK_HEADER_SIZE + 2 + 9,
      rect: { left: 10, top: 20, right: 13, bottom: 22 },
      unpackedSize: 8,
      packedSize: 9,
      filler: 'funky!',
    });
    // Sound and packed images are views into the input, not copies.
    expect(first?.sound.buffer).toBe(bytes.buffer);
    expect(first?.packed.byteOffset).toBe(61 + PICS_CHUNK_HEADER_SIZE + 2);
    // A chunk without an image may carry any rectangle; it is kept as is.
    expect(second).toMatchObject({
      index: 2,
      unpackedSize: 0,
      rect: { left: -5, top: -1, right: 9, bottom: 300 },
    });
  });

  it('unpacks images on demand, with padded rows', () => {
    const pics = parsePics(handAssembled());
    expect(unpackPicsImage(pics.chunks[0]!)).toBeNull();
    const image = unpackPicsImage(pics.chunks[1]!);
    expect(image).toMatchObject({ width: 3, height: 2, stride: 4, rect: { left: 10, top: 20 } });
    expect([...(image?.indices ?? [])]).toEqual([7, 7, 7, 0, 1, 2, 3, 0]);
    expect(unpackPicsImage(pics.chunks[2]!)).toBeNull();
  });

  it('concatenates the soundtrack, pre-roll included', () => {
    const pics = parsePics(handAssembled());
    expect([...picsSoundtrack(pics)]).toEqual([128, 129, 130, 131, 132, 133]);
    expect(picsDuration(pics)).toBeCloseTo(6 / 22050, 12);
  });

  it('reads the same structures incrementally', () => {
    const bytes = handAssembled();
    const header = parsePicsHeader(bytes);
    const chunk = parsePicsChunk(bytes, header.byteLength, 0);
    expect(parsePicsChunk(bytes, header.byteLength + chunk.byteLength, 1)).toEqual(
      parsePics(bytes).chunks[1],
    );
  });

  it('accepts a format block with an extension and B = 0 (no pre-roll)', () => {
    const w = new ByteWriter('le').u16(1).u32(1).u16(3).u16(0).u32(18);
    w.u16(1).u16(1).u32(11025).u32(11025).u16(1).u16(8).u16(0);
    w.u16(1).u32(0).i16(0).i16(0).i16(0).i16(0).u32(0).u32(0);
    for (const c of 'funky!') w.u8(c.charCodeAt(0));
    const pics = parsePics(w.toBytes());
    expect(pics.header.preRollCount).toBe(0);
    expect(pics.header.soundFormat.extension).toEqual(new Uint8Array(0));
    expect(pics.frames).toHaveLength(1);
  });

  it('reports trailing bytes', () => {
    const bytes = new Uint8Array([...handAssembled(), 1, 2]);
    expect(parsePics(bytes).trailingBytes).toBe(2);
  });

  describe('rejects malformed input with a FormatError', () => {
    const valid = (): Uint8Array => handAssembled();
    const cases: [string, (bytes: Uint8Array) => Uint8Array, RegExp][] = [
      ['a wrong format marker', (b) => (b.set([2], 0), b), /format marker is 2/],
      ['a non-PCM sound format', (b) => (b.set([2], 14), b), /not usable PCM/],
      ['a short sound format', (b) => (b.set([8], 10), b), /shorter than WAVEFORMAT/],
      ['a damaged chunk header', (b) => (b.set([0x46], 30 + 22), b), /no 'funky!' filler/],
      ['a truncated chunk', (b) => b.subarray(0, b.length - 1), /cannot read 1 byte/],
      ['a truncated header', (b) => b.subarray(0, 20), /cannot read/],
      ['too many frame chunks', (b) => (b.set([3], 2), b), /cannot read/],
      [
        'an image size that does not match its rectangle',
        (b) => (b.set([12], 61 + 14), b),
        /unpacked size 12/,
      ],
    ];
    for (const [name, damage, message] of cases) {
      it(name, () => {
        expect(() => parsePics(damage(valid()))).toThrow(FormatError);
        expect(() => parsePics(damage(valid()))).toThrow(message);
      });
    }
  });
});

describe('unpackPicsRuns', () => {
  it('copies literals', () => {
    expect([...unpackPicsRuns(new Uint8Array([0x83, 9, 8, 7]), 3).output]).toEqual([9, 8, 7]);
  });

  it('repeats runs', () => {
    expect([...unpackPicsRuns(new Uint8Array([5, 42]), 5).output]).toEqual([42, 42, 42, 42, 42]);
  });

  it('mixes runs and literals, up to 127 at a time', () => {
    const packed = new Uint8Array([
      2,
      1,
      0xff,
      ...Array.from({ length: 127 }, (_, i) => i),
      127,
      3,
      0x81,
      200,
    ]);
    const { output, consumed } = unpackPicsRuns(packed, 2 + 127 + 127 + 1);
    expect(consumed).toBe(packed.length);
    expect([...output.subarray(0, 4)]).toEqual([1, 1, 0, 1]);
    expect(output[128]).toBe(126);
    expect([...output.subarray(129, 256)].every((v) => v === 3)).toBe(true);
    expect(output[256]).toBe(200);
  });

  it('round-trips the test packer', () => {
    const data = Array.from({ length: 1000 }, (_, i) => (i % 300 < 150 ? 5 : (i * 7) & 0xff));
    const packed = new Uint8Array(packPicsRuns(data));
    expect([...unpackPicsRuns(packed, data.length).output]).toEqual(data);
  });

  it('stops when the image is full and reports the bytes consumed', () => {
    const { output, consumed } = unpackPicsRuns(new Uint8Array([2, 9, 0x81, 4]), 2);
    expect([...output]).toEqual([9, 9]);
    expect(consumed).toBe(2);
  });

  it('rejects input that ends early or overruns the image', () => {
    expect(() => unpackPicsRuns(new Uint8Array([2, 9]), 3)).toThrow(/ends after 2 of 3/);
    expect(() => unpackPicsRuns(new Uint8Array([4, 9]), 3)).toThrow(/overruns/);
    expect(() => unpackPicsRuns(new Uint8Array([0x83, 1, 2]), 3)).toThrow(/runs past the packed image/);
    expect(() => unpackPicsRuns(new Uint8Array([3]), 3)).toThrow(/without a value byte/);
    expect(() => unpackPicsRuns(new Uint8Array([4, 9]), 3, 1000)).toThrow(/offset 1000/);
  });
});

describe('unpackPicsImage', () => {
  it.each([1, 2, 5, 6])('pads rows of width %i to an even stride', (width) => {
    const stride = (width + 1) & ~1;
    const rows = [0, 1, 2].map((y) => Array.from({ length: stride }, (_, x) => (x < width ? 10 * y + x : 0)));
    const bytes = buildPics({
      preRollFactorA: 0,
      preRollFactorB: 0,
      chunks: [
        {
          rect: { left: 4, top: 5, right: 4 + width, bottom: 8 },
          unpackedSize: stride * 3,
          packed: packPicsRuns(rows.flat()),
        },
      ],
    });
    const image = unpackPicsImage(parsePics(bytes).frames[0]!);
    expect(image).toMatchObject({ width, height: 3, stride });
    expect([...(image?.indices ?? [])]).toEqual(rows.flat());
  });

  it('ignores packed bytes after a complete image', () => {
    const bytes = buildPics({
      preRollFactorA: 0,
      preRollFactorB: 0,
      chunks: [{ rect: { left: 0, top: 0, right: 2, bottom: 1 }, unpackedSize: 2, packed: [2, 6, 0x81, 9] }],
    });
    expect([...(unpackPicsImage(parsePics(bytes).frames[0]!)?.indices ?? [])]).toEqual([6, 6]);
  });
});

describe('picsFrameTimes [H]', () => {
  it('shows frame k when the sound of chunk k starts', () => {
    // Pre-roll of 2 (A = 2, B = 1), then 3 frame chunks; 0.2 s, 0.2 s, 0.1 s, 0.5 s and no sound.
    const sizes = [4410, 4410, 2205, 11025, 0];
    const bytes = buildPics({
      preRollFactorA: 2,
      preRollFactorB: 1,
      chunks: sizes.map((n) => ({ sound: new Uint8Array(n).fill(128) })),
    });
    const pics = parsePics(bytes);
    expect(pics.frames).toHaveLength(3);
    expect(picsFrameTimes(pics)).toEqual([0, 0.2, 0.4]);
    expect(picsDuration(pics)).toBe(1);
  });

  it('uses the bytes per second of the sound format', () => {
    const bytes = buildPics({
      preRollFactorA: 1,
      preRollFactorB: 1,
      samplesPerSecond: 11025,
      chunks: [{ sound: new Uint8Array(11025) }, { sound: new Uint8Array(100) }, {}],
    });
    expect(picsFrameTimes(parsePics(bytes))).toEqual([0, 1]);
  });
});

describe('compositePicsImage', () => {
  const image = (left: number, top: number, width: number, height: number): PicsImage => {
    const stride = (width + 1) & ~1;
    const indices = new Uint8Array(stride * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < stride; x++) indices[y * stride + x] = x < width ? 10 * (y + 1) + x : 99;
    }
    return { rect: { left, top, right: left + width, bottom: top + height }, width, height, stride, indices };
  };
  const target = (): { width: number; height: number; indices: Uint8Array } => ({
    width: 4,
    height: 3,
    indices: new Uint8Array(12),
  });
  const rows = (t: { indices: Uint8Array }): number[][] =>
    [0, 1, 2].map((y) => [...t.indices.subarray(y * 4, y * 4 + 4)]);

  it('copies the image at its position, without the row padding', () => {
    const t = target();
    compositePicsImage(t, image(1, 1, 3, 2));
    expect(rows(t)).toEqual([
      [0, 0, 0, 0],
      [0, 10, 11, 12],
      [0, 20, 21, 22],
    ]);
  });

  it('clips at the top left', () => {
    const t = target();
    compositePicsImage(t, image(-1, -1, 3, 2));
    expect(rows(t)).toEqual([
      [21, 22, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
  });

  it('clips at the bottom right', () => {
    const t = target();
    compositePicsImage(t, image(2, 2, 3, 3));
    expect(rows(t)).toEqual([
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 10, 11],
    ]);
  });

  it('draws nothing when entirely outside', () => {
    const t = target();
    compositePicsImage(t, image(4, 0, 2, 2));
    compositePicsImage(t, image(0, -2, 2, 2));
    compositePicsImage(t, image(-2, 0, 2, 2));
    expect(t.indices.every((v) => v === 0)).toBe(true);
  });
});
