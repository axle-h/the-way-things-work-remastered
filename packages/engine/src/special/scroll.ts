/**
 * Scroll bars (special-screens.md §1.11, §3): the ScrollBar display object of the Help pages and
 * its partner ScrollBitmap, and the Index page's own scroll bar control. Both are drawn from the
 * program's `LINEUP` … `THUMBTRACKALT` bitmaps; their position arithmetic differs.
 */

/** The parts of a scroll bar a press can hit. */
export type ScrollPart = 'lineUp' | 'pageUp' | 'thumb' | 'pageDown' | 'lineDown';

/** Height of the arrows and of the thumb. */
export const SCROLL_PART_SIZE = 16;

/** A ScrollBitmap's picture moves by about this many pixels per step (one line of Help text). */
export const SCROLL_STEP_PIXELS = 18;

/** Auto-repeat of a held arrow or track: the Help ScrollBar's timer (§3.3). */
export const SCROLL_BAR_REPEAT_MS = 100;

/** Auto-repeat of the Index scroll bar control (§1.11). */
export const INDEX_SCROLL_REPEAT_MS = 80;

/**
 * The original's integer rounding of `a / n` (special-screens.md §3.2): double `a`, divide by `n`
 * truncating, add 1, halve rounding down.
 */
export function roundDivide(a: number, n: number): number {
  if (n === 0) return 0;
  return Math.floor((Math.trunc((2 * a) / n) + 1) / 2);
}

/**
 * Where a ScrollBar and its partner ScrollBitmap are: shared by both, so a step moves the thumb
 * and the picture together. Positions run from 0 to `max`.
 */
export interface ScrollState {
  position: number;
  readonly max: number;
  /** Steps of a page up or down. */
  readonly page: number;
  /** Pixels the picture can scroll: picture height − window height (0 if it cannot). */
  readonly distance: number;
}

/**
 * The scroll range of a ScrollBitmap showing a `pictureHeight` picture in a `viewHeight` window
 * (§3.2): `max` = distance ÷ 18, a page = round(view × max / distance).
 */
export function scrollBitmapState(viewHeight: number, pictureHeight: number, position = 0): ScrollState {
  const distance = pictureHeight - viewHeight;
  const max = distance > 0 ? Math.floor(distance / SCROLL_STEP_PIXELS) : 0;
  if (max <= 0) return { position: 0, max: 0, page: 0, distance: 0 };
  return {
    position: clamp(position, 0, max),
    max,
    page: roundDivide(viewHeight * max, distance),
    distance,
  };
}

/** The picture row shown at a position: round(position × distance / max). */
export function scrollPictureRow(state: ScrollState): number {
  return state.max <= 0 ? 0 : roundDivide(state.position * state.distance, state.max);
}

/** A step of a press on a part (§3.3): line ±1, page ± a page; the thumb does not step. */
export function scrollStep(state: ScrollState, part: ScrollPart): number {
  const step = { lineUp: -1, pageUp: -state.page, thumb: 0, pageDown: state.page, lineDown: 1 }[part];
  return clamp(state.position + step, 0, state.max);
}

/** The geometry of a Help ScrollBar in its rectangle's coordinates (y from the top, §3.2). */
export interface ScrollBarLayout {
  readonly width: number;
  readonly height: number;
  readonly trackTop: number;
  readonly trackBottom: number;
  readonly thumbTop: number;
  /** Pixels the thumb travels over the whole range: track length − thumb height + 1. */
  readonly travel: number;
}

export function scrollBarLayout(width: number, height: number, state: ScrollState): ScrollBarLayout {
  const trackTop = SCROLL_PART_SIZE;
  const trackBottom = height - SCROLL_PART_SIZE;
  const travel = trackBottom - trackTop - SCROLL_PART_SIZE + 1;
  const offset = state.max <= 0 ? 0 : roundDivide(state.position * travel, state.max);
  return { width, height, trackTop, trackBottom, thumbTop: trackTop + offset, travel };
}

/**
 * The part a press at `y` (bar coordinates) hits: above the up arrow's bottom, the thumb's top,
 * its bottom, the down arrow's top, else the down arrow (§3.3, §1.11).
 */
export function scrollPartAt(y: number, trackTop: number, thumbTop: number, trackBottom: number): ScrollPart {
  if (y < trackTop) return 'lineUp';
  if (y < thumbTop) return 'pageUp';
  if (y < thumbTop + SCROLL_PART_SIZE) return 'thumb';
  if (y < trackBottom) return 'pageDown';
  return 'lineDown';
}

/** The rows a part covers now, `[top, bottom)` in bar coordinates (for the auto-repeat check). */
export function scrollPartRows(
  part: ScrollPart,
  height: number,
  trackTop: number,
  thumbTop: number,
  trackBottom: number,
): readonly [number, number] {
  switch (part) {
    case 'lineUp':
      return [0, trackTop];
    case 'pageUp':
      return [trackTop, thumbTop];
    case 'thumb':
      return [thumbTop, thumbTop + SCROLL_PART_SIZE];
    case 'pageDown':
      return [thumbTop + SCROLL_PART_SIZE, trackBottom];
    case 'lineDown':
      return [trackBottom, height];
  }
}

/**
 * The position while the Help ScrollBar's thumb is dragged (§3.3): round((y − track top − 8) ×
 * max / travel), clamped, so the thumb's centre follows the pointer.
 */
export function scrollDragPosition(y: number, layout: ScrollBarLayout, state: ScrollState): number {
  if (layout.travel <= 0) return 0;
  const offset = y - layout.trackTop - SCROLL_PART_SIZE / 2;
  return clamp(roundDivide(offset * state.max, layout.travel), 0, state.max);
}

// ---------------------------------------------------------------------------------------------
// The Index page's scroll bar control (§1.11)

/** The Index scroll bar's position arithmetic: range 0 … `range`, in single precision. */
export class IndexScrollMath {
  readonly range: number;
  readonly travel: number;
  /** Pixels per position, as a single-precision float. */
  readonly #ratio: number;

  /** `height`: the control's height (173); the track is between the two 16-pixel arrows. */
  constructor(range: number, height: number) {
    this.range = range;
    this.travel = height - 3 * SCROLL_PART_SIZE;
    this.#ratio = range > 0 ? Math.fround(this.travel / range) : 0;
  }

  /** The thumb's offset below the track top: round(position × travel / range), half up. */
  thumbOffset(position: number): number {
    return Math.floor(Math.fround(position * this.#ratio) + 0.5);
  }

  /** The position for a pointer at `y` (control coordinates) while dragging, truncated and clamped. */
  dragPosition(y: number): number {
    if (this.#ratio === 0) return 0;
    const position = Math.trunc(Math.fround((y - SCROLL_PART_SIZE - SCROLL_PART_SIZE / 2) / this.#ratio));
    return clamp(position, 0, this.range);
  }
}

export function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}
