import { describe, expect, it } from 'vitest';
import { SettleTracker } from './settle.ts';

// 2×1 RGB frames.
const frame = (...values: number[]) => Uint8Array.from(values);
const a = frame(1, 1, 1, 2, 2, 2);
const b = frame(1, 1, 1, 9, 9, 9);
const c = frame(5, 5, 5, 2, 2, 2);

function run(tracker: SettleTracker, frames: [Uint8Array, number][]) {
  for (const [rgb, time] of frames) {
    const result = tracker.push(rgb, time);
    if (result !== null) return result;
  }
  return null;
}

describe('SettleTracker', () => {
  const options = { stableMs: 1000, timeoutMs: 5000, width: 2 };

  it('settles once nothing new appears for stableMs', () => {
    const tracker = new SettleTracker(options);
    const result = run(tracker, [
      [a, 0],
      [b, 100],
      [b, 600],
      [b, 1099],
      [b, 1100],
    ]);
    expect(result).toMatchObject({
      settled: true,
      timedOut: false,
      frames: 5,
      framesUntilStable: 2,
      changes: 1,
      msUntilStable: 100,
      elapsedMs: 1100,
      cycleFrames: 1,
      changingRect: null,
    });
    expect(tracker.settledFrame).toBe(b);
  });

  it('treats a screen cycling through known frames as settled and records the cycle', () => {
    const tracker = new SettleTracker(options);
    const result = run(tracker, [
      [a, 0],
      [b, 500],
      [a, 1000],
      [b, 1500],
      [a, 2000],
    ]);
    expect(result).toMatchObject({ settled: true, msUntilStable: 500, cycleFrames: 2 });
    expect(result!.changingRect).toEqual({ left: 1, top: 0, right: 2, bottom: 1 });
    // The kept frame is the last new one, whatever the cycle shows when waiting stops.
    expect(tracker.settledFrame).toBe(b);
  });

  it('keeps waiting while new frames appear, then times out with the last frame', () => {
    const tracker = new SettleTracker({ ...options, timeoutMs: 1500 });
    const frames: [Uint8Array, number][] = [0, 400, 800, 1200, 1600].map((time, i) => [
      frame(i, 0, 0, 0, 0, 0),
      time,
    ]);
    const result = run(tracker, frames);
    expect(result).toMatchObject({ settled: false, timedOut: true, frames: 5, changes: 4 });
    expect(tracker.last).toEqual(frame(4, 0, 0, 0, 0, 0));
  });

  it('does not count a long cycle as settled', () => {
    const tracker = new SettleTracker({ ...options, maxCycle: 2 });
    const frames: [Uint8Array, number][] = [];
    for (let i = 0; i < 14; i++) frames.push([[a, b, c][i % 3]!, i * 400]);
    expect(run(tracker, frames)).toMatchObject({ settled: false, timedOut: true });
  });
});
