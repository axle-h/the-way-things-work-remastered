/**
 * Windows 3.x cursor resources, from the public resource formats (see docs/formats/program.md
 * §Cursors).
 *
 * A cursor group (`RT_GROUP_CURSOR`) is a directory: reserved u16, type u16 (2 = cursor), count u16,
 * then per image: width u16, height u16 (twice the cursor height: both masks), planes u16,
 * bit count u16, byte length u32, id u16 of the `RT_CURSOR` resource.
 *
 * A cursor image (`RT_CURSOR`) is: hotspot x u16, hotspot y u16, a `BITMAPINFOHEADER` whose height
 * covers both masks, a colour table, then the XOR mask followed by the AND mask, each monochrome,
 * bottom-up, rows padded to 4 bytes.
 */
import { readInfoHeader, unpackRows, type DibInfoHeader } from '../dib/dib.ts';
import { ByteReader } from '../reader.ts';

/** Cursor pixel values, from the AND and XOR mask bits. */
export const CURSOR_PIXEL = {
  /** AND 0, XOR 0. */
  black: 0,
  /** AND 0, XOR 1. */
  white: 1,
  /** AND 1, XOR 0: the screen shows through. */
  transparent: 2,
  /** AND 1, XOR 1: the screen colour is inverted. */
  invert: 3,
} as const;

export type CursorPixel = (typeof CURSOR_PIXEL)[keyof typeof CURSOR_PIXEL];

export interface CursorGroupEntry {
  readonly width: number;
  /** As stored: twice the cursor height. */
  readonly height: number;
  readonly planes: number;
  readonly bitCount: number;
  /** Byte length of the cursor image (without the resource's alignment padding). */
  readonly byteLength: number;
  /** Id of the `RT_CURSOR` resource. */
  readonly id: number;
}

export interface CursorGroup {
  /** The reserved first word. */
  readonly unknown1: number;
  /** 2 for cursors (1 would be icons). */
  readonly kind: number;
  readonly entries: readonly CursorGroupEntry[];
}

export interface CursorImage {
  readonly width: number;
  /** Height of the cursor (half the bitmap header's height). */
  readonly height: number;
  readonly hotspotX: number;
  readonly hotspotY: number;
  /** One {@link CursorPixel} per pixel, top-down, `width * height`. */
  readonly pixels: Uint8Array;
  /** The colour table as RGB triplets (normally black and white). */
  readonly colors: Uint8Array;
  readonly infoHeader: DibInfoHeader;
}

/** Parses an `RT_GROUP_CURSOR` resource. */
export function parseCursorGroup(bytes: Uint8Array, name = 'cursor group'): CursorGroup {
  const reader = new ByteReader(bytes, { order: 'le', name });
  const unknown1 = reader.u16();
  const kind = reader.u16();
  if (kind !== 2) throw reader.error(`expected a cursor directory (type 2), found type ${kind}`, 2);
  const count = reader.u16();
  const entries: CursorGroupEntry[] = [];
  for (let i = 0; i < count; i++) {
    entries.push({
      width: reader.u16(),
      height: reader.u16(),
      planes: reader.u16(),
      bitCount: reader.u16(),
      byteLength: reader.u32(),
      id: reader.u16(),
    });
  }
  return { unknown1, kind, entries };
}

/** Decodes an `RT_CURSOR` resource (a monochrome Windows 3.x cursor). */
export function decodeCursor(bytes: Uint8Array, name = 'cursor'): CursorImage {
  const reader = new ByteReader(bytes, { order: 'le', name });
  const hotspotX = reader.u16();
  const hotspotY = reader.u16();
  const headerAt = reader.position;
  const info = readInfoHeader(reader);
  if (info.bitCount !== 1 || info.planes !== 1 || info.compression !== 0) {
    throw reader.error(
      `only uncompressed monochrome cursors are supported (bit count ${info.bitCount}, compression ${info.compression})`,
      headerAt,
    );
  }
  const width = info.width;
  if (width <= 0 || info.height <= 0 || info.height % 2 !== 0) {
    throw reader.error(`invalid cursor size ${width}×${info.height}`, headerAt + 4);
  }
  const height = info.height / 2;
  reader.seek(headerAt + info.headerSize);
  const colorCount = info.colorsUsed === 0 ? 2 : info.colorsUsed;
  if (colorCount > 2) throw reader.error(`${colorCount} colours in a monochrome cursor`, headerAt + 32);
  const colors = new Uint8Array(colorCount * 3);
  for (let i = 0; i < colorCount; i++) {
    const [blue, green, red] = reader.bytesView(4);
    colors.set([red ?? 0, green ?? 0, blue ?? 0], i * 3);
  }
  const stride = Math.ceil(width / 32) * 4;
  const maskLength = stride * height;
  const xorMask = new Uint8Array(width * height);
  const andMask = new Uint8Array(width * height);
  unpackRows(reader.bytesView(maskLength), width, height, 1, stride, false, xorMask);
  unpackRows(reader.bytesView(maskLength), width, height, 1, stride, false, andMask);
  const pixels = new Uint8Array(width * height);
  for (let i = 0; i < pixels.length; i++) pixels[i] = ((andMask[i] ?? 0) << 1) | (xorMask[i] ?? 0);
  return { width, height, hotspotX, hotspotY, pixels, colors, infoHeader: info };
}
