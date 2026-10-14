/**
 * Mouse cursors (behaviour.md §8, program.md "Cursors"): the database names a cursor per object,
 * the program maps the names to its two cursor resources, and shows the Windows hourglass while
 * it is busy.
 */
import { readCursorResources, type CursorImage, type NeResources } from '@twtw/formats';

export { CURSOR_PIXEL, type CursorImage, type CursorPixel } from '@twtw/formats';

/** What the pointer should look like. */
export type CursorName =
  /** Cursor group 157 of `TWTW.EXE`. */
  | 'arrow'
  /** Cursor group 107, the pointing hand. */
  | 'hand'
  /** The Windows hourglass (not in `TWTW.EXE`). */
  | 'wait';

/** The cursor group resources of `TWTW.EXE` for the named cursors (program.md, Cursors). */
export const CURSOR_GROUPS: Readonly<Record<Exclude<CursorName, 'wait'>, number>> = {
  arrow: 157,
  hand: 107,
};

/**
 * The cursor a database name selects, ignoring case: `Normal` and `Arrow` are the arrow, `Hand`
 * the hand. `null` for an empty or unknown name, which leaves the cursor as it is.
 */
export function cursorForName(name: string | null): CursorName | null {
  switch (name?.toLowerCase()) {
    case 'normal':
    case 'arrow':
      return 'arrow';
    case 'hand':
      return 'hand';
    default:
      return null;
  }
}

/** The images of the arrow and the hand, decoded from the program's cursor groups (program.md). */
export function readProgramCursors(
  program: NeResources,
): Partial<Record<Exclude<CursorName, 'wait'>, CursorImage>> {
  const groups = readCursorResources(program);
  const cursors: Partial<Record<Exclude<CursorName, 'wait'>, CursorImage>> = {};
  for (const name of ['arrow', 'hand'] as const) {
    const image = groups.find((group) => group.id === CURSOR_GROUPS[name])?.images[0];
    if (image !== undefined) cursors[name] = image;
  }
  return cursors;
}
