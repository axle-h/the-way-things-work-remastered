/**
 * Time for the engine's timed effects: the zoom outlines (behaviour.md §4.2) and the A–Z lamp
 * (rendering.md §6). The engine never reads a system clock itself, so it stays DOM-free and its
 * timing is testable: the web app passes a clock backed by `performance.now` and `setTimeout`.
 */
export interface Clock {
  /** Milliseconds on a monotonic time line. */
  now(): number;
  /** Resolves once `ms` milliseconds have passed on this clock. */
  wait(ms: number): Promise<void>;
}

/**
 * A clock whose time only moves when something waits: `wait(ms)` jumps ahead by `ms` and
 * resolves at once. Timed effects therefore complete instantly. The default for headless use
 * (tests, tools); the lamp never blinks unless something waits.
 */
export class VirtualClock implements Clock {
  #now = 0;

  now(): number {
    return this.#now;
  }

  wait(ms: number): Promise<void> {
    this.#now += Math.max(0, ms);
    return Promise.resolve();
  }
}
