import { describe, expect, it } from 'vitest';
import { icnsFromPngs, icoFromPngs, pngSize } from './icons.ts';

/** The start of a PNG: signature and IHDR with the given size; enough for the containers. */
function fakePng(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

describe('icons', () => {
  it('reads a PNG size', () => {
    expect(pngSize(fakePng(192, 180))).toEqual({ width: 192, height: 180 });
    expect(() => pngSize(new Uint8Array(30))).toThrow(/not a PNG/);
  });

  it('writes an .ico of PNG images', () => {
    const [a, b] = [fakePng(192, 192), fakePng(256, 256)];
    const ico = icoFromPngs([a, b]);
    const view = new DataView(ico.buffer);
    expect([view.getUint16(0, true), view.getUint16(2, true), view.getUint16(4, true)]).toEqual([0, 1, 2]);
    expect([
      ico[6],
      ico[7],
      view.getUint16(12, true),
      view.getUint32(14, true),
      view.getUint32(18, true),
    ]).toEqual([192, 192, 32, 33, 38]);
    expect([ico[22], ico[23], view.getUint32(34, true)]).toEqual([0, 0, 38 + 33]);
    expect(ico.subarray(38, 71)).toEqual(a);
    expect(() => icoFromPngs([fakePng(512, 512)])).toThrow(/at most 256/);
  });

  it('writes an .icns of PNG images', () => {
    const png = fakePng(512, 512);
    const icns = icnsFromPngs([{ type: 'ic09', png }]);
    const view = new DataView(icns.buffer);
    expect(new TextDecoder().decode(icns.subarray(0, 4))).toBe('icns');
    expect(view.getUint32(4)).toBe(icns.length);
    expect(new TextDecoder().decode(icns.subarray(8, 12))).toBe('ic09');
    expect(view.getUint32(12)).toBe(8 + png.length);
    expect(icns.subarray(16)).toEqual(png);
  });
});
