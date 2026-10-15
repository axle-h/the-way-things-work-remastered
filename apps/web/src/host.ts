// What the page needs from wherever it runs: a browser, or the desktop app,
// which runs this same build in Electron. The desktop app serves the disc at the same `/data/` URL
// from the user's own disc image, and offers the system clipboard and a way to choose another disc
// through its preload bridge (`desktop-bridge.ts`). Printing is `window.print()` in both: Electron
// shows the system print dialog for it, with the same print stylesheet.
import { DESKTOP_BRIDGE_NAME, type DesktopBridge } from './desktop-bridge.ts';

export interface Host {
  readonly kind: 'browser' | 'desktop';
  /** Base URL of the disc's files and their `manifest.json` (HttpDataSource). */
  readonly dataUrl: string;
  /**
   * Whether sound may start without a tap. Browsers start audio only from a user gesture, hence the
   * "tap to start" gate; the desktop app allows autoplay, so it starts at once, as the original did.
   */
  readonly autoplay: boolean;
  /** Puts a PNG on the system clipboard, in place of `navigator.clipboard`. */
  readonly writeClipboardPng: ((png: Uint8Array) => Promise<void>) | undefined;
  /** Lets the user choose another disc ("Change disc…" in the settings). */
  readonly changeDisc: (() => Promise<void>) | undefined;
  /** What to tell the user when the disc's files cannot be loaded. */
  readonly noDataMessage: string;
}

/** The browser: the disc extracted on the server under `/data/` (`pnpm data`). */
export const BROWSER_HOST: Host = {
  kind: 'browser',
  dataUrl: '/data/',
  autoplay: false,
  writeClipboardPng: undefined,
  changeDisc: undefined,
  noDataMessage: 'No disc data (run "pnpm data")',
};

/** The desktop app's host over its preload bridge. */
export function desktopHost(bridge: DesktopBridge): Host {
  return {
    kind: 'desktop',
    dataUrl: '/data/',
    autoplay: true,
    writeClipboardPng: (png) => bridge.copyPng(png),
    changeDisc: () => bridge.changeDisc(),
    noDataMessage: 'Cannot read the disc (Settings → Change disc…)',
  };
}

/** The host the page runs in: the desktop app if its bridge is there, else the browser. */
export function findHost(scope: object = globalThis): Host {
  const bridge = (scope as Record<string, unknown>)[DESKTOP_BRIDGE_NAME] as DesktopBridge | undefined;
  return bridge === undefined ? BROWSER_HOST : desktopHost(bridge);
}
