import { describe, expect, it } from 'vitest';
import {
  COPY_SCALE,
  PRINT_MARGIN_MM,
  PRINT_PLACEMENT,
  PRINT_SCALE,
  printedSize,
  previewScale,
  printLayout,
} from '../src/print-layout.ts';

describe('printedSize', () => {
  it('prints a full screen at the scale at which 640 × 520 fits the sheet', () => {
    // Portrait: the width decides (2400 / 640); landscape: the height (2400 / 520).
    expect(printedSize(640, 520, 2400, 3200)).toEqual({ width: 2400, height: 1950 });
    const landscape = printedSize(640, 520, 3200, 2400);
    expect(landscape.width).toBeCloseTo((2400 * 640) / 520, 9);
    expect(landscape.height).toBeCloseTo(2400, 9);
  });

  it('prints a popup at the same scale as a full screen: W/640 of its width', () => {
    expect(printedSize(287, 370, 2400, 3200)).toEqual({ width: 1076.25, height: 1387.5 });
  });

  it('always fits the sheet', () => {
    for (const [width, height] of [
      [638, 499],
      [287, 370],
      [560, 450],
      [640, 520],
    ] as const) {
      for (const [pageWidth, pageHeight] of [
        [277, 190],
        [190, 277],
        [100, 100],
      ] as const) {
        const size = printedSize(width, height, pageWidth, pageHeight);
        expect(size.width).toBeLessThanOrEqual(pageWidth + 1e-9);
        expect(size.height).toBeLessThanOrEqual(pageHeight + 1e-9);
      }
    }
  });
});

describe('printLayout', () => {
  it('prints wide pictures in landscape and tall ones in portrait, with the margin', () => {
    expect(printLayout(638, 499).orientation).toBe('landscape');
    expect(printLayout(287, 370).orientation).toBe('portrait');
    expect(printLayout(638, 499).pageRule).toBe(`@page { size: landscape; margin: ${PRINT_MARGIN_MM}mm; }`);
  });

  it('sizes the picture by the smaller of the two scales, in page width and page height', () => {
    expect(printLayout(638, 499).imageWidth).toBe('min(99.6875%, 122.6923vh)');
    expect(printLayout(287, 370).imageWidth).toBe('min(44.8438%, 55.1923vh)');
  });

  /** The CSS width resolved on a printable area, as the browser does it. */
  const cssWidth = (width: number, height: number, pageWidth: number, pageHeight: number): number => {
    const [, byWidth, byHeight] = /min\(([\d.]+)%, ([\d.]+)vh\)/.exec(printLayout(width, height).imageWidth)!;
    return Math.min((Number(byWidth) * pageWidth) / 100, (Number(byHeight) * pageHeight) / 100);
  };

  it.each([
    ['A4 landscape', 277, 190],
    ['A4 portrait', 190, 277],
    ['Letter landscape', 259.4, 195.9],
    ['Letter portrait', 195.9, 259.4],
  ])('resolves to printedSize on %s', (_, pageWidth, pageHeight) => {
    for (const [width, height] of [
      [638, 499],
      [287, 370],
      [560, 450],
    ] as const) {
      const printed = cssWidth(width, height, pageWidth, pageHeight);
      expect(printed).toBeCloseTo(printedSize(width, height, pageWidth, pageHeight).width, 2);
      expect((printed * height) / width).toBeLessThanOrEqual(pageHeight + 0.01);
    }
  });

  it('centres the picture by default (Alex’s choice); the original placed it top-left', () => {
    expect(PRINT_PLACEMENT).toBe('centred');
    expect(printLayout(638, 499).placement).toBe('centred');
    expect(printLayout(638, 499, 'top-left').placement).toBe('top-left');
  });

  it('copies at 2× and prints at 4×', () => {
    expect([COPY_SCALE, PRINT_SCALE]).toEqual([2, 4]);
  });
});

describe('previewScale', () => {
  it('shows the copy fallback picture at the largest whole scale that fits', () => {
    expect(previewScale(638, 499, 1900, 1000)).toBe(2);
    expect(previewScale(638, 499, 1276, 998)).toBe(2);
    expect(previewScale(638, 499, 1275, 998)).toBe(1);
  });

  it('shrinks it below 1× only when it does not fit at all', () => {
    expect(previewScale(638, 499, 319, 600)).toBe(0.5);
    expect(previewScale(638, 499, 0, 600)).toBe(0);
  });
});
