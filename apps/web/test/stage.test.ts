import { CURSOR_PIXEL, type CursorImage } from '@twtw/engine';
import { describe, expect, it } from 'vitest';
import { cursorRgba } from '../src/cursor-pixels.ts';
import { clientToFramebuffer, nativeLayout } from '../src/stage.ts';

describe('clientToFramebuffer', () => {
  const box = { left: 100, top: 50, width: 640, height: 480 };

  it('maps a canvas shown at 1× pixel for pixel', () => {
    const layout = nativeLayout(640, 480);
    expect(clientToFramebuffer(layout, box, 100, 50)).toEqual({ x: 0, y: 0 });
    expect(clientToFramebuffer(layout, box, 739.9, 529.5)).toEqual({ x: 639, y: 479 });
    expect(clientToFramebuffer(layout, box, 99, 49)).toEqual({ x: -1, y: -1 });
  });

  it('goes through the backing store, the letterbox offset and the integer scale', () => {
    // A 1600×1000 backing store shown in 800×500 CSS pixels (DPR 2), the frame at 2× from (320, 20).
    const layout = { backingWidth: 1600, backingHeight: 1000, scale: 2, offsetX: 320, offsetY: 20 };
    const css = { left: 0, top: 0, width: 800, height: 500 };
    expect(clientToFramebuffer(layout, css, 160, 10)).toEqual({ x: 0, y: 0 });
    expect(clientToFramebuffer(layout, css, 160.9, 10.9)).toEqual({ x: 0, y: 0 });
    expect(clientToFramebuffer(layout, css, 161, 11)).toEqual({ x: 1, y: 1 });
    expect(clientToFramebuffer(layout, css, 159.5, 10)).toEqual({ x: -1, y: 0 });
  });
});

describe('cursorRgba', () => {
  const image: CursorImage = {
    width: 2,
    height: 2,
    hotspotX: 1,
    hotspotY: 0,
    pixels: Uint8Array.of(
      CURSOR_PIXEL.black,
      CURSOR_PIXEL.white,
      CURSOR_PIXEL.transparent,
      CURSOR_PIXEL.invert,
    ),
    colors: Uint8Array.of(0, 0, 0, 255, 255, 255),
    infoHeader: {} as CursorImage['infoHeader'],
  };

  it('turns cursor pixels into RGBA, inverted pixels black', () => {
    const { width, height, rgba } = cursorRgba(image);
    expect([width, height]).toEqual([2, 2]);
    expect([...rgba]).toEqual([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 0, 0, 0, 0, 255]);
  });

  it('scales with nearest neighbour', () => {
    const { width, rgba } = cursorRgba(image, 2);
    expect(width).toBe(4);
    const alpha = (x: number, y: number) => rgba[(y * 4 + x) * 4 + 3];
    expect([alpha(0, 0), alpha(1, 1), alpha(0, 2), alpha(1, 3), alpha(3, 3)]).toEqual([255, 255, 0, 0, 255]);
  });
});
