// Reference captures on disk (tools/refcapture/README.md, "Output"): one directory per page, each
// capture a PNG of the client area with a JSON sidecar. Only the sidecar fields the comparison
// uses are typed here.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PageRef, Rect } from '@twtw/formats';
import type { ClickStep, ScreenState } from './state.ts';

/** What refcapture predicted a click does, from the database (tools/refcapture). */
export type StepEffect =
  | { readonly kind: 'changePage' | 'openPage' | 'closePage'; readonly page: PageRef }
  | { readonly kind: 'closePopups' }
  | { readonly kind: 'none' };

export interface SidecarStep extends ClickStep {
  /** `page:panel:object`. */
  readonly step: string;
  /** What refcapture predicted the click does; informative only, the replay clicks for real. */
  readonly effect: StepEffect;
}

/** A top-level X window as refcapture records it. */
export interface XWindow {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Sidecar {
  readonly page: PageRef;
  readonly pageType: string;
  readonly directory: string | null;
  readonly image: string;
  readonly width: number;
  readonly height: number;
  readonly kind: 'startup' | 'path';
  readonly actionPath: { readonly start: PageRef; readonly steps: readonly SidecarStep[] };
  readonly expectedState: ScreenState;
  readonly autoAdvance: readonly PageRef[];
  readonly expectedSettledPage: PageRef;
  readonly settledDiffersFromRequested: boolean;
  readonly settle: {
    readonly settled: boolean;
    readonly timedOut: boolean;
    readonly cycleFrames?: number;
    readonly changingRect?: Rect | null;
  };
  readonly resizedFrom: { readonly width: number; readonly height: number } | null;
  /** The program's client size as Wine reported it (refcapture records it since the WM_STATE fix). */
  readonly wineClient?: { readonly width: number; readonly height: number } | null;
  /** The main window's client area on the X screen. */
  readonly clientRect?: Omit<XWindow, 'id'>;
  /** Other top-level X windows at capture time (popups), in X screen coordinates. */
  readonly otherWindows?: readonly XWindow[];
  /**
   * X window ids, as in `otherWindows`, of the popups whose picture Wine lost, so they show white
   * (refcapture README). Not positions in `expectedState.popups`.
   */
  readonly whitePopups?: readonly number[];
  readonly environment: { readonly kind: string; readonly palettePatch: boolean };
}

/**
 * The rectangles, in page coordinates (client-relative), of the X windows the sidecar lists in
 * `whitePopups`. Ids that name no window in `otherWindows` are left out.
 */
export function whitePopupRects(sidecar: Sidecar): Rect[] {
  const ids = new Set(sidecar.whitePopups ?? []);
  const client = sidecar.clientRect;
  if (ids.size === 0 || client === undefined) return [];
  return (sidecar.otherWindows ?? [])
    .filter((window) => ids.has(window.id))
    .map(({ x, y, width, height }) => ({
      left: x - client.x,
      top: y - client.y,
      right: x - client.x + width,
      bottom: y - client.y + height,
    }));
}

export interface Reference {
  /** `<page>/<name>`, e.g. `1188/path-1538_1538-1-13`. */
  readonly id: string;
  /** The directory the capture is in: the page on top according to the database. */
  readonly page: PageRef;
  /** File name without extension. */
  readonly name: string;
  readonly png: string;
  readonly sidecar: Sidecar;
}

/** Every capture under `root` with a readable sidecar and its PNG, ordered by page then name. */
export function listReferences(root: string): Reference[] {
  if (!existsSync(root)) return [];
  const references: Reference[] = [];
  const pages = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
    .map((entry) => Number(entry.name))
    .sort((a, b) => a - b);
  for (const page of pages) {
    const dir = join(root, String(page));
    for (const file of readdirSync(dir).sort()) {
      if (!file.endsWith('.json')) continue;
      const name = file.slice(0, -'.json'.length);
      let sidecar: Sidecar;
      try {
        sidecar = JSON.parse(readFileSync(join(dir, file), 'utf8')) as Sidecar;
      } catch {
        continue; // half-written; refcapture rewrites it on the next capture
      }
      const png = join(dir, sidecar.image);
      if (!existsSync(png)) continue;
      references.push({ id: `${page}/${name}`, page, name, png, sidecar });
    }
  }
  return references;
}

/**
 * Whether a capture matches a filter: a page number (`1538`: captures in that page's directory or
 * starting there), a capture name (`startup`, `path-*`), a page glob (`41*`), or a glob over the
 * id `<page>/<name>` (`1188/path-*`). Globs know `*` and `?`.
 */
export function matchesFilter(reference: Reference, filter: string): boolean {
  if (/^\d+$/.test(filter)) {
    const page = Number(filter);
    return reference.page === page || reference.sidecar.actionPath.start === page;
  }
  if (filter.includes('/')) return globToRegExp(filter).test(reference.id);
  // Without a slash: a page glob when it starts with a digit, otherwise a name (glob).
  return /^\d/.test(filter)
    ? globToRegExp(filter).test(String(reference.page))
    : globToRegExp(filter).test(reference.name);
}

function globToRegExp(glob: string): RegExp {
  const body = [...glob]
    .map((char) => (char === '*' ? '.*' : char === '?' ? '.' : char.replace(/[.+^${}()|[\]\\]/g, '\\$&')))
    .join('');
  return new RegExp(`^${body}$`);
}
