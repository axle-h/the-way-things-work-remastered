import { describe, expect, it } from 'vitest';
import {
  invertOutline,
  visibleZoomRectangles,
  ZOOM_CLOSE_PERCENTAGES,
  ZOOM_DURATION_MS,
  ZOOM_OPEN_PERCENTAGES,
  zoomRectangles,
} from './zoom.ts';

describe('zoomRectangles (behaviour.md §4.2)', () => {
  const window = { left: 100, top: 200, right: 300, bottom: 400 };

  it('runs from the bare point to the window rectangle', () => {
    const rects = zoomRectangles({ x: 10, y: 20 }, window, ZOOM_OPEN_PERCENTAGES);
    expect(rects).toHaveLength(10);
    expect(rects[0]).toEqual({ left: 10, top: 20, right: 10, bottom: 20 });
    expect(rects[9]).toEqual(window);
    // p = 50: 10 × 50 / 100 + 100 × 50 / 100 = 55; 20 / 2 + 400 / 2 = 210.
    expect(rects[7]).toEqual({ left: 55, top: 110, right: 155, bottom: 210 });
    // p = 17: trunc(10 × 83 / 100) + trunc(300 × 17 / 100) = 8 + 51.
    expect(rects[4]!.right).toBe(59);
  });

  it('truncates each product toward zero separately', () => {
    // trunc(−3 × 50 / 100) = −1, not −2; trunc(5 × 50 / 100) = 2.
    const half = zoomRectangles(
      { x: -3, y: -3 },
      { left: 5, top: 5, right: 5, bottom: 5 },
      ZOOM_OPEN_PERCENTAGES,
    )[7];
    expect(half).toEqual({ left: 1, top: 1, right: 1, bottom: 1 });
  });

  it('closes in reverse, fast first', () => {
    const open = zoomRectangles({ x: 10, y: 20 }, window, ZOOM_OPEN_PERCENTAGES);
    const close = zoomRectangles({ x: 10, y: 20 }, window, ZOOM_CLOSE_PERCENTAGES);
    expect(close).toEqual([...open].reverse());
  });
});

describe('visibleZoomRectangles', () => {
  it('shows up to three outlines, one step every 50 ms, for 550 ms', () => {
    expect(visibleZoomRectangles(0)).toEqual([0]);
    expect(visibleZoomRectangles(50)).toEqual([0, 1]);
    expect(visibleZoomRectangles(149)).toEqual([0, 1, 2]);
    expect(visibleZoomRectangles(150)).toEqual([1, 2, 3]);
    expect(visibleZoomRectangles(450)).toEqual([7, 8, 9]);
    expect(visibleZoomRectangles(500)).toEqual([8, 9]);
    expect(visibleZoomRectangles(549)).toEqual([8, 9]);
    expect(ZOOM_DURATION_MS).toBe(550);
    expect(visibleZoomRectangles(550)).toEqual([]);
    expect(visibleZoomRectangles(-1)).toEqual([]);
  });
});

describe('invertOutline', () => {
  const image = () => ({ width: 6, height: 5, pixels: new Uint8Array(30).fill(10) });
  const grid = (img: { pixels: Uint8Array }): string[] =>
    Array.from({ length: 5 }, (_, y) =>
      [...img.pixels.subarray(y * 6, y * 6 + 6)].map((v) => (v === 10 ? '.' : '#')).join(''),
    );
  const blank = ['......', '......', '......', '......', '......'];

  it('inverts each pixel of the outline once, edges included', () => {
    const img = image();
    invertOutline(img, { left: 1, top: 1, right: 4, bottom: 3 });
    expect(grid(img)).toEqual(['......', '.####.', '.#..#.', '.####.', '......']);
    expect(img.pixels[7]).toBe(245);
    invertOutline(img, { left: 1, top: 1, right: 4, bottom: 3 });
    expect(grid(img)).toEqual(blank);
  });

  it('draws nothing for a point; a line is inverted at its ends only', () => {
    const img = image();
    invertOutline(img, { left: 2, top: 2, right: 2, bottom: 2 });
    expect(grid(img)).toEqual(blank);
    invertOutline(img, { left: 2, top: 1, right: 2, bottom: 3 });
    expect(grid(img)).toEqual(['......', '..#...', '......', '..#...', '......']);
  });

  it('applies an offset and clips to the image', () => {
    const img = image();
    invertOutline(img, { left: 3, top: 3, right: 10, bottom: 10 }, { x: 1, y: 1 });
    expect(grid(img)).toEqual(['......', '......', '..####', '..#...', '..#...']);
  });
});
