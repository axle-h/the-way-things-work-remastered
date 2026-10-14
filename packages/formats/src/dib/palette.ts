/**
 * The remake's 256-entry screen palette and the Windows `LOGPALETTE` structure, implemented from
 * docs/formats/dib-and-palette.md.
 */
import { ByteReader } from '../reader.ts';

/** Number of entries in the screen palette. */
export const PALETTE_SIZE = 256;
/** First and last palette entries that hold the artwork's own colours. */
export const ARTWORK_FIRST_INDEX = 10;
export const ARTWORK_LAST_INDEX = 245;

/** `PALETTEENTRY.peFlags` bits. */
export const PALETTE_ENTRY_FLAGS = { reserved: 0x01, explicit: 0x02, noCollapse: 0x04 } as const;

/**
 * The 20 Windows static colours as RGB triplets: entries 0–9 followed by 246–255 (public Windows
 * constants, see the table in docs/formats/dib-and-palette.md).
 */
const STATIC_LOW = [
  0x000000, 0x800000, 0x008000, 0x808000, 0x000080, 0x800080, 0x008080, 0xc0c0c0, 0xc0dcc0, 0xa6caf0,
];
const STATIC_HIGH = [
  0xfffbf0, 0xa0a0a4, 0x808080, 0xff0000, 0x00ff00, 0xffff00, 0x0000ff, 0xff00ff, 0x00ffff, 0xffffff,
];

/** The Windows static colour for screen palette entry `index` (0–9 or 246–255), as `0xRRGGBB`. */
export function windowsStaticColor(index: number): number | undefined {
  if (index >= 0 && index < ARTWORK_FIRST_INDEX) return STATIC_LOW[index];
  if (index > ARTWORK_LAST_INDEX && index < PALETTE_SIZE) return STATIC_HIGH[index - ARTWORK_LAST_INDEX - 1];
  return undefined;
}

/**
 * Builds the screen palette (256 RGB triplets, 768 bytes): entries 10–245 from `source`, the rest
 * from the Windows static colours. `source` is a colour table as RGB triplets with at least 246
 * entries, such as `Dib.palette` or {@link LogPalette.colors}.
 */
export function buildMasterPalette(source: Uint8Array): Uint8Array {
  if (source.length < (ARTWORK_LAST_INDEX + 1) * 3) {
    throw new RangeError(
      `a palette source needs at least ${ARTWORK_LAST_INDEX + 1} entries; got ${Math.floor(source.length / 3)}`,
    );
  }
  const palette = new Uint8Array(PALETTE_SIZE * 3);
  for (let i = 0; i < PALETTE_SIZE; i++) {
    const fixed = windowsStaticColor(i);
    if (fixed === undefined) {
      palette.set(source.subarray(i * 3, i * 3 + 3), i * 3);
    } else {
      palette[i * 3] = fixed >> 16;
      palette[i * 3 + 1] = (fixed >> 8) & 0xff;
      palette[i * 3 + 2] = fixed & 0xff;
    }
  }
  return palette;
}

/** Whether entries `first`…`last` (inclusive) of two RGB colour tables are equal. */
export function paletteRangeEquals(a: Uint8Array, b: Uint8Array, first: number, last: number): boolean {
  const end = (last + 1) * 3;
  if (a.length < end || b.length < end) return false;
  for (let i = first * 3; i < end; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** A Windows `LOGPALETTE`, as stored in the program's custom `PALETTE` resource. */
export interface LogPalette {
  /** `palVersion`: 0x300 for Windows 3.x. */
  readonly version: number;
  /** RGB triplets, `3 * entryCount` bytes. */
  readonly colors: Uint8Array;
  /** `peFlags` of each entry, see {@link PALETTE_ENTRY_FLAGS}. */
  readonly flags: Uint8Array;
  /** Bytes after the last entry (resources are padded to their alignment). */
  readonly trailingBytes: number;
}

/** Parses a `LOGPALETTE`: `palVersion` u16, `palNumEntries` u16, then `PALETTEENTRY` r, g, b, flags. */
export function parseLogPalette(bytes: Uint8Array, name = 'PALETTE'): LogPalette {
  const reader = new ByteReader(bytes, { order: 'le', name });
  const version = reader.u16();
  if (version !== 0x300) throw reader.error(`unexpected LOGPALETTE version 0x${version.toString(16)}`, 0);
  const count = reader.u16();
  if (count * 4 > reader.remaining) {
    throw reader.error(`${count} entries need ${count * 4} bytes; only ${reader.remaining} left`);
  }
  const colors = new Uint8Array(count * 3);
  const flags = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = reader.u8();
    colors[i * 3 + 1] = reader.u8();
    colors[i * 3 + 2] = reader.u8();
    flags[i] = reader.u8();
  }
  return { version, colors, flags, trailingBytes: reader.remaining };
}
