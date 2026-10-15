/**
 * Bitmap fonts drawn into the indexed framebuffer. The original draws text in two places only:
 * the Index page's list and edit box, and the caption band of a copied or printed picture
 * (special-screens.md §1.3, §4.4). Windows' own raster fonts cannot be shipped, so the engine has
 * its own pixel font with the same metrics (`serif-font.ts`).
 *
 * A font is a set of glyphs in a fixed-height cell. Each glyph is a 1-bit picture as wide as its
 * advance: its last column is the space to the next character. Text is a string of Windows-1252
 * characters as decoded by `@twtw/formats` (U+00AD is the soft hyphen, drawn as a dash).
 */
import type { IndexedCanvas } from '../render/canvas.ts';

export interface Glyph {
  /** Advance in pixels (the regular weight); the picture is this wide. */
  readonly width: number;
  /** One byte per pixel, rows of `width` from the cell's top: 1 = ink. */
  readonly pixels: Uint8Array;
}

export interface BitmapFont {
  /** Cell height: the distance between rows of text. */
  readonly height: number;
  /** Rows from the cell's top to the baseline. */
  readonly ascent: number;
  /** The glyph for a character; the font's default glyph for those it lacks. */
  glyph(char: string): Glyph;
}

export interface TextStyle {
  /**
   * Simulated bold, as GDI does for a raster face that has no bold: each glyph is drawn twice,
   * the second time one pixel to the right, and advances one pixel more.
   */
  readonly bold?: boolean;
}

/** The width of `text` in pixels. */
export function textWidth(font: BitmapFont, text: string, style: TextStyle = {}): number {
  const extra = style.bold === true ? 1 : 0;
  let width = 0;
  for (const char of text) width += font.glyph(char).width + extra;
  return width;
}

/**
 * The offsets of each character boundary: `[0, w(c0), w(c0)+w(c1), …]`, `text.length + 1`
 * entries (for caret placement).
 */
export function textOffsets(font: BitmapFont, text: string, style: TextStyle = {}): number[] {
  const extra = style.bold === true ? 1 : 0;
  const offsets = [0];
  let width = 0;
  for (const char of text) {
    width += font.glyph(char).width + extra;
    offsets.push(width);
  }
  return offsets;
}

/**
 * Draws `text` with the cell's top-left at local (x, y) of the canvas, in palette index
 * `colour`; only the ink is drawn (a transparent background). Clipped by the canvas.
 */
export function drawText(
  canvas: IndexedCanvas,
  font: BitmapFont,
  text: string,
  x: number,
  y: number,
  colour: number,
  style: TextStyle = {},
): void {
  const bold = style.bold === true;
  let left = x;
  for (const char of text) {
    const glyph = font.glyph(char);
    drawGlyph(canvas, font, glyph, left, y, colour);
    if (bold) drawGlyph(canvas, font, glyph, left + 1, y, colour);
    left += glyph.width + (bold ? 1 : 0);
  }
}

function drawGlyph(
  canvas: IndexedCanvas,
  font: BitmapFont,
  glyph: Glyph,
  x: number,
  y: number,
  colour: number,
): void {
  const { width, pixels } = glyph;
  for (let row = 0; row < font.height; row++) {
    let start = -1;
    for (let column = 0; column <= width; column++) {
      const ink = column < width && pixels[row * width + column] === 1;
      if (ink && start < 0) start = column;
      if (!ink && start >= 0) {
        canvas.fill(x + start, y + row, column - start, 1, colour);
        start = -1;
      }
    }
  }
}

/**
 * Builds a font from a glyph table: one glyph per line, `<char> <rows>`, the rows from the cell's
 * row `top` down joined by `|`, `#` for ink. `space`, `shy`, `backtick` and `backslash` name
 * the characters that cannot be written there.
 * Each glyph gets one blank column more, its spacing. Accented Latin-1 letters missing from the
 * table are composed from their base letter and an accent; anything else falls back to
 * `defaultChar`.
 */
export function parseGlyphTable(
  table: string,
  metrics: {
    readonly height: number;
    readonly ascent: number;
    readonly top: number;
    readonly defaultChar: string;
  },
): BitmapFont {
  const { height, top } = metrics;
  const glyphs = new Map<string, Glyph>();
  for (const line of table.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    const space = trimmed.indexOf(' ');
    const name = trimmed.slice(0, space);
    const char = GLYPH_NAMES[name] ?? name;
    const rows = trimmed.slice(space + 1).split('|');
    const width = Math.max(...rows.map((row) => row.length)) + 1;
    const pixels = new Uint8Array(width * height);
    rows.forEach((row, r) => {
      for (let column = 0; column < row.length; column++) {
        if (row[column] === '#' && top + r < height) pixels[(top + r) * width + column] = 1;
      }
    });
    glyphs.set(char, { width, pixels });
  }
  const fallback = glyphs.get(metrics.defaultChar);
  if (fallback === undefined) throw new Error(`glyph table has no default character ${metrics.defaultChar}`);
  const font: BitmapFont = {
    height,
    ascent: metrics.ascent,
    glyph(char) {
      let glyph = glyphs.get(char);
      if (glyph === undefined) {
        glyph = composeAccented(font, glyphs, char) ?? fallback;
        glyphs.set(char, glyph);
      }
      return glyph;
    },
  };
  return font;
}

/** Glyph table names for characters that cannot start a line of the table. */
const GLYPH_NAMES: Readonly<Record<string, string>> = {
  space: ' ',
  shy: '\u00ad',
  backtick: '`',
  backslash: '\\',
};

/** Accent marks, as rows of `#`, drawn above a letter. */
const ACCENTS = {
  grave: ['#.', '.#'],
  acute: ['.#', '#.'],
  circumflex: ['.#.', '#.#'],
  tilde: ['.#..#', '#.##.'],
  diaeresis: ['#..#'],
  ring: ['.#.', '#.#', '.#.'],
} as const;

/** Latin-1 accented letters: base letter and accent. */
const ACCENTED: Readonly<Record<string, readonly [string, keyof typeof ACCENTS]>> = (() => {
  const table: Record<string, readonly [string, keyof typeof ACCENTS]> = {};
  const add = (letters: string, bases: string, accent: keyof typeof ACCENTS): void => {
    [...letters].forEach((letter, i) => (table[letter] = [bases[i]!, accent]));
  };
  add('ÀÈÌÒÙàèìòù', 'AEIOUaeiou', 'grave');
  add('ÁÉÍÓÚÝáéíóúý', 'AEIOUYaeiouy', 'acute');
  add('ÂÊÎÔÛâêîôû', 'AEIOUaeiou', 'circumflex');
  add('ÃÑÕãñõ', 'ANOano', 'tilde');
  add('ÄËÏÖÜäëïöüÿŸ', 'AEIOUaeiouyY', 'diaeresis');
  add('Åå', 'Aa', 'ring');
  return table;
})();

/**
 * An accented letter: the base glyph, with any dot (i, j) removed, and the accent centred over
 * its ink, its last row two rows above the letter's top.
 */
function composeAccented(font: BitmapFont, glyphs: Map<string, Glyph>, char: string): Glyph | null {
  const recipe = ACCENTED[char];
  if (recipe === undefined) return null;
  const [baseChar, accentName] = recipe;
  const dotless = baseChar === 'i' ? 'ı' : baseChar;
  const base = glyphs.get(dotless) ?? glyphs.get(baseChar);
  if (base === undefined) return null;
  const { width, pixels: basePixels } = base;
  const pixels = new Uint8Array(basePixels);
  const height = font.height;
  // The letter's ink: top row and columns.
  let inkTop = height;
  let inkLeft = width;
  let inkRight = -1;
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      if (pixels[row * width + column] !== 1) continue;
      inkTop = Math.min(inkTop, row);
      inkLeft = Math.min(inkLeft, column);
      inkRight = Math.max(inkRight, column);
    }
  }
  if (inkRight < 0) return null;
  if (baseChar === 'i' && dotless === baseChar) {
    // No dotless i in the table: clear the dot (the ink above the stem's top).
    const stemTop = inkTop + 2;
    pixels.fill(0, 0, stemTop * width);
    inkTop = stemTop;
  }
  const accent = ACCENTS[accentName];
  const accentWidth = accent[0]!.length;
  const left = Math.max(0, Math.floor((inkLeft + inkRight + 1 - accentWidth) / 2));
  const bottom = Math.max(accent.length - 1, inkTop - 2);
  accent.forEach((row, r) => {
    const y = bottom - (accent.length - 1) + r;
    for (let column = 0; column < row.length; column++) {
      if (row[column] === '#' && left + column < width && y >= 0) pixels[y * width + left + column] = 1;
    }
  });
  return { width, pixels };
}
