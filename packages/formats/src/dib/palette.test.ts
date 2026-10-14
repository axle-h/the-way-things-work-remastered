import { describe, expect, it } from 'vitest';
import { FormatError } from '../reader.ts';
import { ByteWriter } from '../writer.ts';
import {
  PALETTE_ENTRY_FLAGS,
  buildMasterPalette,
  paletteRangeEquals,
  parseLogPalette,
  windowsStaticColor,
} from './palette.ts';

/** A synthetic 256-entry RGB table where entry i is (i, 255 - i, 7). */
function syntheticTable(): Uint8Array {
  const table = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) table.set([i, 255 - i, 7], i * 3);
  return table;
}

const rgb = (palette: Uint8Array, index: number): number =>
  ((palette[index * 3] ?? 0) << 16) | ((palette[index * 3 + 1] ?? 0) << 8) | (palette[index * 3 + 2] ?? 0);

describe('windowsStaticColor', () => {
  it('gives the 20 static colours and nothing for the artwork range', () => {
    expect(windowsStaticColor(0)).toBe(0x000000);
    expect(windowsStaticColor(7)).toBe(0xc0c0c0);
    expect(windowsStaticColor(9)).toBe(0xa6caf0);
    expect(windowsStaticColor(246)).toBe(0xfffbf0);
    expect(windowsStaticColor(249)).toBe(0xff0000);
    expect(windowsStaticColor(255)).toBe(0xffffff);
    expect(windowsStaticColor(10)).toBeUndefined();
    expect(windowsStaticColor(245)).toBeUndefined();
    expect(windowsStaticColor(256)).toBeUndefined();
    expect(windowsStaticColor(-1)).toBeUndefined();
  });
});

describe('buildMasterPalette', () => {
  it('takes entries 10–245 from the source and the rest from the static colours', () => {
    const source = syntheticTable();
    const palette = buildMasterPalette(source);
    expect(palette).toHaveLength(768);
    for (let i = 10; i <= 245; i++) expect(rgb(palette, i)).toBe(rgb(source, i));
    for (const i of [0, 1, 8, 9, 246, 247, 254, 255]) expect(rgb(palette, i)).toBe(windowsStaticColor(i));
    expect(rgb(palette, 255)).toBe(0xffffff);
  });

  it('accepts a source with only 246 entries and rejects a shorter one', () => {
    expect(buildMasterPalette(syntheticTable().subarray(0, 246 * 3))).toHaveLength(768);
    expect(() => buildMasterPalette(new Uint8Array(245 * 3))).toThrow(RangeError);
  });
});

describe('paletteRangeEquals', () => {
  it('compares an inclusive range of entries', () => {
    const a = syntheticTable();
    const b = syntheticTable();
    b[0] = 99;
    b[255 * 3] = 99;
    expect(paletteRangeEquals(a, b, 10, 245)).toBe(true);
    expect(paletteRangeEquals(a, b, 0, 245)).toBe(false);
    expect(paletteRangeEquals(a, b, 10, 255)).toBe(false);
    expect(paletteRangeEquals(a, b.subarray(0, 100 * 3), 10, 245)).toBe(false);
  });
});

describe('parseLogPalette', () => {
  it('reads version, colours (red, green, blue) and flags, and counts trailing padding', () => {
    const bytes = new ByteWriter('le')
      .u16(0x300)
      .u16(3)
      .bytes([5, 0, 0, PALETTE_ENTRY_FLAGS.explicit])
      .bytes([0x11, 0x22, 0x33, PALETTE_ENTRY_FLAGS.noCollapse])
      .bytes([0xff, 0xfe, 0xfd, 0])
      .bytes([0, 0, 0, 0, 0, 0])
      .toBytes();
    const palette = parseLogPalette(bytes);
    expect(palette.version).toBe(0x300);
    expect([...palette.colors]).toEqual([5, 0, 0, 0x11, 0x22, 0x33, 0xff, 0xfe, 0xfd]);
    expect([...palette.flags]).toEqual([2, 4, 0]);
    expect(palette.trailingBytes).toBe(6);
  });

  it('rejects another version and a truncated table', () => {
    expect(() => parseLogPalette(new ByteWriter('le').u16(0x200).u16(0).toBytes())).toThrow(FormatError);
    const short = new ByteWriter('le').u16(0x300).u16(2).bytes([1, 2, 3, 4]).toBytes();
    expect(() => parseLogPalette(short)).toThrow(/2 entries need 8 bytes; only 4 left/);
  });
});
