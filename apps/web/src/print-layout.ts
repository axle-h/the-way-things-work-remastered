// Sizes and placement for Copy and Print (docs/PLAN.md Phase 8; special-screens.md §4.4–4.8).
// Pure and unit-tested; `picture-output.ts` applies them to the DOM.

/**
 * Copy puts the captioned picture on the clipboard at twice its size (1276×998 for a base page).
 * At 1× it is small on today's screens, and the application it is pasted into enlarges it with
 * smoothing; at 2× it shows at its on-screen size on a high-density screen and survives such
 * enlarging better, while staying a small palette PNG.
 */
export const COPY_SCALE = 2;

/**
 * Print uses a 4× picture (2552×1996 for a base page): about 300 pixels to the inch across a
 * sheet, so each original pixel is a crisp block on paper whatever the browser's print pipeline
 * does when it fits the picture to the page.
 */
export const PRINT_SCALE = 4;

/** Margin of the printed sheet on every side. */
export const PRINT_MARGIN_MM = 10;

/**
 * Where the picture goes on the sheet. `centred` centres it on the printable area, Alex's choice
 * (special-screens.md §4.8); `top-left` is the original's placement (§4.6). Both keep the
 * original's size.
 */
export type PrintPlacement = 'top-left' | 'centred';
export const PRINT_PLACEMENT: PrintPlacement = 'centred';

/** The full screen with its band: 640 columns, 480 + 40 rows (special-screens.md §4.6). */
const FULL_WIDTH = 640;
const FULL_HEIGHT = 480 + 40;

export interface PrintedSize {
  readonly width: number;
  readonly height: number;
}

/**
 * The printed size of a captioned picture `width` × `height` on a printable area `pageWidth` ×
 * `pageHeight` (any unit). Every picture prints at one scale: the smaller of the original's two,
 * the scale at which 640 columns span the page width and the one at which 520 rows fill its
 * height, i.e. the scale at which a full screen with its band fits the sheet. So a popup prints
 * at W/640 of a full screen's width, as in the original. The original takes the height scale
 * only when the picture itself would overflow the sheet (§4.6), so on a landscape sheet a wide
 * picture under about 440 rows prints up to a fifth larger there.
 */
export function printedSize(
  width: number,
  height: number,
  pageWidth: number,
  pageHeight: number,
): PrintedSize {
  const scale = Math.min(pageWidth / FULL_WIDTH, pageHeight / FULL_HEIGHT);
  return { width: width * scale, height: height * scale };
}

export interface PrintLayout {
  /** Landscape for a picture wider than it is tall (every base page), else portrait. */
  readonly orientation: 'landscape' | 'portrait';
  readonly placement: PrintPlacement;
  /** The `@page` rule for this picture. */
  readonly pageRule: string;
  /**
   * The picture's CSS width in the print layout, where `100%` is the printable width and
   * `100vh` the printable height: {@link printedSize} in CSS.
   */
  readonly imageWidth: string;
}

/** The print layout of a captioned picture `width` × `height`. */
export function printLayout(
  width: number,
  height: number,
  placement: PrintPlacement = PRINT_PLACEMENT,
): PrintLayout {
  const orientation = width > height ? 'landscape' : 'portrait';
  const byWidth = round((100 * width) / FULL_WIDTH);
  const byHeight = round((100 * width) / FULL_HEIGHT);
  return {
    orientation,
    placement,
    pageRule: `@page { size: ${orientation}; margin: ${PRINT_MARGIN_MM}mm; }`,
    imageWidth: `min(${byWidth}%, ${byHeight}vh)`,
  };
}

/** Four decimals: plenty for a printed size, and stable in tests. */
const round = (value: number): number => Math.round(value * 1e4) / 1e4;

/**
 * The scale at which the copy fallback shows a `width` × `height` picture in `availableWidth` ×
 * `availableHeight` device pixels: the largest whole scale that fits, as the stage does (PLAN §3,
 * "Scaling rules"), or below 1× the largest that fits.
 */
export function previewScale(
  width: number,
  height: number,
  availableWidth: number,
  availableHeight: number,
): number {
  const fit = Math.min(availableWidth / width, availableHeight / height);
  return fit >= 1 ? Math.floor(fit) : Math.max(fit, 0);
}
