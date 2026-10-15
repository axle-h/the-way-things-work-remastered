// The desktop app's preload bridge (apps/desktop/src/preload.ts), exposed to the page as
// `window.twtwDesktop` through Electron's contextBridge. Types only: the web app uses it through
// `host.ts`, and the desktop app's disc chooser page uses it directly. Every call is a message to the
// main process, which checks it; the page gets no other access to the computer.

/** How the disc is supplied: a disc image file, or a folder (a CD in a drive, or a copy of one). */
export type DiscKind = 'iso' | 'directory';

/** The disc the app is set to use, for the chooser page. */
export interface DiscStatus {
  /** The disc last chosen, or `null` before the first choice. */
  readonly path: string | null;
  readonly kind: DiscKind | null;
  /** Why that disc cannot be used now (moved, unplugged…), or `null` if it is in use. */
  readonly problem: string | null;
}

/** What came of choosing a disc. On `opened` the main process then shows the app. */
export type ChooseDiscResult =
  | { readonly outcome: 'opened' }
  | { readonly outcome: 'cancelled' }
  | { readonly outcome: 'rejected'; readonly path: string; readonly reason: string };

export interface DesktopBridge {
  /** `process.platform` of the computer (`win32`, `darwin`, `linux`), for wording. */
  readonly platform: string;
  /** Puts a PNG picture on the system clipboard. */
  copyPng(png: Uint8Array): Promise<void>;
  /** Leaves the app for the disc chooser page. */
  changeDisc(): Promise<void>;
  /** The disc in use or last chosen (chooser page). */
  discStatus(): Promise<DiscStatus>;
  /** Asks for a disc image or folder with the system's file dialog, checks it and, if good, uses it. */
  chooseDisc(kind: DiscKind): Promise<ChooseDiscResult>;
  /** Back to the app with the disc in use (chooser page, when there is one). */
  openApp(): Promise<void>;
}

/** The global name the preload script gives the bridge. */
export const DESKTOP_BRIDGE_NAME = 'twtwDesktop';
