import type { Rgb } from '@twtw/formats';

/** Palette indices of the Windows static colours the engine draws with (dib-and-palette.md). */
export const StaticColour = {
  black: 0,
  navy: 4,
  lightGrey: 7,
  /** `A0A0A4`. */
  mediumGrey: 247,
  darkGrey: 248,
  red: 249,
  white: 255,
} as const;

/** Static palette entries, in the order they are searched before the artwork entries. */
const STATIC_INDICES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 246, 247, 248, 249, 250, 251, 252, 253, 254, 255];

/**
 * The palette index a solid GDI brush of this colour paints with. Every panel colour on the disc
 * is one of the Windows static colours (rendering.md §3), and those come first: `FFFBF0` is entry
 * 246, although artwork entry 245 holds the same colour.
 *
 * A colour that is not in the palette would be dithered by GDI on a 256-colour screen; the engine
 * uses the nearest entry instead (static entries winning ties). This never happens on the disc.
 */
export function paletteIndexOf(palette: Uint8Array, colour: Rgb): number {
  let best = 0;
  let bestDistance = Infinity;
  const consider = (index: number): void => {
    const dr = palette[index * 3]! - colour.red;
    const dg = palette[index * 3 + 1]! - colour.green;
    const db = palette[index * 3 + 2]! - colour.blue;
    const distance = dr * dr + dg * dg + db * db;
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  };
  for (const index of STATIC_INDICES) consider(index);
  for (let index = 10; index <= 245 && bestDistance > 0; index++) consider(index);
  return best;
}
