import { describe, expect, it } from 'vitest';
import {
  START_LEAD_SECONDS,
  WebAudioSink,
  type AudioBufferLike,
  type AudioBufferSourceLike,
  type AudioContextLike,
  type AudioNodeLike,
} from '../src/audio.ts';

/** Enough of an AudioContext to see what the sink schedules. */
class FakeContext implements AudioContextLike {
  currentTime = 10;
  outputLatency: number | undefined = 0.05;
  baseLatency = 0.01;
  readonly destination: AudioNodeLike = { connect: () => {}, disconnect: () => {} };
  readonly buffers: { channels: number; length: number; rate: number; data: Float32Array[] }[] = [];
  readonly sources: { buffer: AudioBufferLike | null; started: [number, number] | null; stopped: boolean }[] =
    [];

  createBuffer(channels: number, length: number, sampleRate: number): AudioBufferLike {
    const record = { channels, length, rate: sampleRate, data: [] as Float32Array[] };
    this.buffers.push(record);
    return {
      duration: length / sampleRate,
      copyToChannel: (source, channel) => {
        record.data[channel] = source.slice();
      },
    };
  }

  createBufferSource(): AudioBufferSourceLike {
    const record = {
      buffer: null as AudioBufferLike | null,
      started: null as [number, number] | null,
      stopped: false,
    };
    this.sources.push(record);
    return {
      get buffer() {
        return record.buffer;
      },
      set buffer(value) {
        record.buffer = value;
      },
      connect: () => {},
      disconnect: () => {},
      start: (when, offset) => {
        record.started = [when, offset];
      },
      stop: () => {
        record.stopped = true;
      },
    };
  }

  createGain() {
    return { gain: { value: 1 }, connect: () => {}, disconnect: () => {} };
  }
}

const clip = (length: number, rate = 22050) => ({
  sampleRate: rate,
  channels: [new Float32Array(length).fill(0.5)],
  length,
});

describe('WebAudioSink', () => {
  it('reads the audio clock as what is heard: the context time less the output latency', () => {
    const context = new FakeContext();
    const sink = new WebAudioSink(context);
    expect(sink.now()).toBeCloseTo(9.95);
    context.outputLatency = undefined;
    expect(sink.now()).toBeCloseTo(9.99);
  });

  it('schedules a clip a little ahead, from an offset, and reports when its start is heard', () => {
    const context = new FakeContext();
    const sink = new WebAudioSink(context);
    const voice = sink.start(clip(22050), 0.25);
    expect(context.sources[0]!.started).toEqual([10 + START_LEAD_SECONDS, 0.25]);
    // Sample 0.25 s is heard when now() reaches the scheduled context time.
    expect(voice.startTime).toBeCloseTo(10 + START_LEAD_SECONDS - 0.25);
    voice.stop();
    voice.stop();
    expect(context.sources[0]!.stopped).toBe(true);
  });

  it('makes each clip into a buffer once', () => {
    const context = new FakeContext();
    const sink = new WebAudioSink(context);
    const sound = clip(100, 1000);
    sink.start(sound, 0);
    sink.start(sound, 0);
    expect(context.buffers).toHaveLength(1);
    expect(context.buffers[0]).toMatchObject({ channels: 1, length: 100, rate: 1000 });
    expect(context.buffers[0]!.data[0]![0]).toBe(0.5);
    expect(context.sources).toHaveLength(2);
  });

  it('plays an empty clip silently', () => {
    const context = new FakeContext();
    const sink = new WebAudioSink(context);
    const voice = sink.start(clip(0), 0);
    expect(context.sources).toHaveLength(0);
    expect(voice.startTime).toBeCloseTo(10 + START_LEAD_SECONDS);
  });

  it('clamps the volume', () => {
    const sink = new WebAudioSink(new FakeContext());
    sink.volume = 2;
    expect(sink.volume).toBe(1);
  });
});
