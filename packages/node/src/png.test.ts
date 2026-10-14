import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decodePng, encodeIndexedPng, indexedToRgb } from './png.ts';

const palette = new Uint8Array(768).map((_, i) => (i * 37) & 0xff);
const image = { width: 3, height: 2, pixels: Uint8Array.of(0, 1, 2, 255, 128, 7) };

describe('PNG', () => {
  it('round-trips an indexed image through its palette', () => {
    const png = encodeIndexedPng(image, palette);
    expect(decodePng(png)).toEqual(indexedToRgb(image, palette));
  });

  it('undoes every row filter of an RGB image', () => {
    // Two pixels per row, one row per filter type (none, sub, up, average, Paeth).
    const width = 2;
    const rows = [
      [0, 10, 20, 30, 40, 50, 60],
      [1, 1, 2, 3, 4, 5, 6],
      [2, 1, 1, 1, 1, 1, 1],
      [3, 4, 4, 4, 4, 4, 4],
      [4, 1, 2, 3, 4, 5, 6],
    ];
    const header = new Uint8Array(13);
    new DataView(header.buffer).setUint32(0, width);
    new DataView(header.buffer).setUint32(4, rows.length);
    header.set([8, 2, 0, 0, 0], 8);
    const png = assemble([
      ['IHDR', header],
      ['IDAT', deflateSync(Uint8Array.from(rows.flat()))],
      ['IEND', new Uint8Array(0)],
    ]);
    const { rgb } = decodePng(png);
    const row = (y: number): number[] => [...rgb.subarray(y * 6, y * 6 + 6)];
    expect(row(0)).toEqual([10, 20, 30, 40, 50, 60]);
    expect(row(1)).toEqual([1, 2, 3, 5, 7, 9]); // sub: + the pixel to the left
    expect(row(2)).toEqual([2, 3, 4, 6, 8, 10]); // up: + the pixel above
    expect(row(3)).toEqual([5, 5, 6, 9, 10, 12]); // average of left and above
    // Paeth: the nearest of left, above and upper-left to left + above − upper-left (here: above).
    expect(row(4)).toEqual([6, 7, 9, 13, 15, 18]);
  });

  it('rejects what it does not support', () => {
    expect(() => decodePng(Uint8Array.of(1, 2, 3))).toThrow(/signature/);
  });
});

function assemble(chunks: readonly (readonly [string, Uint8Array])[]): Uint8Array {
  // Built with the encoder's own layout: signature, then length/type/body/CRC chunks. The decoder
  // does not check CRCs, so zeros are fine here.
  const parts: number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (const [type, body] of chunks) {
    const length = body.length;
    parts.push(length >>> 24, (length >> 16) & 0xff, (length >> 8) & 0xff, length & 0xff);
    parts.push(...[...type].map((c) => c.charCodeAt(0)), ...body, 0, 0, 0, 0);
  }
  return Uint8Array.from(parts);
}
