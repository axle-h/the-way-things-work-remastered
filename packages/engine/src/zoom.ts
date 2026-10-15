/**
 * The zoom effect of OpenPage flag 1 (behaviour.md §4.2): ten rectangle outlines interpolated
 * between a point and a popup window's rectangle, drawn with an inverting pen over everything,
 * one step every 50 ms.
 */
import type { Point } from '@twtw/formats';
import type { Box } from './render/canvas.ts';
import type { IndexedImage } from './screen.ts';

/** Percentages of the way from the point to the window, opening: slow start, fast finish. */
export const ZOOM_OPEN_PERCENTAGES: readonly number[] = [0, 1, 3, 10, 17, 25, 33, 50, 70, 100];
/** Closing runs from the window back to the point: fast start, slow finish. */
export const ZOOM_CLOSE_PERCENTAGES: readonly number[] = [100, 70, 50, 33, 25, 17, 10, 3, 1, 0];

/** One step every 50 ms; rectangle *s* is drawn at step *s* and erased at step *s* + 3. */
export const ZOOM_STEP_MS = 50;
/** Steps 0–11; rectangle 9 is erased straight after step 11, so the effect lasts 550 ms. */
export const ZOOM_DURATION_MS = 11 * ZOOM_STEP_MS;

/**
 * The ten outlines from `point` towards `window` (edges as Windows gives a window rectangle),
 * in the same coordinates as their inputs (screen coordinates in the original). Each edge is
 * `point × (100 − p) / 100 + edge × p / 100`, each product truncated toward zero separately.
 */
export function zoomRectangles(point: Point, window: Box, percentages: readonly number[]): Box[] {
  const mix = (from: number, to: number, p: number): number =>
    Math.trunc((from * (100 - p)) / 100) + Math.trunc((to * p) / 100);
  return percentages.map((p) => ({
    left: mix(point.x, window.left, p),
    top: mix(point.y, window.top, p),
    right: mix(point.x, window.right, p),
    bottom: mix(point.y, window.bottom, p),
  }));
}

/**
 * Indices of the outlines on screen `elapsed` ms after the effect started: up to three at a time,
 * none once it has ended.
 */
export function visibleZoomRectangles(elapsed: number): number[] {
  if (elapsed < 0 || elapsed >= ZOOM_DURATION_MS) return [];
  const step = Math.floor(elapsed / ZOOM_STEP_MS);
  const visible: number[] = [];
  for (let index = Math.max(0, step - 2); index <= Math.min(step, 9); index++) visible.push(index);
  return visible;
}

/**
 * Inverts (index *v* becomes 255 − *v*) the outline of `rect` in `image`: four one-pixel lines,
 * (left, top) → (right, top) → (right, bottom) → (left, bottom) → (left, top), each leaving out
 * its end pixel. `offset` is subtracted from the coordinates first (screen to image); pixels
 * outside the image are skipped. Inverting the same outline again restores the pixels.
 */
export function invertOutline(image: IndexedImage, rect: Box, offset: Point = { x: 0, y: 0 }): void {
  const left = rect.left - offset.x;
  const top = rect.top - offset.y;
  const right = rect.right - offset.x;
  const bottom = rect.bottom - offset.y;
  const invert = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= image.width || y >= image.height) return;
    const at = y * image.width + x;
    image.pixels[at] = 255 - image.pixels[at]!;
  };
  const line = (x0: number, y0: number, x1: number, y1: number): void => {
    // Only horizontal and vertical lines occur.
    const dx = Math.sign(x1 - x0);
    const dy = Math.sign(y1 - y0);
    for (let x = x0, y = y0; x !== x1 || y !== y1; x += dx, y += dy) invert(x, y);
  };
  line(left, top, right, top);
  line(right, top, right, bottom);
  line(right, bottom, left, bottom);
  line(left, bottom, left, top);
}
