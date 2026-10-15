/**
 * Time for the engine's timed effects: the zoom outlines (behaviour.md §4.2) and the A–Z lamp
 * (rendering.md §6). The engine never reads a system clock itself, so it stays DOM-free and its
 * timing is testable: the web app passes a clock backed by `performance.now` and `setTimeout`.
 * Sound and animation run on the audio sink's clock instead (media/audio.ts); headless, that
 * sink reads this clock.
 */
export interface Clock {
  /** Milliseconds on a monotonic time line. */
  now(): number;
  /** Resolves once `ms` milliseconds have passed on this clock. */
  wait(ms: number): Promise<void>;
}

/** A clock that can be moved on by its owner: `Engine.settle` runs playback to its end with one. */
export interface AdvancingClock extends Clock {
  /** Moves time on by `ms`, resolving the waits that are then due. */
  advance(ms: number): void;
}

export function canAdvance(clock: Clock): clock is AdvancingClock {
  return typeof (clock as Partial<AdvancingClock>).advance === 'function';
}

/**
 * A clock whose time only moves when something waits: `wait(ms)` jumps ahead by `ms` and
 * resolves at once. Timed effects therefore complete instantly, and so does input that waits for
 * an animation (a navigation button): the engine moves this clock on to the animation's end. The
 * default for headless use (tests, tools); the lamp never blinks unless something waits.
 */
export class VirtualClock implements AdvancingClock {
  #now = 0;

  now(): number {
    return this.#now;
  }

  wait(ms: number): Promise<void> {
    this.#now += Math.max(0, ms);
    return Promise.resolve();
  }

  advance(ms: number): void {
    this.#now += Math.max(0, ms);
  }
}
