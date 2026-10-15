import { CURSOR_PIXEL, type CursorImage } from '@twtw/engine';
import { describe, expect, it } from 'vitest';
import { cursorRgba } from '../src/cursor-pixels.ts';
import {
  CLIENT_AREA,
  clientToFramebuffer,
  computeLayout,
  cursorScale,
  describeLayout,
  FRAMEBUFFER_AREA,
  isPortraitPhone,
  PRESENTED_AREA,
} from '../src/stage.ts';

describe('computeLayout (PLAN §3, "Scaling rules")', () => {
  it('presents the 638×459 client area by default', () => {
    expect(PRESENTED_AREA).toEqual({ x: 0, y: 0, width: 638, height: 459 });
    expect(PRESENTED_AREA).toBe(CLIENT_AREA);
  });

  it.each([
    // [backing width, height, k]: devices in device pixels.
    [1920, 1080, 2], // 1080p monitor
    [1366, 768, 1], // small laptop
    [2048, 1536, 3], // iPad (1024×768 @2)
    [2532, 1170, 2], // phone in landscape (844×390 @3)
    [3840, 2160, 4], // 4K monitor
    [638, 459, 1], // exactly native
  ])('picks the largest integer scale that fits %i×%i: %i×', (width, height, k) => {
    const layout = computeLayout(width, height);
    expect(layout.fit).toBe('integer');
    expect(layout.scale).toBe(k);
    expect([layout.width, layout.height]).toEqual([638 * k, 459 * k]);
  });

  it('centres the picture, letterboxed, on whole device pixels', () => {
    const layout = computeLayout(1920, 1080);
    expect([layout.offsetX, layout.offsetY]).toEqual([(1920 - 1276) / 2, Math.floor((1080 - 918) / 2)]);
    const odd = computeLayout(1277, 919);
    expect([odd.offsetX, odd.offsetY]).toEqual([0, 0]);
  });

  it('shrinks below 1× with the largest scale that fits, noted as such', () => {
    const layout = computeLayout(480, 400);
    expect(layout.fit).toBe('shrink');
    expect(layout.scale).toBeCloseTo(480 / 638);
    expect(layout.width).toBe(480);
    expect(layout.height).toBe(Math.floor(459 * (480 / 638)));
    expect(describeLayout(layout, 1)).toMatch(/BELOW NATIVE/);
  });

  it('fills as much as fits in fill mode, and stays integer when that is exact', () => {
    const layout = computeLayout(1920, 1080, 'fill');
    expect(layout.fit).toBe('fill');
    expect(layout.scale).toBeCloseTo(1080 / 459);
    expect(layout.height).toBe(1080);
    expect(computeLayout(1276, 918, 'fill')).toMatchObject({ fit: 'integer', scale: 2 });
  });

  it('can present the full 640×480 framebuffer instead', () => {
    const layout = computeLayout(1920, 1080, 'integer', FRAMEBUFFER_AREA);
    expect([layout.scale, layout.width, layout.height]).toEqual([2, 1280, 960]);
  });
});

describe('clientToFramebuffer', () => {
  it('maps a canvas shown at 1× pixel for pixel', () => {
    const layout = computeLayout(638, 459);
    const box = { left: 100, top: 50, width: 638, height: 459 };
    expect(clientToFramebuffer(layout, box, 100, 50)).toEqual({ x: 0, y: 0, inside: true });
    expect(clientToFramebuffer(layout, box, 737.9, 508.5)).toEqual({ x: 637, y: 458, inside: true });
    expect(clientToFramebuffer(layout, box, 99, 49)).toEqual({ x: -1, y: -1, inside: false });
    expect(clientToFramebuffer(layout, box, 738, 100).inside).toBe(false);
  });

  it('goes through the backing store, the letterbox offset and the integer scale', () => {
    // A 1600×1000 backing store shown in 800×500 CSS pixels (DPR 2): 638×459 at 2× from (162, 41).
    const layout = computeLayout(1600, 1000);
    expect([layout.scale, layout.offsetX, layout.offsetY]).toEqual([2, 162, 41]);
    const css = { left: 0, top: 0, width: 800, height: 500 };
    expect(clientToFramebuffer(layout, css, 81, 20.5)).toEqual({ x: 0, y: 0, inside: true });
    expect(clientToFramebuffer(layout, css, 81.9, 21.4)).toEqual({ x: 0, y: 0, inside: true });
    expect(clientToFramebuffer(layout, css, 82, 21.5)).toEqual({ x: 1, y: 1, inside: true });
    expect(clientToFramebuffer(layout, css, 80.5, 30)).toMatchObject({ x: -1, inside: false });
  });

  it('maps through a fractional scale to the pixel drawn there', () => {
    const layout = computeLayout(1000, 700, 'fill');
    const css = { left: 0, top: 0, width: 1000, height: 700 };
    // The last device pixel of the picture shows the last framebuffer pixel.
    const last = clientToFramebuffer(
      layout,
      css,
      layout.offsetX + layout.width - 0.5,
      layout.offsetY + layout.height - 0.5,
    );
    expect(last).toEqual({ x: 637, y: 458, inside: true });
  });
});

describe('cursorScale', () => {
  it('matches the stage scale in CSS pixels, from 1 to 4', () => {
    expect(cursorScale(computeLayout(1920, 1080), 1)).toBe(2);
    expect(cursorScale(computeLayout(2048, 1536), 2)).toBe(2);
    expect(cursorScale(computeLayout(1366, 768), 1)).toBe(1);
    expect(cursorScale(computeLayout(480, 320), 1)).toBe(1);
    expect(cursorScale(computeLayout(7680, 4320), 1)).toBe(4);
  });
});

describe('isPortraitPhone', () => {
  it('is true for phones held upright only', () => {
    expect(isPortraitPhone(390, 844)).toBe(true);
    expect(isPortraitPhone(844, 390)).toBe(false); // the same phone sideways
    expect(isPortraitPhone(768, 1024)).toBe(false); // a tablet upright still shows the stage
    expect(isPortraitPhone(1920, 1080)).toBe(false);
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
