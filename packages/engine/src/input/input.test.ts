import { describe, expect, it } from 'vitest';
import { cursorForName, CURSOR_GROUPS } from './cursor.ts';
import { DoubleClickDetector } from './double-click.ts';

describe('DoubleClickDetector (behaviour.md §1.7)', () => {
  it('detects a second press within 500 ms and 2 pixels of the first', () => {
    const detector = new DoubleClickDetector();
    expect(detector.press(100, 100, 0)).toBe(false);
    expect(detector.press(102, 98, 500)).toBe(true);
    // The press after a double click starts afresh.
    expect(detector.press(102, 98, 600)).toBe(false);
  });

  it('does not count presses too late or too far apart', () => {
    const detector = new DoubleClickDetector();
    detector.press(100, 100, 0);
    expect(detector.press(100, 100, 501)).toBe(false);
    expect(detector.press(103, 100, 600)).toBe(false);
    expect(detector.press(103, 100, 700)).toBe(true);
  });

  it('forgets the last press on reset', () => {
    const detector = new DoubleClickDetector();
    detector.press(0, 0, 0);
    detector.reset();
    expect(detector.press(0, 0, 10)).toBe(false);
  });
});

describe('cursorForName (behaviour.md §8)', () => {
  it('maps the database names ignoring case', () => {
    expect(['Arrow', 'normal', 'NORMAL', 'Hand', 'hand'].map(cursorForName)).toEqual([
      'arrow',
      'arrow',
      'arrow',
      'hand',
      'hand',
    ]);
    expect(CURSOR_GROUPS).toEqual({ arrow: 157, hand: 107 });
  });

  it('gives null for an empty or unknown name', () => {
    expect([null, '', 'Gizmo'].map(cursorForName)).toEqual([null, null, null]);
  });
});
