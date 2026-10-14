import { describe, expect, it } from 'vitest';
import { IndexedCanvas } from './canvas.ts';

function image(width: number, height: number, fill: (x: number, y: number) => number = () => 0) {
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels[y * width + x] = fill(x, y);
  return { width, height, pixels };
}

function rows(target: { width: number; pixels: Uint8Array }): number[][] {
  const out: number[][] = [];
  for (let at = 0; at < target.pixels.length; at += target.width)
    out.push([...target.pixels.subarray(at, at + target.width)]);
  return out;
}

describe('IndexedCanvas', () => {
  const picture = image(3, 2, (x, y) => 10 * (y + 1) + x); // 10 11 12 / 20 21 22

  it('copies a picture, clipped to the image', () => {
    const target = image(4, 3);
    new IndexedCanvas(target).draw(picture, 2, -1);
    expect(rows(target)).toEqual([
      [0, 0, 20, 21],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
  });

  it('clips views to their rectangle and translates their origin', () => {
    const target = image(5, 4);
    const view = new IndexedCanvas(target).view(1, 1, 3, 2);
    view.fill(-5, -5, 50, 50, 7);
    view.draw(picture, -1, 1);
    expect(rows(target)).toEqual([
      [0, 0, 0, 0, 0],
      [0, 7, 7, 7, 0],
      [0, 11, 12, 7, 0],
      [0, 0, 0, 0, 0],
    ]);
  });

  it('copies a source rectangle, clipped to the picture', () => {
    const target = image(4, 2);
    new IndexedCanvas(target).draw(picture, 0, 0, 1, 1, 10, 10);
    expect(rows(target)).toEqual([
      [21, 22, 0, 0],
      [0, 0, 0, 0],
    ]);
  });

  it('maps pixels with image coordinates', () => {
    const target = image(3, 2, () => 5);
    new IndexedCanvas(target).view(1, 0, 2, 2).map(0, 0, 9, 9, (index, x, y) => index + 10 * x + y);
    expect(rows(target)).toEqual([
      [5, 15, 25],
      [5, 16, 26],
    ]);
  });
});
