// The engine's audio sink on Web Audio (docs/architecture.md, "Audio"). The engine decodes the disc's
// MS-ADPCM and 8-bit PCM itself (@twtw/formats) and hands over clips; this turns each clip into
// an AudioBuffer once, schedules it, and gives the engine the audio clock that animation frames
// are timed against (docs/formats/playback.md §2).
import type { AudioClip, AudioSink, AudioVoice } from '@twtw/engine';

/**
 * The parts of an `AudioContext` the sink uses. A real `AudioContext` fits; tests pass a fake.
 * (Declared here so this file needs no DOM types.)
 */
export interface AudioContextLike {
  readonly currentTime: number;
  /** Seconds from the context's clock to the speaker; missing in some browsers. */
  readonly outputLatency?: number | undefined;
  readonly baseLatency?: number | undefined;
  readonly destination: AudioNodeLike;
  createBuffer(channels: number, length: number, sampleRate: number): AudioBufferLike;
  createBufferSource(): AudioBufferSourceLike;
  createGain(): AudioNodeLike & { readonly gain: { value: number } };
}

export interface AudioNodeLike {
  connect(destination: AudioNodeLike): unknown;
  disconnect(): void;
}

export interface AudioBufferLike {
  readonly duration: number;
  copyToChannel(source: Float32Array<ArrayBuffer>, channel: number): void;
}

export interface AudioBufferSourceLike extends AudioNodeLike {
  buffer: AudioBufferLike | null;
  start(when: number, offset: number): void;
  stop(): void;
}

/** How far ahead a clip is scheduled, so its first samples are not cut off. */
export const START_LEAD_SECONDS = 0.03;

export class WebAudioSink implements AudioSink {
  readonly context: AudioContextLike;
  readonly #output: AudioNodeLike & { readonly gain: { value: number } };
  /** Each clip's buffer, made once and kept as long as the clip (the engine's player) lives. */
  readonly #buffers = new WeakMap<AudioClip, AudioBufferLike | null>();

  constructor(context: AudioContextLike) {
    this.context = context;
    this.#output = context.createGain();
    this.#output.connect(context.destination);
  }

  /** Output volume, 0 … 1. */
  get volume(): number {
    return this.#output.gain.value;
  }

  set volume(value: number) {
    this.#output.gain.value = Math.min(1, Math.max(0, value));
  }

  /** Seconds between the context's clock and what is heard. */
  get latency(): number {
    const { outputLatency, baseLatency } = this.context;
    return outputLatency !== undefined && outputLatency > 0 ? outputLatency : (baseLatency ?? 0);
  }

  /**
   * The audible position of the audio clock: a sample scheduled for context time *t* is heard
   * when this reaches *t*. Frames timed against it appear with the sound, not ahead of it.
   */
  now(): number {
    return Math.max(0, this.context.currentTime - this.latency);
  }

  start(clip: AudioClip, offset: number): AudioVoice {
    const when = this.context.currentTime + START_LEAD_SECONDS;
    const duration = clip.sampleRate > 0 ? clip.length / clip.sampleRate : 0;
    const from = Math.min(Math.max(0, offset), duration);
    const buffer = this.#buffer(clip);
    if (buffer === null) return { startTime: when - from, stop: () => {} };
    const node = this.context.createBufferSource();
    node.buffer = buffer;
    node.connect(this.#output);
    node.start(when, from);
    let playing = true;
    return {
      startTime: when - from,
      stop: () => {
        if (!playing) return;
        playing = false;
        try {
          node.stop();
        } catch {
          // Already finished.
        }
        node.disconnect();
      },
    };
  }

  #buffer(clip: AudioClip): AudioBufferLike | null {
    let buffer = this.#buffers.get(clip);
    if (buffer === undefined) {
      // An AudioBuffer cannot be empty; a clip without samples plays silently.
      if (clip.length === 0 || clip.channels.length === 0) {
        buffer = null;
      } else {
        buffer = this.context.createBuffer(clip.channels.length, clip.length, clip.sampleRate);
        clip.channels.forEach((samples, channel) =>
          buffer!.copyToChannel(asArrayBufferView(samples), channel),
        );
      }
      this.#buffers.set(clip, buffer);
    }
    return buffer;
  }
}

/** `copyToChannel` wants a view of a plain `ArrayBuffer`; decoded samples always are one. */
function asArrayBufferView(samples: Float32Array): Float32Array<ArrayBuffer> {
  return samples.buffer instanceof ArrayBuffer
    ? (samples as Float32Array<ArrayBuffer>)
    : new Float32Array(samples);
}
