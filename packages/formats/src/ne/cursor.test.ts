import { describe, expect, it } from 'vitest';
import { FormatError } from '../reader.ts';
import { buildDib } from '../testing/dib-builder.ts';
import { buildNeExecutable } from '../testing/ne-builder.ts';
import { ByteWriter } from '../writer.ts';
import { CURSOR_PIXEL, decodeCursor, parseCursorGroup } from './cursor.ts';
import { readBitmapResource, readCursorResources, readPaletteResource } from './program.ts';
import { NE_RESOURCE_TYPE, readNeResources } from './resources.ts';

const { black, white, transparent, invert } = CURSOR_PIXEL;

/**
 * A 4×2 monochrome cursor with hotspot (2, 1). Masks are bottom-up, one byte per row padded to
 * 4 bytes. Top row: transparent, black, white, invert; bottom row: black, black, transparent, white.
 */
function syntheticCursor(options: { bitCount?: number; colorsUsed?: number } = {}): Uint8Array {
  const xorRows = [0b0001_0000, 0b0011_0000]; // bottom row, top row
  const andRows = [0b0010_0000, 0b1001_0000];
  const writer = new ByteWriter('le')
    .u16(2)
    .u16(1)
    .u32(40)
    .i32(4)
    .i32(4) // twice the height: both masks
    .u16(1)
    .u16(options.bitCount ?? 1)
    .u32(0)
    .u32(16)
    .i32(0)
    .i32(0)
    .u32(options.colorsUsed ?? 2)
    .u32(0)
    .bytes([0, 0, 0, 0, 255, 255, 255, 0]);
  for (const row of xorRows) writer.bytes([row, 0, 0, 0]);
  for (const row of andRows) writer.bytes([row, 0, 0, 0]);
  return writer.toBytes();
}

/** A cursor group directory with one entry. */
function cursorGroup(id: number, byteLength: number): Uint8Array {
  return new ByteWriter('le')
    .u16(0)
    .u16(2)
    .u16(1)
    .u16(4)
    .u16(4)
    .u16(1)
    .u16(1)
    .u32(byteLength)
    .u16(id)
    .toBytes();
}

describe('decodeCursor', () => {
  it('combines the XOR and AND masks into pixel values, top-down', () => {
    const cursor = decodeCursor(syntheticCursor());
    expect(cursor.width).toBe(4);
    expect(cursor.height).toBe(2);
    expect([cursor.hotspotX, cursor.hotspotY]).toEqual([2, 1]);
    expect([...cursor.colors]).toEqual([0, 0, 0, 255, 255, 255]);
    expect([...cursor.pixels]).toEqual([transparent, black, white, invert, black, black, transparent, white]);
    expect(cursor.infoHeader.height).toBe(4);
  });

  it('defaults to two colours when biClrUsed is 0', () => {
    expect(decodeCursor(syntheticCursor({ colorsUsed: 0 })).colors).toHaveLength(6);
  });

  it('rejects colour cursors and truncated masks', () => {
    expect(() => decodeCursor(syntheticCursor({ bitCount: 4 }))).toThrow(FormatError);
    expect(() => decodeCursor(syntheticCursor().subarray(0, 60))).toThrow(/cannot read 8 bytes/);
  });
});

describe('parseCursorGroup', () => {
  it('reads the directory entries', () => {
    expect(parseCursorGroup(cursorGroup(9, 76))).toEqual({
      unknown1: 0,
      kind: 2,
      entries: [{ width: 4, height: 4, planes: 1, bitCount: 1, byteLength: 76, id: 9 }],
    });
  });

  it('rejects an icon directory', () => {
    const icons = new ByteWriter('le').u16(0).u16(1).u16(0).toBytes();
    expect(() => parseCursorGroup(icons)).toThrow(/expected a cursor directory/);
  });
});

describe('program resources', () => {
  const cursor = syntheticCursor();
  const thumb = buildDib({
    width: 2,
    height: 1,
    compression: 1,
    palette: [0, 0, 0, 9, 9, 9],
    pixelData: [2, 1, 0, 1],
    fileHeader: false,
  });
  const palette = new ByteWriter('le').u16(0x300).u16(1).bytes([1, 2, 3, 4]).toBytes();
  const ne = readNeResources(
    buildNeExecutable([
      { type: NE_RESOURCE_TYPE.groupCursor, id: 107, data: cursorGroup(3, cursor.length) },
      { type: NE_RESOURCE_TYPE.bitmap, id: 'THUMB', data: thumb },
      { type: NE_RESOURCE_TYPE.bitmap, id: 5, data: thumb },
      { type: 'PALETTE', id: 200, data: palette },
      { type: NE_RESOURCE_TYPE.cursor, id: 3, data: cursor },
    ]),
    'test.exe',
  );

  it('reads bitmaps by @NAME, name or id', () => {
    expect([...readBitmapResource(ne, '@THUMB').indices]).toEqual([1, 1]);
    expect(readBitmapResource(ne, 'Thumb').width).toBe(2);
    expect(readBitmapResource(ne, 5).height).toBe(1);
    expect(() => readBitmapResource(ne, '@MISSING')).toThrow(/no resource of type 2 with id "MISSING"/);
  });

  it('reads the PALETTE resource', () => {
    const logPalette = readPaletteResource(ne);
    expect([...logPalette.colors]).toEqual([1, 2, 3]);
    expect([...logPalette.flags]).toEqual([4]);
  });

  it('decodes cursor groups and their images, ignoring the alignment padding', () => {
    const cursors = readCursorResources(ne);
    expect(cursors).toHaveLength(1);
    expect(cursors[0]?.id).toBe(107);
    expect(cursors[0]?.images.map((image) => [image.width, image.height, image.hotspotX])).toEqual([
      [4, 2, 2],
    ]);
  });
});
