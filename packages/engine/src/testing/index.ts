/**
 * Synthetic discs for tests (the repository holds no disc bytes, docs/CLEAN_ROOM.md): pictures,
 * a program file with a `PALETTE` resource and the bitmaps the engine draws itself, and helpers
 * for display objects and templates. Not part of the runtime API (see package.json "./testing").
 */
import type { BitmapObject, DisplayObject, PanelRef, Rect, Rgb, Template } from '@twtw/formats';
import {
  buildDib,
  buildNeExecutable,
  buildPageDatabase,
  ByteWriter,
  type PageDatabaseSpec,
} from '@twtw/formats/testing';
import { DATABASE_PATH, PROGRAM_PATH } from '../content.ts';
import { MemoryDataSource } from '../data/memory-source.ts';
import { ProgramBitmap } from '../pictures.ts';

/** A pixel value for each position, or one value for all. */
export type PixelFill = number | ((x: number, y: number) => number);

/**
 * An uncompressed 8-bit DIB whose pixel at (x, y) (from the top) is `fill`. The colour table is
 * deliberately not the palette (all grey ramp), since the engine must ignore it.
 */
export function syntheticDib(width: number, height: number, fill: PixelFill, fileHeader = true): Uint8Array {
  const stride = Math.ceil(width / 4) * 4;
  const data = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Rows are stored bottom-up.
      data[(height - 1 - y) * stride + x] = typeof fill === 'number' ? fill : fill(x, y);
    }
  }
  const palette = Array.from({ length: 256 * 3 }, (_, i) => Math.floor(i / 3));
  return buildDib({ width, height, palette, pixelData: data, fileHeader });
}

/**
 * The synthetic master palette's artwork entries: entry i (10–245) is (i, 255 − i, 7i mod 256),
 * except entry 245, which repeats the static colour `FFFBF0` (as on the disc).
 */
export function syntheticArtworkColour(index: number): Rgb {
  if (index === 245) return { red: 0xff, green: 0xfb, blue: 0xf0 };
  return { red: index, green: 255 - index, blue: (index * 7) & 0xff };
}

/** A `LOGPALETTE` resource: artwork entries 10–245, `PC_EXPLICIT` system entries elsewhere. */
export function syntheticLogPalette(): Uint8Array {
  const writer = new ByteWriter('le').u16(0x300).u16(256);
  for (let i = 0; i < 256; i++) {
    if (i >= 10 && i <= 245) {
      const { red, green, blue } = syntheticArtworkColour(i);
      writer.u8(red).u8(green).u8(blue).u8(4);
    } else {
      writer.u8(i).u8(0).u8(0).u8(2);
    }
  }
  return writer.toBytes();
}

/** Pixel values of the synthetic program bitmaps, so tests can recognise them on screen. */
export const SYNTHETIC_BITMAP_FILL = {
  [ProgramBitmap.animationControl]: 101,
  [ProgramBitmap.animationRewind]: 115,
  [ProgramBitmap.animationPlay]: 116,
  [ProgramBitmap.animationProgress]: 159,
  [ProgramBitmap.cancel]: 170,
  [ProgramBitmap.lampOn]: 172,
  [ProgramBitmap.lampOff]: 173,
} as const;

/** Sizes of the program bitmaps the engine draws (program.md, rendering.md §5–6). */
const PROGRAM_BITMAP_SIZES: readonly (readonly [number, number, number])[] = [
  [ProgramBitmap.animationControl, 74, 22],
  [ProgramBitmap.animationRewind, 15, 16],
  [ProgramBitmap.animationPlay, 16, 16],
  [ProgramBitmap.animationProgress, 100, 30],
  [ProgramBitmap.cancel, 62, 22],
  [ProgramBitmap.lampOn, 17, 8],
  [ProgramBitmap.lampOff, 18, 8],
];

/** Scroll-bar part bitmaps (named resources), 16 wide; each pixel is `fill + row % 2`. */
export const SYNTHETIC_SCROLL_PARTS = [
  { name: 'LINEUP', height: 16, fill: 60 },
  { name: 'LINEDOWN', height: 16, fill: 70 },
  { name: 'THUMB', height: 16, fill: 80 },
  { name: 'THUMBTRACK', height: 270, fill: 90 },
] as const;

/** A program file (NE) with the palette, the engine's numbered bitmaps and scroll-bar parts. */
export function syntheticProgram(): Uint8Array {
  return buildNeExecutable([
    { type: 'PALETTE', id: 200, data: syntheticLogPalette() },
    ...PROGRAM_BITMAP_SIZES.map(([id, width, height]) => ({
      type: 2,
      id,
      data: syntheticDib(
        width,
        height,
        SYNTHETIC_BITMAP_FILL[id as keyof typeof SYNTHETIC_BITMAP_FILL],
        false,
      ),
    })),
    ...SYNTHETIC_SCROLL_PARTS.map(({ name, height, fill }) => ({
      type: 2,
      id: name,
      data: syntheticDib(16, height, (_x, y) => fill + (y % 2), false),
    })),
  ]);
}

/**
 * A data source holding a page database built from `spec`, the synthetic program and the given
 * files. Returns the heap offsets of the labelled heap entries too.
 */
export function syntheticDisc(
  spec: PageDatabaseSpec,
  files: Readonly<Record<string, Uint8Array>> = {},
): { source: MemoryDataSource; refs: ReadonlyMap<string, number> } {
  const database = buildPageDatabase(spec);
  const source = new MemoryDataSource([
    [DATABASE_PATH, database.bytes],
    [PROGRAM_PATH, syntheticProgram()],
    ...Object.entries(files),
  ]);
  return { source, refs: database.refs };
}

// ---------------------------------------------------------------------------------------------
// Model helpers

export function rect(left: number, top: number, right: number, bottom: number): Rect {
  return { left, top, right, bottom };
}

export function rgb(value: number): Rgb {
  return { red: value >> 16, green: (value >> 8) & 0xff, blue: value & 0xff };
}

/** A Bitmap object; the stored rectangle's right/bottom are deliberately wrong (the picture decides). */
export function bitmapObject(id: number, left: number, top: number, file: string): BitmapObject {
  return {
    kind: 'bitmap',
    id,
    flags: 0,
    rect: rect(left, top, left + 999, top + 999),
    cursor: null,
    handlers: [],
    file,
  };
}

export function hotspotObject(id: number, area: Rect): DisplayObject {
  return { kind: 'hotspot', id, flags: 4, rect: area, cursor: 'Hand', handlers: [], unknown1: 0 };
}

export function panelSlot(
  panelId: number,
  x: number,
  y: number,
  width: number,
  height: number,
  colour: number,
  sharedPanel: number | null = null,
): PanelRef {
  return { panelType: 'display', panelId, sharedPanel, colour: rgb(colour), width, height, x, y };
}

/** A template with the given fields; everything else as on the disc's base templates. */
export function template(fields: Partial<Template> & Pick<Template, 'id' | 'pageType' | 'panels'>): Template {
  return {
    unknown1: null,
    unknown2: 0,
    width: 0,
    height: 0,
    position: null,
    unknown3: 0,
    unknown4: 0,
    unknown5: 0,
    unknown6: 0,
    unknownRect: null,
    unknownList1: [],
    unknownList2: [],
    handlers: [],
    ...fields,
  };
}
