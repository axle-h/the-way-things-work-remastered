import { crc32 as zlibCrc32, inflateSync } from 'node:zlib';
import type { IndexedImage } from '@twtw/engine';
import { describe, expect, it } from 'vitest';
import { crc32, encodeIndexedPng, upscaleIndexed } from '../src/png.ts';

const image = (width: number, height: number, pixels: number[]): IndexedImage => ({
  width,
  height,
  pixels: Uint8Array.from(pixels),
});

/** A synthetic palette: index i is (i, 255 − i, i ^ 0x55). */
const PALETTE = Uint8Array.from({ length: 768 }, (_, i) => {
  const index = Math.floor(i / 3);
  return [index, 255 - index, index ^ 0x55][i % 3]!;
});

interface Chunk {
  readonly type: string;
  readonly body: Uint8Array;
  readonly crcOk: boolean;
}

/** Splits a PNG into chunks, checking the signature and every CRC. */
function chunks(png: Uint8Array): Chunk[] {
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const found: Chunk[] = [];
  for (let at = 8; at < png.length;) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    const body = png.subarray(at + 8, at + 8 + length);
    const crcOk = view.getUint32(at + 8 + length) === zlibCrc32(png.subarray(at + 4, at + 8 + length));
    found.push({ type, body, crcOk });
    at += 12 + length;
  }
  return found;
}

describe('upscaleIndexed', () => {
  it('turns each pixel into a scale × scale block, with no new indices', () => {
    const big = upscaleIndexed(image(2, 2, [1, 2, 3, 4]), 3);
    expect([big.width, big.height]).toEqual([6, 6]);
    const rows = Array.from({ length: 6 }, (_, y) => [...big.pixels.subarray(y * 6, y * 6 + 6)]);
    expect(rows).toEqual([
      [1, 1, 1, 2, 2, 2],
      [1, 1, 1, 2, 2, 2],
      [1, 1, 1, 2, 2, 2],
      [3, 3, 3, 4, 4, 4],
      [3, 3, 3, 4, 4, 4],
      [3, 3, 3, 4, 4, 4],
    ]);
  });

  it('keeps the picture at 1× and refuses fractional scales', () => {
    const small = image(1, 1, [7]);
    expect(upscaleIndexed(small, 1)).toBe(small);
    expect(() => upscaleIndexed(small, 1.5)).toThrow();
    expect(() => upscaleIndexed(small, 0)).toThrow();
  });

  it('gives a base page 2× and 4× sizes for copy and print', () => {
    const page = image(
      638,
      499,
      Array.from({ length: 638 * 499 }, (_, i) => i & 0xff),
    );
    expect([upscaleIndexed(page, 2).width, upscaleIndexed(page, 2).height]).toEqual([1276, 998]);
    const print = upscaleIndexed(page, 4);
    expect([print.width, print.height]).toEqual([2552, 1996]);
    expect(print.pixels[3 * 2552 + 7]).toBe(page.pixels[1]);
  });
});

describe('encodeIndexedPng', () => {
  it('writes a palette PNG with the size, palette and pixels, rows unfiltered', async () => {
    const picture = image(3, 2, [0, 1, 2, 253, 254, 255]);
    const png = await encodeIndexedPng(picture, PALETTE);
    const parts = chunks(png);
    expect(parts.map((part) => part.type)).toEqual(['IHDR', 'PLTE', 'IDAT', 'IEND']);
    expect(parts.every((part) => part.crcOk)).toBe(true);
    const header = new DataView(parts[0]!.body.buffer, parts[0]!.body.byteOffset, 13);
    expect([header.getUint32(0), header.getUint32(4)]).toEqual([3, 2]);
    // Bit depth 8, colour type 3 (palette), deflate, adaptive filtering, no interlace.
    expect([...parts[0]!.body.subarray(8)]).toEqual([8, 3, 0, 0, 0]);
    expect([...parts[1]!.body]).toEqual([...PALETTE]);
    expect([...inflateSync(parts[2]!.body)]).toEqual([0, 0, 1, 2, 0, 253, 254, 255]);
    expect(parts[3]!.body.length).toBe(0);
  });

  it('encodes an upscaled picture that decodes to the same blocks', async () => {
    const big = upscaleIndexed(image(2, 1, [9, 200]), 2);
    const raw = inflateSync(chunks(await encodeIndexedPng(big, PALETTE))[2]!.body);
    expect([...raw]).toEqual([0, 9, 9, 200, 200, 0, 9, 9, 200, 200]);
  });

  it('refuses a short palette or the wrong number of pixels', async () => {
    await expect(encodeIndexedPng(image(2, 2, [1, 2, 3]), PALETTE)).rejects.toThrow();
    await expect(encodeIndexedPng(image(1, 1, [1]), new Uint8Array(30))).rejects.toThrow();
  });
});

describe('crc32', () => {
  it('matches zlib', () => {
    const bytes = Uint8Array.from({ length: 1000 }, (_, i) => (i * 37) & 0xff);
    expect(crc32(bytes)).toBe(zlibCrc32(bytes));
    expect(crc32(new TextEncoder().encode('IEND'))).toBe(0xae426082);
  });
});
