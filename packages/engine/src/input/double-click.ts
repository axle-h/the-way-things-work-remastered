/**
 * Double clicks as Windows detects them (behaviour.md §1.7): a second press within the double-click
 * time and inside a small rectangle centred on the first press is a double click, which the
 * original ignores together with its release. A presenter feeds mouse presses through this and
 * passes the answer to `Engine.pointerDown`; taps are never double clicks (behaviour.md §11).
 */

/** Windows 3.1 defaults: 500 ms, and a 4×4-pixel rectangle (`SM_CXDOUBLECLK`, `SM_CYDOUBLECLK`). */
export const DOUBLE_CLICK_TIME_MS = 500;
export const DOUBLE_CLICK_SIZE = 4;

export class DoubleClickDetector {
  readonly #time: number;
  readonly #size: number;
  #first: { x: number; y: number; time: number } | null = null;

  constructor(time = DOUBLE_CLICK_TIME_MS, size = DOUBLE_CLICK_SIZE) {
    this.#time = time;
    this.#size = size;
  }

  /**
   * Whether a press at (x, y) (original pixels) at `time` (ms) completes a double click. The press
   * after a double click starts afresh.
   */
  press(x: number, y: number, time: number): boolean {
    const first = this.#first;
    if (
      first !== null &&
      time - first.time <= this.#time &&
      Math.abs(x - first.x) * 2 <= this.#size &&
      Math.abs(y - first.y) * 2 <= this.#size
    ) {
      this.#first = null;
      return true;
    }
    this.#first = { x, y, time };
    return false;
  }

  /** Forgets the last press (e.g. after a touch or a cancelled pointer). */
  reset(): void {
    this.#first = null;
  }
}
