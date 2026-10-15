import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  parseSettings,
  saveSettings,
  SETTINGS_KEY,
  type StorageLike,
} from '../src/settings.ts';

function memoryStorage(): StorageLike & { items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
  };
}

describe('settings', () => {
  it('fills in defaults for missing or malformed values, and clamps the volume', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('not json')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('{"fill":true,"volume":3,"debug":"yes"}')).toEqual({
      fill: true,
      volume: 1,
      debug: false,
    });
    expect(parseSettings('{"volume":-1}', { ...DEFAULT_SETTINGS, debug: true })).toMatchObject({
      volume: 0,
      debug: true,
    });
  });

  it('round-trips through storage', () => {
    const storage = memoryStorage();
    saveSettings(() => storage, { fill: true, volume: 0.25, debug: true });
    expect(storage.items.has(SETTINGS_KEY)).toBe(true);
    expect(loadSettings(() => storage)).toEqual({ fill: true, volume: 0.25, debug: true });
  });

  it('works without storage, or with storage that throws', () => {
    const throwing = (): StorageLike => {
      throw new Error('SecurityError');
    };
    expect(loadSettings(throwing)).toEqual(DEFAULT_SETTINGS);
    expect(() => saveSettings(throwing, DEFAULT_SETTINGS)).not.toThrow();
    expect(loadSettings(() => null)).toEqual(DEFAULT_SETTINGS);
  });
});
