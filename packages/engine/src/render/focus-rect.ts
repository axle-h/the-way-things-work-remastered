/**
 * The dotted rectangle that follows the mouse while a popup is dragged by its caption strip
 * (behaviour.md §5). Windows draws it with `DrawFocusRect`, an XOR of a 50% checkerboard; in
 * palette indices the engine inverts every other pixel of the one-pixel frame (index *v* becomes
 * 255 − *v*), aligned to the screen [H: the exact pixels are Windows' and unverified].
 */
import type { Point } from '@twtw/formats';
import type { IndexedImage } from '../screen.ts';

/**
 * Inverts the dotted frame of the rectangle (left, top, width, height) in image coordinates.
 * `screenOrigin` is where image (0,0) is on the screen: pixels whose screen x + y is even are
 * inverted.
 */
export function invertFocusRect(
  image: IndexedImage,
  left: number,
  top: number,
  width: number,
  height: number,
  screenOrigin: Point = { x: 0, y: 0 },
): void {
  if (width <= 0 || height <= 0) return;
  const right = left + width - 1;
  const bottom = top + height - 1;
  const invert = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= image.width || y >= image.height) return;
    if ((x + screenOrigin.x + y + screenOrigin.y) % 2 !== 0) return;
    const at = y * image.width + x;
    image.pixels[at] = 255 - image.pixels[at]!;
  };
  for (let x = left; x <= right; x++) {
    invert(x, top);
    if (bottom !== top) invert(x, bottom);
  }
  for (let y = top + 1; y < bottom; y++) {
    invert(left, y);
    if (right !== left) invert(right, y);
  }
}
