import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decodePng, encodePng } from './png.ts';

describe('PNG', () => {
  const width = 3;
  const height = 2;
  const rgb = Uint8Array.from({ length: width * height * 3 }, (_, i) => (i * 37) & 0xff);

  it('round-trips RGB pixels', () => {
    const png = encodePng(width, height, rgb);
    expect([...png.subarray(1, 4)].map((c) => String.fromCharCode(c)).join('')).toBe('PNG');
    expect(decodePng(png)).toEqual({ width, height, rgb });
  });

  it('writes one filter byte per row before the pixels', () => {
    const png = encodePng(width, height, rgb);
    const idat = png.indexOf(0x49, 33); // 'I' of IDAT, after the 33-byte signature + IHDR chunk
    const length = new DataView(png.buffer).getUint32(idat - 4);
    const raw = inflateSync(png.subarray(idat + 4, idat + 4 + length));
    expect(raw.length).toBe((width * 3 + 1) * height);
    expect(raw[0]).toBe(0);
  });

  it('rejects a buffer of the wrong size', () => {
    expect(() => encodePng(2, 2, new Uint8Array(5))).toThrow(/expected 12 bytes/);
  });
});
