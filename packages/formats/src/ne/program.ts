/**
 * The resources the remake reads from the original program file, `DKCODE/TWTW.EXE`
 * (docs/formats/program.md §Resources): the `PALETTE` resource, bitmaps referred to as `@NAME`,
 * and the cursors.
 */
import { decodeDib, type Dib } from '../dib/dib.ts';
import { parseLogPalette, type LogPalette } from '../dib/palette.ts';
import { decodeCursor, parseCursorGroup, type CursorImage } from './cursor.ts';
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
