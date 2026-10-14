// The settled state: the screen has stopped showing anything new (animations finished, page
// loaded). A screen that keeps cycling through frames it has already shown, such as the A–Z
// machine's blinking light, also counts as settled; the cycle is recorded.
import { createHash } from 'node:crypto';

export interface SettleOptions {
  /** How long no new frame may appear, in milliseconds. */
  readonly stableMs: number;
  /** Give up after this long, in milliseconds, and use the last frame. */
  readonly timeoutMs: number;
  /** Width of a frame in pixels (frames are packed RGB), for {@link SettleResult.changingRect}. */
  readonly width: number;
  /** A cycle of more distinct frames than this is treated as still changing. Default 4. */
  readonly maxCycle?: number;
}

export interface ChangeRect {
  readonly left: number;
  readonly top: number;
  /** Exclusive. */
  readonly right: number;
  readonly bottom: number;
}

export interface SettleResult {
  readonly settled: boolean;
  readonly timedOut: boolean;
  /** Frames seen in all. */
  readonly frames: number;
  /** Frames seen until the last new frame (1-based): the stable run starts there. */
  readonly framesUntilStable: number;
  /** How many times a frame differed from the one before. */
  readonly changes: number;
  /** Milliseconds from the first frame until the last new frame. */
  readonly msUntilStable: number;
  /** Milliseconds from the first frame until the result. */
  readonly elapsedMs: number;
  /** Distinct frames shown during the stable run: 1 for a still screen, 2 for a blinking light. */
  readonly cycleFrames: number;
  /** Bounding box of the pixels that changed during the stable run, or null if none did. */
  readonly changingRect: ChangeRect | null;
}

/**
 * Feed it frames with their timestamps; it reports once `stableMs` passed without a frame it had
 * not seen before, or when `timeoutMs` passed first.
 */
export class SettleTracker {
  readonly #options: SettleOptions;
  #start: number | null = null;
  #last: Uint8Array | null = null;
  #settledFrame: Uint8Array | null = null;
  /** When each distinct frame was last seen. */
  readonly #seen = new Map<string, number>();
  #stableSince = 0;
  #stableFrame = 0;
  #frames = 0;
  #changes = 0;
  #changing: { left: number; top: number; right: number; bottom: number } | null = null;

  constructor(options: SettleOptions) {
    this.#options = options;
  }

  /** The most recent frame. */
  get last(): Uint8Array | null {
    return this.#last;
  }

  /**
   * The frame to keep: the last new frame, where the stable run began. For a still screen it is
   * the last frame; for a cycling one it does not depend on when the waiting stopped.
   */
  get settledFrame(): Uint8Array | null {
    return this.#settledFrame;
  }

  /** Adds a frame; returns the result once settled or timed out, otherwise null. */
  push(frame: Uint8Array, time: number): SettleResult | null {
    this.#start ??= time;
    this.#frames++;
    const hash = createHash('sha1').update(frame).digest('hex');
    const previous = this.#last;
    const changed = previous !== null && !equalBytes(previous, frame);
    if (changed) this.#changes++;
    if (!this.#seen.has(hash)) {
      this.#stableSince = time;
      this.#stableFrame = this.#frames;
      this.#settledFrame = frame;
      this.#changing = null;
    } else if (changed) {
      this.#widenChanging(previous, frame);
    }
    this.#seen.set(hash, time);
    this.#last = frame;

    const cycle = [...this.#seen.values()].filter((seen) => seen >= this.#stableSince).length;
    const stable =
      time - this.#stableSince >= this.#options.stableMs &&
      this.#frames > this.#stableFrame &&
      cycle <= (this.#options.maxCycle ?? 4);
    const timedOut = !stable && time - this.#start >= this.#options.timeoutMs;
    if (!stable && !timedOut) return null;
    return {
      settled: stable,
      timedOut,
      frames: this.#frames,
      framesUntilStable: this.#stableFrame,
      changes: this.#changes,
      msUntilStable: Math.round(this.#stableSince - this.#start),
      elapsedMs: Math.round(time - this.#start),
      cycleFrames: cycle,
      changingRect: this.#changing,
    };
  }

  #widenChanging(a: Uint8Array, b: Uint8Array): void {
    const width = this.#options.width;
    for (let i = 0; i < a.length; i += 3) {
      if (a[i] === b[i] && a[i + 1] === b[i + 1] && a[i + 2] === b[i + 2]) continue;
      const pixel = i / 3;
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      const r = (this.#changing ??= { left: x, top: y, right: x + 1, bottom: y + 1 });
      r.left = Math.min(r.left, x);
      r.top = Math.min(r.top, y);
      r.right = Math.max(r.right, x + 1);
      r.bottom = Math.max(r.bottom, y + 1);
    }
  }
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  return Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(
    Buffer.from(b.buffer, b.byteOffset, b.byteLength),
  );
}
