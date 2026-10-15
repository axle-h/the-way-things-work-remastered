/**
 * The resources the remake reads from the original program file, `DKCODE/TWTW.EXE`
 * (docs/formats/program.md §Resources): the `PALETTE` resource, bitmaps referred to as `@NAME`,
 * the cursors and strings of the string table.
 */
import { decodeDib, type Dib } from '../dib/dib.ts';
import { parseLogPalette, type LogPalette } from '../dib/palette.ts';
import { decodeCursor, parseCursorGroup, type CursorImage } from './cursor.ts';
import { decodeWindows1252 } from '../text.ts';
import { NE_RESOURCE_TYPE, type NeResourceKey, type NeResources } from './resources.ts';

/** Type name and id of the program's palette resource. */
export const PALETTE_RESOURCE_TYPE = 'PALETTE';
export const PALETTE_RESOURCE_ID = 200;

/**
 * Decodes a bitmap resource. `ref` is a database reference such as `@THUMB` (a named bitmap), a
 * bare name, or an integer id.
 */
export function readBitmapResource(resources: NeResources, ref: NeResourceKey): Dib {
  const id = typeof ref === 'string' && ref.startsWith('@') ? ref.slice(1) : ref;
  const bytes = resources.get(NE_RESOURCE_TYPE.bitmap, id);
  return decodeDib(bytes, `${resources.name} bitmap ${String(id)}`);
}

/** Parses the program's `PALETTE` resource (id 200), a `LOGPALETTE`. */
export function readPaletteResource(resources: NeResources): LogPalette {
  return parseLogPalette(
    resources.get(PALETTE_RESOURCE_TYPE, PALETTE_RESOURCE_ID),
    `${resources.name} PALETTE ${PALETTE_RESOURCE_ID}`,
  );
}

/** A cursor group with its images decoded. */
export interface CursorResource {
  /** The group's resource id. */
  readonly id: NeResourceKey;
  readonly images: readonly CursorImage[];
}

/** Decodes every cursor group and its cursor images. */
export function readCursorResources(resources: NeResources): CursorResource[] {
  return resources.ofType(NE_RESOURCE_TYPE.groupCursor).map((group) => {
    const directory = parseCursorGroup(
      resources.data(group),
      `${resources.name} cursor group ${String(group.id)}`,
    );
    const images = directory.entries.map((entry) => {
      const bytes = resources.get(NE_RESOURCE_TYPE.cursor, entry.id);
      return decodeCursor(bytes.subarray(0, entry.byteLength), `${resources.name} cursor ${entry.id}`);
    });
    return { id: group.id, images };
  });
}

/** String ids the remake reads from the program's string table (program.md, Strings). */
export const ProgramString = {
  /** The main window's title, also the print job's name: "The Way Things Work". */
  title: 2001,
  /** The copyright line in the band below a copied or printed picture (special-screens.md §4.4). */
  copyright: 5000,
} as const;

/**
 * A string of the program's string table (program.md, Strings): `RT_STRING` block
 * `(id >> 4) + 1` holds strings `id & ~15` to `id | 15`, each a length byte followed by that many
 * Windows-1252 bytes. `null` if the block or the string is missing or empty.
 */
export function readStringResource(resources: NeResources, id: number): string | null {
  const block = resources.find(NE_RESOURCE_TYPE.string, (id >> 4) + 1);
  if (block === undefined) return null;
  const bytes = resources.data(block);
  let at = 0;
  for (let index = 0; index < (id & 15); index++) {
    if (at >= bytes.length) return null;
    at += 1 + bytes[at]!;
  }
  if (at >= bytes.length) return null;
  const length = bytes[at]!;
  if (length === 0 || at + 1 + length > bytes.length) return null;
  return decodeWindows1252(bytes.subarray(at + 1, at + 1 + length));
}
