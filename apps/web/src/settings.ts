// The presentation settings: fill mode, volume and the debug overlay,
// remembered in this browser only. Storage can be missing or throw (private windows, blocked site
// data); the app then works with the defaults.

export interface Settings {
  /** Fill mode: non-integer nearest-neighbour scaling to fill more of the screen. */
  readonly fill: boolean;
  /** Output volume, 0 … 1. */
  readonly volume: number;
  /** The debug overlay: the pages on screen, loading problems and the stage scale. */
  readonly debug: boolean;
}

export const SETTINGS_KEY = 'twtw.settings';

export const DEFAULT_SETTINGS: Settings = { fill: false, volume: 1, debug: false };

/** The parts of `Storage` used. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Settings from stored JSON; anything missing or malformed takes its default. */
export function parseSettings(text: string | null, defaults: Settings = DEFAULT_SETTINGS): Settings {
  let stored: Record<string, unknown> = {};
  try {
    const parsed: unknown = text === null ? null : JSON.parse(text);
    if (typeof parsed === 'object' && parsed !== null) stored = parsed as Record<string, unknown>;
  } catch {
    // Not JSON: defaults.
  }
  const { fill, volume, debug } = stored;
  return {
    fill: typeof fill === 'boolean' ? fill : defaults.fill,
    volume:
      typeof volume === 'number' && Number.isFinite(volume)
        ? Math.min(1, Math.max(0, volume))
        : defaults.volume,
    debug: typeof debug === 'boolean' ? debug : defaults.debug,
  };
}

/** Reads the settings; `storage` may throw or give `null`. */
export function loadSettings(
  storage: () => StorageLike | null,
  defaults: Settings = DEFAULT_SETTINGS,
): Settings {
  try {
    return parseSettings(storage()?.getItem(SETTINGS_KEY) ?? null, defaults);
  } catch {
    return defaults;
  }
}

/** Stores the settings if storage works; otherwise they last until the page is closed. */
export function saveSettings(storage: () => StorageLike | null, settings: Settings): void {
  try {
    storage()?.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable or full.
  }
}
