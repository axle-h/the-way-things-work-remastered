/**
 * The history of base pages behind the navigation bar's Back button (behaviour.md §6.3).
 */
import type { PageRef } from '@twtw/formats';

/** The original keeps at most 32 entries; pushing a 33rd drops the oldest. */
export const HISTORY_LIMIT = 32;

export class History {
  readonly #entries: PageRef[] = [];

  /** Oldest first; the last entry is the current base page. */
  get entries(): readonly PageRef[] {
    return this.#entries;
  }

  /** Records a base page after a successful ChangePage, unless it is already the top entry. */
  push(ref: PageRef): void {
    if (this.#entries.at(-1) === ref) return;
    this.#entries.push(ref);
    if (this.#entries.length > HISTORY_LIMIT) this.#entries.shift();
  }

  /**
   * Back: with at least two entries, removes the top one (the current page) and the one below it,
   * and returns that page, which going there records again. With fewer, returns `null` and leaves
   * the history as it is.
   */
  back(): PageRef | null {
    if (this.#entries.length < 2) return null;
    this.#entries.pop();
    return this.#entries.pop() ?? null;
  }

  clear(): void {
    this.#entries.length = 0;
  }
}
