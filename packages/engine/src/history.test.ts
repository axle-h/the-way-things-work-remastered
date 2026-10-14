import { describe, expect, it } from 'vitest';
import { History, HISTORY_LIMIT } from './history.ts';

describe('History (behaviour.md §6.3)', () => {
  it('records pages, not twice in a row', () => {
    const history = new History();
    for (const ref of [1, 1, 2, 1]) history.push(ref);
    expect(history.entries).toEqual([1, 2, 1]);
  });

  it('keeps at most 32 entries, dropping the oldest', () => {
    const history = new History();
    for (let i = 0; i < 40; i++) history.push(i);
    expect(HISTORY_LIMIT).toBe(32);
    expect(history.entries).toHaveLength(32);
    expect(history.entries[0]).toBe(8);
  });

  it('Back pops the current page and the one below, which it returns', () => {
    const history = new History();
    for (const ref of [1, 2, 3]) history.push(ref);
    expect(history.back()).toBe(2);
    expect(history.entries).toEqual([1]);
    expect(history.back()).toBeNull();
    expect(history.entries).toEqual([1]);
    history.clear();
    expect(history.back()).toBeNull();
  });
});
