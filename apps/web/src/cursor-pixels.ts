// Cursor images as RGBA (DOM-free, so the conversion is testable in Node).
import { CURSOR_PIXEL, type CursorImage } from '@twtw/engine';

/**
 * A cursor's pixels as RGBA, scaled by an integer factor with nearest neighbour. Black and white
 * stay; transparent pixels are transparent; "invert the screen" pixels, which CSS cannot show,
 * become black (the arrow and the hand on the disc have none).
 */
export function cursorRgba(
  image: CursorImage,
  scale = 1,
): { width: number; height: number; rgba: Uint8ClampedArray } {
  const width = image.width * scale;
  const height = image.height * scale;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = image.pixels[Math.floor(y / scale) * image.width + Math.floor(x / scale)];
      if (pixel === CURSOR_PIXEL.transparent) continue;
      const at = (y * width + x) * 4;
      const value = pixel === CURSOR_PIXEL.white ? 255 : 0;
      rgba[at] = value;
      rgba[at + 1] = value;
      rgba[at + 2] = value;
      rgba[at + 3] = 255;
    }
  }
  return { width, height, rgba };
}
