import type { RgbImage } from '@twtw/node';
import { describe, expect, it } from 'vitest';
import { boundingBoxes, diffImages, diffPicture, PixelClass, type Mask } from './diff.ts';

/** A `width × height` RGB image of one colour (`0xRRGGBB`). */
function solid(width: number, height: number, colour: number): RgbImage {
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++)
    rgb.set([colour >> 16, (colour >> 8) & 0xff, colour & 0xff], i * 3);
  return { width, height, rgb };
}

function setPixel(image: RgbImage, x: number, y: number, colour: number): void {
  image.rgb.set([colour >> 16, (colour >> 8) & 0xff, colour & 0xff], (y * image.width + x) * 3);
}

const rect = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom });

describe('diffImages', () => {
  it('finds no difference between equal images', () => {
    const result = diffImages(solid(4, 3, 0x123456), solid(4, 3, 0x123456), 4, 3, []);
    expect(result).toMatchObject({ differing: 0, unexplained: 0, byReason: {} });
    expect(result.classes.every((cls) => cls === PixelClass.same)).toBe(true);
  });

  it('explains a difference by the first mask that covers it, and leaves the rest unexplained', () => {
    const ours = solid(6, 4, 0);
    const reference = solid(6, 4, 0);
    setPixel(reference, 1, 1, 0xffffff);
    setPixel(reference, 4, 2, 0xffffff);
    setPixel(reference, 5, 3, 0xffffff);
    const masks: Mask[] = [
      { reason: 'azLamp', rect: rect(0, 0, 3, 3), detail: 'first' },
      { reason: 'referenceChanging', rect: rect(0, 0, 5, 3), detail: 'second' },
    ];
    const result = diffImages(ours, reference, 6, 4, masks);
    expect(result).toMatchObject({
      differing: 3,
      unexplained: 1,
      byReason: { azLamp: 1, referenceChanging: 1 },
    });
    expect(result.classes[1 * 6 + 1]).toBe(PixelClass.explained);
    expect(result.classes[3 * 6 + 5]).toBe(PixelClass.unexplained);
  });

  it("applies a mask only where the reference shows one of the mask's colours", () => {
    const reference = solid(3, 1, 0x9e9e9e);
    setPixel(reference, 2, 0, 0x123456);
    const mask: Mask = {
      reason: 'wineCaptionColour',
      rect: rect(0, 0, 3, 1),
      detail: '',
      referenceColours: [0x9e9e9e],
    };
    expect(diffImages(solid(3, 1, 0), reference, 3, 1, [mask])).toMatchObject({
      differing: 3,
      unexplained: 1,
    });
  });

  it('asks a per-pixel mask whether it accepts the reference colour at that position', () => {
    const reference = solid(3, 1, 0xff0000);
    const mask: Mask = {
      reason: 'wineAnimationStall',
      rect: rect(0, 0, 3, 1),
      detail: '',
      accepts: (x, _y, colour) => x !== 1 && colour === 0xff0000,
    };
    const result = diffImages(solid(3, 1, 0), reference, 3, 1, [mask]);
    expect(result).toMatchObject({ differing: 3, unexplained: 1, byReason: { wineAnimationStall: 2 } });
  });

  it('compares only the given area, with images of different widths', () => {
    const ours = solid(8, 4, 0);
    const reference = solid(5, 3, 0);
    setPixel(reference, 4, 2, 0xffffff);
    expect(diffImages(ours, reference, 4, 2, []).differing).toBe(0);
    expect(diffImages(ours, reference, 5, 3, []).differing).toBe(1);
    expect(() => diffImages(ours, reference, 6, 3, [])).toThrow(/exceeds/);
  });
});

describe('boundingBoxes', () => {
  /** Classes for a `width × height` area with `cls` at the given points. */
  function marked(width: number, height: number, points: readonly (readonly [number, number])[]): Uint8Array {
    const classes = new Uint8Array(width * height);
    for (const [x, y] of points) classes[y * width + x] = PixelClass.unexplained;
    return classes;
  }

  it('groups nearby pixels into one box per cluster, largest first', () => {
    const classes = marked(40, 20, [
      [1, 1],
      [3, 2],
      [30, 10],
      [31, 13],
    ]);
    expect(boundingBoxes(classes, 40, 20, PixelClass.unexplained, 3)).toEqual([
      rect(30, 10, 32, 14),
      rect(1, 1, 4, 3),
    ]);
    expect(boundingBoxes(classes, 40, 20, PixelClass.explained)).toEqual([]);
  });

  it('keeps pixels further apart than the gap separate', () => {
    const classes = marked(20, 1, [
      [0, 0],
      [5, 0],
    ]);
    expect(boundingBoxes(classes, 20, 1, PixelClass.unexplained, 3)).toHaveLength(2);
    expect(boundingBoxes(classes, 20, 1, PixelClass.unexplained, 5)).toEqual([rect(0, 0, 6, 1)]);
  });

  it('merges the closest boxes until they fit the limit', () => {
    const points = Array.from({ length: 10 }, (_, i) => [i * 10, 0] as const);
    const boxes = boundingBoxes(marked(100, 1, points), 100, 1, PixelClass.unexplained, 1, 3);
    expect(boxes).toHaveLength(3);
    expect(Math.min(...boxes.map((box) => box.left))).toBe(0);
    expect(Math.max(...boxes.map((box) => box.right))).toBe(91);
  });

  it('coarsens many scattered boxes quickly', () => {
    const points: [number, number][] = [];
    for (let y = 0; y < 200; y += 4) for (let x = 0; x < 200; x += 4) points.push([x, y]);
    const boxes = boundingBoxes(marked(200, 200, points), 200, 200, PixelClass.unexplained, 1, 12);
    expect(boxes.length).toBeLessThanOrEqual(12);
  });
});

describe('diffPicture', () => {
  it('marks unexplained pixels red, explained orange, and tints masked areas', () => {
    const reference = solid(3, 2, 0x808080);
    const result = {
      width: 3,
      height: 2,
      differing: 2,
      unexplained: 1,
      byReason: {},
      classes: Uint8Array.of(PixelClass.unexplained, PixelClass.explained, 0, 0, 0, 0),
    };
    const picture = diffPicture(reference, result, [
      { reason: 'azLamp', rect: rect(0, 1, 1, 2), detail: '' },
    ]);
    const at = (x: number, y: number) => [...picture.rgb.subarray((y * 3 + x) * 3, (y * 3 + x) * 3 + 3)];
    expect(at(0, 0)).toEqual([255, 0, 64]);
    expect(at(1, 0)).toEqual([255, 170, 0]);
    const plain = at(1, 1);
    const tinted = at(0, 1);
    expect(plain[0]).toBe(plain[2]); // grey
    expect(tinted[2]!).toBeGreaterThan(tinted[0]!); // blue tint
  });
});
