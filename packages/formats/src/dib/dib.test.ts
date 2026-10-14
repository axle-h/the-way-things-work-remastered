import { describe, expect, it } from 'vitest';
import { FormatError } from '../reader.ts';
import { buildDib } from '../testing/dib-builder.ts';
import { decodeDib } from './dib.ts';

// A tiny 4-colour table: black, red, green, blue (RGB order; stored as BGR + reserved).
const PALETTE = [0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255];
const PALETTE_16 = [...PALETTE, ...new Array<number>(12 * 3).fill(128)];

const rle8 = (
  width: number,
  height: number,
  codes: number[],
  extra: Partial<Parameters<typeof buildDib>[0]> = {},
) => buildDib({ width, height, compression: 1, palette: PALETTE, pixelData: codes, ...extra });

describe('decodeDib', () => {
  it('reads a hand-assembled RLE8 file: headers, colour table and pixels', () => {
    // prettier-ignore
    const bytes = new Uint8Array([
      0x42, 0x4d, 74, 0, 0, 0, 1, 0, 2, 0, 62, 0, 0, 0, // BITMAPFILEHEADER: size 74, offset 62
      40, 0, 0, 0, 2, 0, 0, 0, 1, 0, 0, 0, 1, 0, 8, 0, // size, 2×1, 1 plane, 8 bits
      1, 0, 0, 0, 12, 0, 0, 0, 0x13, 0x0b, 0, 0, 0x13, 0x0b, 0, 0, // RLE8, 12 bytes, 2835 dpm
      2, 0, 0, 0, 1, 0, 0, 0, // 2 colours used, 1 important
      0x30, 0x20, 0x10, 0x99, 0x60, 0x50, 0x40, 0x00, // colour table (blue, green, red, reserved)
      1, 1, 1, 0, 0, 0, 0, 1, // run of 1 × colour 1, run of 1 × colour 0, end of line, end of bitmap
      0xaa, 0xbb, 0xcc, 0xdd, // after the end of the bitmap: not read
    ]);
    const dib = decodeDib(bytes);
    expect(dib.fileHeader).toEqual({ fileSize: 74, unknown1: 1, unknown2: 2, pixelOffset: 62 });
    expect(dib.infoHeader).toEqual({
      headerSize: 40,
      width: 2,
      height: 1,
      planes: 1,
      bitCount: 8,
      compression: 1,
      imageSize: 12,
      xPixelsPerMeter: 2835,
      yPixelsPerMeter: 2835,
      colorsUsed: 2,
      colorsImportant: 1,
    });
    expect([...dib.palette]).toEqual([0x10, 0x20, 0x30, 0x40, 0x50, 0x60]);
    expect([...dib.paletteReserved]).toEqual([0x99, 0]);
    expect(dib.colorCount).toBe(2);
    expect([...dib.indices]).toEqual([1, 0]);
    expect(dib.rle).toEqual({
      bytesRead: 8,
      bytesAvailable: 12,
      endOfBitmap: true,
      unwrittenPixels: 0,
      deltas: 0,
    });
  });

  it('decodes RLE8 runs, absolute runs (padded to even), end of line and end of bitmap, bottom-up', () => {
    // prettier-ignore
    const codes = [
      0, 3, 1, 2, 3, 0, // stored row 0: absolute run of 3, padded to an even length
      2, 7, //             run of 2 × colour 7
      0, 0, //             end of line
      5, 9, //             stored row 1: run of 5 × colour 9
      0, 1, //             end of bitmap
    ];
    const dib = decodeDib(rle8(5, 2, codes));
    expect(dib.width).toBe(5);
    expect(dib.height).toBe(2);
    expect(dib.topDown).toBe(false);
    expect([...dib.indices]).toEqual([9, 9, 9, 9, 9, 1, 2, 3, 7, 7]);
    expect(dib.rle).toEqual({
      bytesRead: 14,
      bytesAvailable: 14,
      endOfBitmap: true,
      unwrittenPixels: 0,
      deltas: 0,
    });
  });

  it('decodes an even absolute run without padding', () => {
    const dib = decodeDib(rle8(4, 1, [0, 4, 1, 2, 3, 0, 0, 1]));
    expect([...dib.indices]).toEqual([1, 2, 3, 0]);
    expect(dib.rle?.bytesRead).toBe(8);
  });

  it('leaves pixels skipped by a delta or an early end of line as index 0', () => {
    // 4×3: delta (1, 1) to x=1 on stored row 1, two pixels of colour 4, end of line, then one
    // pixel of colour 5 on stored row 2 and end of bitmap.
    const dib = decodeDib(rle8(4, 3, [0, 2, 1, 1, 2, 4, 0, 0, 1, 5, 0, 1]));
    expect([...dib.indices]).toEqual([5, 0, 0, 0, 0, 4, 4, 0, 0, 0, 0, 0]);
    expect(dib.rle).toMatchObject({ endOfBitmap: true, unwrittenPixels: 9, deltas: 1 });
  });

  it('stops when the data runs out between instructions, without an end-of-bitmap', () => {
    const dib = decodeDib(rle8(2, 2, [2, 6]));
    expect([...dib.indices]).toEqual([0, 0, 6, 6]);
    expect(dib.rle).toMatchObject({ bytesRead: 2, endOfBitmap: false, unwrittenPixels: 2 });
  });

  it('decodes uncompressed 8-bit rows padded to 4 bytes, bottom-up and top-down', () => {
    // 3×2: each row is 3 pixels + 1 padding byte.
    const pixelData = [1, 2, 3, 0xee, 4, 5, 6, 0xee];
    const bottomUp = decodeDib(buildDib({ width: 3, height: 2, palette: PALETTE, pixelData }));
    expect([...bottomUp.indices]).toEqual([4, 5, 6, 1, 2, 3]);
    expect(bottomUp.rle).toBeUndefined();
    const topDown = decodeDib(buildDib({ width: 3, height: -2, palette: PALETTE, pixelData }));
    expect(topDown.topDown).toBe(true);
    expect(topDown.height).toBe(2);
    expect([...topDown.indices]).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('decodes uncompressed 4-bit and 1-bit rows, high bits first', () => {
    const four = decodeDib(
      buildDib({
        width: 3,
        height: 1,
        bitCount: 4,
        palette: PALETTE_16,
        colorsUsed: 0,
        pixelData: [0x12, 0xf0, 0, 0],
      }),
    );
    expect([...four.indices]).toEqual([1, 2, 15]);
    expect(four.colorCount).toBe(16); // biClrUsed 0 means 2^bitCount entries

    const one = decodeDib(
      buildDib({
        width: 10,
        height: 1,
        bitCount: 1,
        palette: [0, 0, 0, 255, 255, 255],
        pixelData: [0xa5, 0xc0, 0, 0],
      }),
    );
    expect([...one.indices]).toEqual([1, 0, 1, 0, 0, 1, 0, 1, 1, 1]);
  });

  it('decodes a headerless DIB (as stored in NE bitmap resources) like the file', () => {
    const codes = [3, 2, 0, 0, 3, 1, 0, 1];
    const file = decodeDib(rle8(3, 2, codes));
    const headerless = decodeDib(rle8(3, 2, codes, { fileHeader: false }));
    expect(headerless.fileHeader).toBeUndefined();
    expect(headerless.indices).toEqual(file.indices);
    expect(headerless.palette).toEqual(file.palette);
    // Resources are padded to their alignment: trailing bytes are ignored for BI_RGB too.
    const padded = new Uint8Array([
      ...buildDib({ width: 1, height: 1, palette: PALETTE, pixelData: [2, 0, 0, 0], fileHeader: false }),
      0,
      0,
    ]);
    expect([...decodeDib(padded).indices]).toEqual([2]);
  });

  describe('rejects malformed input with FormatError', () => {
    const cases: [string, Uint8Array, RegExp][] = [
      ['a run past the end of a row', rle8(2, 1, [3, 1]), /overflows the 2×1 bitmap/],
      ['an absolute run past the end of a row', rle8(2, 1, [0, 3, 1, 2, 3, 0]), /overflows/],
      ['a run past the last row', rle8(1, 1, [1, 1, 0, 0, 1, 1]), /overflows/],
      ['a delta past the right edge followed by a run', rle8(2, 2, [0, 2, 2, 0, 1, 1]), /overflows/],
      ['a truncated absolute run', rle8(4, 1, [0, 4, 1, 2]), /cannot read 4 bytes/],
      ['a truncated escape', rle8(4, 1, [0]), /cannot read 1 byte/],
      ['RLE data longer than the file', rle8(2, 1, [2, 1, 0, 1], { imageSize: 99 }), /runs past the end/],
      ['a top-down RLE8 bitmap', rle8(2, -1, [2, 1, 0, 1]), /cannot be top-down/],
      [
        'RLE4',
        buildDib({ width: 2, height: 1, bitCount: 4, compression: 2, palette: PALETTE, pixelData: [] }),
        /compression 2/,
      ],
      [
        '24-bit pixels',
        buildDib({ width: 1, height: 1, bitCount: 24, palette: [], pixelData: [0, 0, 0, 0] }),
        /bit count 24/,
      ],
      ['zero width', buildDib({ width: 0, height: 1, palette: PALETTE, pixelData: [] }), /invalid size/],
      [
        'short uncompressed data',
        buildDib({ width: 4, height: 2, palette: PALETTE, pixelData: [1, 2, 3, 4] }),
        /needs 8 bytes/,
      ],
      [
        'too many colours',
        buildDib({ width: 1, height: 1, bitCount: 1, palette: PALETTE, pixelData: [0, 0, 0, 0] }),
        /too many/,
      ],
      ['an OS/2 core header', new Uint8Array([12, 0, 0, 0, 1, 0, 1, 0, 1, 0, 8, 0]), /BITMAPCOREHEADER/],
      ['an empty input', new Uint8Array(), /cannot read 4 bytes/],
    ];
    it.each(cases)('%s', (_, bytes, message) => {
      expect(() => decodeDib(bytes, 'test.dib')).toThrow(FormatError);
      expect(() => decodeDib(bytes, 'test.dib')).toThrow(message);
    });

    it('a pixel offset outside the file', () => {
      const bytes = rle8(1, 1, [1, 1, 0, 1]);
      new DataView(bytes.buffer).setUint32(10, 9999, true);
      expect(() => decodeDib(bytes)).toThrow(/outside the file/);
    });
  });
});
