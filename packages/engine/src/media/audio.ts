/**
 * The engine's view of a sound output. The engine never touches Web Audio: it hands decoded PCM
 * to an {@link AudioSink} and reads the sink's clock, against which animation frames are timed
 * (playback.md §2). The web app implements the sink with Web Audio; headless use (tests, tools)
 * uses {@link ClockAudioSink}, whose clock is the engine's {@link Clock}.
 */
import type { Clock } from '../clock.ts';

/** Decoded sound: one array of samples (−1 … 1) per channel. `DecodedAudio` of `@twtw/formats` is one. */
export interface AudioClip {
  readonly sampleRate: number;
  readonly channels: readonly Float32Array[];
  /** Samples per channel. */
  readonly length: number;
}

/** Length of a clip in seconds. */
export function clipDuration(clip: AudioClip): number {
  return clip.sampleRate > 0 ? clip.length / clip.sampleRate : 0;
}

/** A clip being played. */
export interface AudioVoice {
  /**
   * When the clip's first sample is (or would have been) heard, on the sink's clock: the clip's
   * sample at time *t* is heard at `startTime + t`. Frames are drawn against this.
   */
  readonly startTime: number;
  /** Silences the clip at once. Stopping twice does nothing. */
  stop(): void;
}

export interface AudioSink {
  /**
   * The audio clock in seconds: the position of what is being heard now. Monotonic; it may stand
   * still (e.g. while the browser has not yet allowed sound).
   */
  now(): number;
  /** Plays a clip from `offset` seconds into it, as soon as the output allows. */
  start(clip: AudioClip, offset: number): AudioVoice;
}

/**
 * A sink without sound whose clock is an engine {@link Clock} (milliseconds), for headless use:
 * with a `VirtualClock` or `ManualClock`, playback advances exactly as fast as that clock.
 */
export class ClockAudioSink implements AudioSink {
  readonly clock: Clock;

  constructor(clock: Clock) {
    this.clock = clock;
  }

  now(): number {
    return this.clock.now() / 1000;
  }

  start(_clip: AudioClip, offset: number): AudioVoice {
    return { startTime: this.now() - offset, stop: () => {} };
  }
}
