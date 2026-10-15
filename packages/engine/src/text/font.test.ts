import { describe, expect, it } from 'vitest';
import { IndexedCanvas } from '../render/canvas.ts';
import { drawText, parseGlyphTable, textOffsets, textWidth } from './font.ts';
import { SERIF_FONT } from './serif-font.ts';

/** The rows a glyph has ink in. */
function inkRows(char: string): number[] {
  const { width, pixels } = SERIF_FONT.glyph(char);
  const rows: number[] = [];
  for (let row = 0; row < SERIF_FONT.height; row++) {
    if (pixels.subarray(row * width, (row + 1) * width).includes(1)) rows.push(row);
  }
  return rows;
}

describe('the serif font (MS Serif 8 point metrics)', () => {
  it('has a 13-pixel cell with the baseline 11 rows down', () => {
    expect([SERIF_FONT.height, SERIF_FONT.ascent]).toEqual([13, 11]);
  });

  it('has a glyph of its own for every printable ASCII character', () => {
    const fallback = SERIF_FONT.glyph('?');
    for (let code = 0x20; code < 0x7f; code++) {
      const char = String.fromCharCode(code);
      if (char !== '?') expect(SERIF_FONT.glyph(char), char).not.toBe(fallback);
    }
    expect(SERIF_FONT.glyph('\u0001')).toBe(fallback);
  });

  it('puts capitals on rows 3–10, lowercase from row 5, descenders to row 12', () => {
    for (const char of 'EHT') expect(inkRows(char)).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
    expect(inkRows('x')).toEqual([5, 6, 7, 8, 9, 10]);
    expect(Math.max(...inkRows('g'))).toBe(12);
    expect(Math.max(...inkRows('p'))).toBe(12);
  });

  it('draws the soft hyphen as a dash one row lower than the hyphen', () => {
    expect(inkRows('\u00ad')).toEqual([inkRows('-')[0]! + 1]);
  });

  it('composes the accented letters of the index names and others', () => {
    for (const [accented, base] of [
      ['é', 'e'],
      ['ö', 'o'],
      ['Ö', 'O'],
      ['ñ', 'n'],
      ['ï', 'i'],
    ] as const) {
      const glyph = SERIF_FONT.glyph(accented);
      expect(glyph.width).toBe(SERIF_FONT.glyph(base).width);
      expect(Math.min(...inkRows(accented))).toBeLessThan(Math.min(...inkRows(base)));
      expect(Math.max(...inkRows(accented))).toBe(Math.max(...inkRows(base)));
    }
  });
});

describe('measuring and drawing text', () => {
  const font = parseGlyphTable(
    `
A #|#
B ##|##
? #.|.#
space .`,
    { height: 3, ascent: 2, top: 1, defaultChar: '?' },
  );

  it('adds a column of spacing to each glyph, and one more in simulated bold', () => {
    expect(textWidth(font, 'AB')).toBe(2 + 3);
    expect(textWidth(font, 'AB', { bold: true })).toBe(3 + 4);
    expect(textOffsets(font, 'A B', { bold: true })).toEqual([0, 3, 6, 10]);
  });

  it('draws only the ink, twice one pixel apart in bold, from the given row', () => {
    const image = { width: 8, height: 3, pixels: new Uint8Array(24).fill(9) };
    drawText(new IndexedCanvas(image), font, 'AB', 1, 0, 5, { bold: true });
    expect([...image.pixels]).toEqual([
      ...[9, 9, 9, 9, 9, 9, 9, 9],
      ...[9, 5, 5, 9, 5, 5, 5, 9],
      ...[9, 5, 5, 9, 5, 5, 5, 9],
    ]);
  });

  it('falls back to the default glyph', () => {
    expect(font.glyph('Z')).toBe(font.glyph('?'));
  });
});
