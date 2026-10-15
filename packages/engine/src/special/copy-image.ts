/**
 * The picture that the Options popup's "copy" and "print" produce (special-screens.md §4.4): the
 * target page's panels painted at rest into a picture of the page's content size, extended by a
 * 40-row white band holding the copyright line, centred, in black. The presenter puts it on the
 * clipboard or prints it; this builds it as an indexed image.
 */
import { StaticColour } from '../colours.ts';
import type { PageInstance } from '../page.ts';
import { IndexedCanvas } from '../render/canvas.ts';
import { paintPage } from '../render/paint.ts';
import type { IndexedImage } from '../screen.ts';
import { drawText, textWidth, type BitmapFont, type TextStyle } from '../text/font.ts';
import { SERIF_FONT } from '../text/serif-font.ts';

/** Rows added below the page's picture for the caption. */
export const COPY_BAND_HEIGHT = 40;

/**
 * Builds the copied or printed picture of a page: W × (H + 40) for a page of content size W × H
 * (638×499 for a base page). Animation frames, the A–Z lamp, pressed buttons and the Index
 * controls are not part of it (they are not painted by the panels).
 *
 * The caption is drawn with the engine's own font, an approximation of the original's (the
 * System font, or a font scaled to the width when the picture is narrower than the text): in
 * bold if it fits, else regular, else squeezed to the picture's width by dropping columns.
 */
export function buildCopyImage(
  page: PageInstance,
  caption: string | null,
  font: BitmapFont = SERIF_FONT,
): IndexedImage {
  const width = page.width;
  const height = page.height + COPY_BAND_HEIGHT;
  const image: IndexedImage = { width, height, pixels: new Uint8Array(width * height) };
  const canvas = new IndexedCanvas(image);
  paintPage(canvas.view(0, 0, page.width, page.height), page, { atRest: true });
  canvas.fill(0, page.height, width, COPY_BAND_HEIGHT, StaticColour.white);
  if (caption !== null && caption !== '') drawCaption(canvas, font, caption, page.height, width);
  return image;
}

/** The caption, centred in the band (special-screens.md §4.4). */
function drawCaption(
  canvas: IndexedCanvas,
  font: BitmapFont,
  text: string,
  bandTop: number,
  width: number,
): void {
  const y = bandTop + Math.floor((COPY_BAND_HEIGHT - font.height) / 2);
  for (const style of [{ bold: true }, {}] satisfies TextStyle[]) {
    const textW = textWidth(font, text, style);
    if (textW <= width) {
      drawText(canvas, font, text, Math.floor((width - textW) / 2), y, StaticColour.black, style);
      return;
    }
  }
  // Too wide even in regular weight: draw it off-screen and squeeze it to the picture's width.
  const textW = textWidth(font, text);
  const strip: IndexedImage = {
    width: textW,
    height: font.height,
    pixels: new Uint8Array(textW * font.height),
  };
  drawText(new IndexedCanvas(strip), font, text, 0, 0, 1);
  for (let row = 0; row < font.height; row++) {
    for (let column = 0; column < width; column++) {
      if (strip.pixels[row * textW + Math.floor((column * textW) / width)] === 1) {
        canvas.fill(column, y + row, 1, 1, StaticColour.black);
      }
    }
  }
}
