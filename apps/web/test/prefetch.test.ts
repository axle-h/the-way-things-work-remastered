import { describe, expect, it } from 'vitest';
import { Prefetcher, type PrefetchSource } from '../src/prefetch.ts';

/** A source whose fetches finish when the test says so. */
function fakeSource(sizes: Record<string, number>) {
  const started: string[] = [];
  const finish: (() => void)[] = [];
  const source: PrefetchSource = {
    sizeOf: (path) => sizes[path],
    prefetch: (path) => {
      started.push(path);
      return new Promise((resolve) => finish.push(() => resolve(true)));
    },
  };
  const finishAll = async (): Promise<void> => {
    while (finish.length > 0) {
      finish.shift()!();
      await Promise.resolve();
      await Promise.resolve();
    }
  };
  return { source, started, finishAll };
}

describe('Prefetcher', () => {
  it('fetches in order, a few at a time, skipping missing and too large files', async () => {
    const { source, started, finishAll } = fakeSource({ A: 10, B: 10, BIG: 5000, C: 10 });
    const prefetcher = new Prefetcher(source, { concurrency: 2, maxFileBytes: 100 });
    prefetcher.request(['A', 'MISSING', 'BIG', 'B', 'C']);
    expect(started).toEqual(['A', 'B']);
    await finishAll();
    await prefetcher.idle();
    expect(started).toEqual(['A', 'B', 'C']);
  });

  it('stops at the byte budget for one list', () => {
    const { source, started } = fakeSource({ A: 60, B: 60, C: 10 });
    new Prefetcher(source, { concurrency: 5, roundBytes: 100 }).request(['A', 'B', 'C']);
    expect(started).toEqual(['A']);
  });

  it('replaces the queue on a new list, without asking twice for a file in flight', async () => {
    const { source, started, finishAll } = fakeSource({ A: 1, B: 1, C: 1, D: 1 });
    const prefetcher = new Prefetcher(source, { concurrency: 1 });
    prefetcher.request(['A', 'B', 'C']);
    prefetcher.request(['D', 'A']);
    await finishAll();
    await prefetcher.idle();
    expect(started).toEqual(['A', 'D']);
  });

  it('does not retry a file that failed', async () => {
    const started: string[] = [];
    const source: PrefetchSource = {
      sizeOf: () => 1,
      prefetch: (path) => (started.push(path), Promise.resolve(path !== 'BAD')),
    };
    const prefetcher = new Prefetcher(source);
    prefetcher.request(['BAD', 'GOOD']);
    await prefetcher.idle();
    prefetcher.request(['BAD', 'GOOD']);
    await prefetcher.idle();
    expect(started).toEqual(['BAD', 'GOOD', 'GOOD']);
  });
});
