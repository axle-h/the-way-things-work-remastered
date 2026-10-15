// The settings menu: a gear button in a corner, outside the original's
// picture, opening a small panel with fill mode, volume, full screen, Copy and Print (wired
// in main.ts once the engine runs) and the debug overlay.
import type { Settings } from './settings.ts';
import { PORTRAIT_PHONE_MAX_WIDTH as PHONE_MAX_SHORT_SIDE } from './stage.ts';

export interface SettingsMenuElements {
  readonly button: HTMLButtonElement;
  readonly panel: HTMLElement;
  readonly backdrop: HTMLElement;
  readonly fill: HTMLInputElement;
  readonly volume: HTMLInputElement;
  readonly fullscreen: HTMLButtonElement;
  readonly fullscreenHint: HTMLElement;
  readonly debug: HTMLInputElement;
  readonly done: HTMLButtonElement;
}

/** Finds the menu's elements in index.html. */
export function findSettingsMenu(root: ParentNode = document): SettingsMenuElements {
  const get = <T extends Element>(selector: string): T => {
    const element = root.querySelector<T>(selector);
    if (element === null) throw new Error(`index.html is missing ${selector}`);
    return element;
  };
  return {
    button: get('#settings-button'),
    panel: get('#settings'),
    backdrop: get('#settings-backdrop'),
    fill: get('#setting-fill'),
    volume: get('#setting-volume'),
    fullscreen: get('#setting-fullscreen'),
    fullscreenHint: get('#fullscreen-hint'),
    debug: get('#setting-debug'),
    done: get('#settings-done'),
  };
}

/**
 * Wires the menu: shows `initial`, and calls `onChange` with the new settings on every change.
 * Returns whether the menu is open (for the keyboard: keys go to the menu then, not the engine),
 * and a way to close it.
 */
export function attachSettingsMenu(
  elements: SettingsMenuElements,
  initial: Settings,
  onChange: (settings: Settings) => void,
): { readonly isOpen: () => boolean; readonly close: () => void } {
  const { button, panel, backdrop, fill, volume, fullscreen, fullscreenHint, debug, done } = elements;
  let settings = initial;
  fill.checked = settings.fill;
  volume.value = String(Math.round(settings.volume * 100));
  debug.checked = settings.debug;

  const update = (change: Partial<Settings>): void => {
    settings = { ...settings, ...change };
    onChange(settings);
  };
  fill.addEventListener('change', () => update({ fill: fill.checked }));
  volume.addEventListener('input', () => update({ volume: Number(volume.value) / 100 }));
  debug.addEventListener('change', () => update({ debug: debug.checked }));

  const setOpen = (open: boolean): void => {
    panel.hidden = !open;
    backdrop.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    if (open) updateFullscreenButton();
    else button.blur();
  };
  button.addEventListener('click', () => setOpen(panel.hidden !== false));
  backdrop.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    setOpen(false);
  });
  done.addEventListener('click', () => setOpen(false));
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setOpen(false);
  });

  // Full screen where the browser has it; iPhone Safari has none, so the hint offers the
  // installed web app instead (docs/architecture.md, "Responsive input").
  const updateFullscreenButton = (): void => {
    const available = fullscreenAvailable();
    fullscreen.hidden = !available;
    fullscreenHint.hidden = available || isStandalone();
    fullscreen.textContent = fullscreenElement() === null ? 'Full screen' : 'Leave full screen';
  };
  fullscreen.addEventListener('click', () => {
    void toggleFullscreen().finally(updateFullscreenButton);
  });
  document.addEventListener('fullscreenchange', updateFullscreenButton);
  document.addEventListener('webkitfullscreenchange', updateFullscreenButton);
  updateFullscreenButton();

  return { isOpen: () => panel.hidden === false, close: () => setOpen(false) };
}

/** The prefixed Fullscreen API of older Safari (iPad). */
interface WebkitDocument {
  readonly webkitFullscreenEnabled?: boolean;
  readonly webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void;
}

interface WebkitElement {
  webkitRequestFullscreen?: () => void;
}

function fullscreenAvailable(): boolean {
  return document.fullscreenEnabled || (document as WebkitDocument).webkitFullscreenEnabled === true;
}

function fullscreenElement(): Element | null {
  return document.fullscreenElement ?? (document as WebkitDocument).webkitFullscreenElement ?? null;
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches ||
    (navigator as { standalone?: boolean }).standalone === true
  );
}

/** Enters or leaves full screen; entering also asks a phone to stay in landscape, where it can. */
export async function toggleFullscreen(): Promise<void> {
  const webkitDocument = document as WebkitDocument;
  try {
    if (fullscreenElement() !== null) {
      if (document.exitFullscreen !== undefined) await document.exitFullscreen();
      else webkitDocument.webkitExitFullscreen?.();
      return;
    }
    const root = document.documentElement;
    if (root.requestFullscreen !== undefined) await root.requestFullscreen({ navigationUI: 'hide' });
    else (root as WebkitElement).webkitRequestFullscreen?.();
    // Phones only: a tablet may be held either way.
    if (Math.min(screen.width, screen.height) < PHONE_MAX_SHORT_SIDE) {
      const orientation = screen.orientation as ScreenOrientation & {
        lock?: (type: string) => Promise<void>;
      };
      await orientation.lock?.('landscape').catch(() => {});
    }
  } catch (error) {
    console.warn('full screen:', error);
  }
}
