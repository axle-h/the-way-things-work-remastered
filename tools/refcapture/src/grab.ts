// Screen frames from the nested X server through `ffmpeg -f x11grab`, streamed as raw RGB.
// The grab reads the root window, so popups (separate X windows on top) are included.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { SettleTracker, type SettleOptions, type SettleResult } from './settle.ts';

export interface Region {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Frame {
  readonly rgb: Uint8Array;
  /** `performance.now()` when the frame arrived. */
  readonly time: number;
}

/** A running `ffmpeg x11grab` of one screen region, without the pointer (`-draw_mouse 0`). */
export class FrameStream {
  readonly region: Region;
  readonly #process: ChildProcessWithoutNullStreams;
  readonly #frameBytes: number;
  #pending: Buffer[] = [];
  #pendingBytes = 0;
  #queue: Frame[] = [];
  #waiters: ((frame: Frame | null) => void)[] = [];
  #ended = false;
  #stderr = '';

  constructor(display: string, region: Region, fps = 10) {
    this.region = region;
    this.#frameBytes = region.width * region.height * 3;
    this.#process = spawn(
      'ffmpeg',
      [
        ...['-loglevel', 'error', '-nostdin', '-f', 'x11grab', '-draw_mouse', '0'],
        ...['-framerate', String(fps), '-video_size', `${region.width}x${region.height}`],
        ...['-i', `${display}+${region.x},${region.y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'],
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    this.#process.stdout.on('data', (chunk: Buffer) => this.#receive(chunk));
    this.#process.stderr.on('data', (chunk: Buffer) => (this.#stderr += chunk.toString()));
    this.#process.on('exit', () => {
      this.#ended = true;
      for (const waiter of this.#waiters.splice(0)) waiter(null);
    });
  }

  #receive(chunk: Buffer): void {
    this.#pending.push(chunk);
    this.#pendingBytes += chunk.length;
    while (this.#pendingBytes >= this.#frameBytes) {
      const all = Buffer.concat(this.#pending);
      const frame: Frame = {
        rgb: new Uint8Array(all.subarray(0, this.#frameBytes)),
        time: performance.now(),
      };
      const rest = all.subarray(this.#frameBytes);
      this.#pending = rest.length > 0 ? [rest] : [];
      this.#pendingBytes = rest.length;
      const waiter = this.#waiters.shift();
      if (waiter !== undefined) waiter(frame);
      else {
        this.#queue.push(frame);
        if (this.#queue.length > 4) this.#queue.shift();
      }
    }
  }

  /** The next frame, or null when ffmpeg has stopped. */
  next(): Promise<Frame | null> {
    const queued = this.#queue.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    if (this.#ended) return Promise.resolve(null);
    return new Promise((resolve) => this.#waiters.push(resolve));
  }

  /** Drops frames already received, so the next one is grabbed after this call. */
  discardQueued(): void {
    this.#queue = [];
  }

  get error(): string {
    return this.#stderr.trim();
  }

  async stop(): Promise<void> {
    if (this.#ended) return;
    const exited = new Promise<void>((resolve) => this.#process.once('exit', () => resolve()));
    this.#process.kill('SIGTERM');
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2000))]);
    if (!this.#ended) this.#process.kill('SIGKILL');
  }
}

export interface SettledCapture {
  readonly result: SettleResult;
  readonly rgb: Uint8Array;
}

/** Reads frames until no new frame appears for `stableMs`, or `timeoutMs` passes. */
export async function waitSettled(
  stream: FrameStream,
  options: Omit<SettleOptions, 'width'>,
): Promise<SettledCapture> {
  stream.discardQueued();
  const tracker = new SettleTracker({ ...options, width: stream.region.width });
  for (;;) {
    const frame = await stream.next();
    if (frame === null) throw new Error(`the screen grab stopped: ${stream.error || 'ffmpeg exited'}`);
    const result = tracker.push(frame.rgb, frame.time);
    if (result !== null) return { result, rgb: result.settled ? tracker.settledFrame! : tracker.last! };
  }
}
