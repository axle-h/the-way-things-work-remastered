// The original's mouse cursors as CSS cursors (behaviour.md §8, program.md "Cursors"): the arrow
// and the hand from TWTW.EXE, scaled with nearest neighbour, with Windows-like fallbacks.
import { readProgramCursors, type CursorName, type DiscContent } from '@twtw/engine';
import { cursorRgba } from './cursor-pixels.ts';

/** CSS fallbacks when a cursor image is missing or cannot be used. */
export const FALLBACK_CURSORS: Readonly<Record<CursorName, string>> = {
  arrow: 'default',
  hand: 'pointer',
  wait: 'wait',
};

/**
 * The CSS `cursor` value for each cursor name: the program's cursor images as PNG data URLs with
 * their hotspots, at `scale` (the stage's integer scale), falling back to the browser's own.
 */
export function buildCursorStyles(content: DiscContent, scale = 1): Record<CursorName, string> {
  const styles: Record<CursorName, string> = { ...FALLBACK_CURSORS };
  let cursors: ReturnType<typeof readProgramCursors>;
  try {
    cursors = readProgramCursors(content.program);
  } catch (error) {
    console.warn('cursors: using the browser defaults', error);
    return styles;
  }
  for (const name of ['arrow', 'hand'] as const) {
    const image = cursors[name];
    if (image === undefined) continue;
    const url = toDataUrl(cursorRgba(image, scale));
    if (url !== null) {
      styles[name] =
        `url(${url}) ${image.hotspotX * scale} ${image.hotspotY * scale}, ${FALLBACK_CURSORS[name]}`;
    }
  }
  return styles;
}

function toDataUrl({
  width,
  height,
  rgba,
}: {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}): string | null {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (context === null) return null;
  context.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
  return canvas.toDataURL('image/png');
}
