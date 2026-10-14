// Action paths: a start base page plus clicks named by database object references, and their
// translation to client-area coordinates through our own parser.
import {
  HandlerEvent,
  type DisplayObject,
  type Page,
  type PageDatabase,
  type PageRef,
  type Panel,
  type Point,
  type Rect,
} from '@twtw/formats';
import { actionsFor } from './targets.ts';

/** One click: object number `object` (its position in the panel's object list, since object ids
 * repeat) of the panel with id `panel`, on page `page` (the base page or an open popup). */
export interface ActionStep {
  readonly page: PageRef;
  readonly panel: number;
  readonly object: number;
}

export interface ActionPath {
  /** The base page the original starts on (through the startup patch). */
  readonly start: PageRef;
  readonly steps: readonly ActionStep[];
}

/** What is on screen: the base page and the popups open over it, bottom first. */
export interface ScreenState {
  readonly base: PageRef;
  readonly popups: readonly PageRef[];
}

/** What the database says a click does. Animations and sounds leave the pages as they are. */
export type StepEffect =
  | { readonly kind: 'changePage'; readonly page: PageRef }
  | { readonly kind: 'openPage'; readonly page: PageRef }
  | { readonly kind: 'closePage'; readonly page: PageRef }
  /** A click on the base page while a popup is open closes the popup and does nothing else [V]. */
  | { readonly kind: 'closePopups' }
  | { readonly kind: 'none' };

export interface ResolvedStep {
  readonly step: ActionStep;
  readonly objectId: number;
  readonly objectKind: DisplayObject['kind'];
  /** The object's rectangle, relative to its panel. */
  readonly rect: Rect;
  /** Where the panel's (0,0) is, relative to the main window's client area. */
  readonly panelOrigin: Point;
  /** The point to click, relative to the client area. */
  readonly point: Point;
  /** False when no point of the rectangle avoids every other clickable object of the panel. */
  readonly clear: boolean;
  readonly effect: StepEffect;
  /** The screen state the database predicts after the click. */
  readonly after: ScreenState;
}

/**
 * How a popup's picture is placed, relative to the main window's client area, given the page's
 * origin. Under Wine the popup is a separate X window at client + (91, 1) + origin, with an 8-pixel
 * caption strip above the picture and a 4-pixel drop shadow right and below [V]
 * (docs/reference-environments.md).
 */
export type PopupPlacement = (origin: Point) => Point;

export const WINE_POPUP_PLACEMENT: PopupPlacement = ({ x, y }) => ({ x: x + 91, y: y + 9 });

export interface ResolveOptions {
  /** The client area size; click points are kept inside it. */
  readonly clientSize: { readonly width: number; readonly height: number };
  readonly popupPlacement?: PopupPlacement;
}

/** Parses a step written as `page:panel:object` (e.g. `1538:1:11`); page may be `0x` hex. */
export function parseStep(text: string): ActionStep {
  const match = /^(0x[0-9a-f]+|\d+):(\d+):(\d+)$/i.exec(text.trim());
  if (match === null) throw new Error(`a step is page:panel:object, not ${text}`);
  return { page: Number(match[1]), panel: Number(match[2]), object: Number(match[3]) };
}

export function formatStep(step: ActionStep): string {
  return `${step.page}:${step.panel}:${step.object}`;
}

/** A file-name-safe name for a path prefix, e.g. `path-1538_1538-1-11`. */
export function pathName(start: PageRef, steps: readonly ActionStep[]): string {
  return [`path-${start}`, ...steps.map((s) => `${s.page}-${s.panel}-${s.object}`)].join('_');
}

/** A panel of a page with its position relative to the page's picture (base: the client area). */
export interface LocatedPanel {
  readonly panel: Panel;
  readonly origin: Point;
}

/** The panels on screen for a page: its template's slots, filled by shared panels or the page's own. */
export function locatePanels(db: PageDatabase, page: Page): LocatedPanel[] {
  const template = db.templateFor(page);
  if (template === undefined)
    throw new Error(`page ${page.ref} names template ${page.templateId}, which is missing`);
  const located: LocatedPanel[] = [];
  let own = 0;
  for (const slot of template.panels) {
    const panel =
      slot.sharedPanel === null
        ? page.panels[own++]
        : db.getSharedPanel(slot.sharedPanel, slot.panelType).panel;
    if (panel === undefined)
      throw new Error(`page ${page.ref} has no panel for template slot ${slot.panelId}`);
    located.push({ panel, origin: { x: slot.x, y: slot.y } });
  }
  return located;
}

/**
 * Translates every step of a path to a client-area point and predicts the screen state after it.
 * Throws when a step names a page that is not on top, or an object that does not exist.
 */
export function resolvePath(db: PageDatabase, path: ActionPath, options: ResolveOptions): ResolvedStep[] {
  const placement = options.popupPlacement ?? WINE_POPUP_PLACEMENT;
  let state: ScreenState = { base: path.start, popups: [] };
  return path.steps.map((step) => {
    const top = state.popups.at(-1) ?? state.base;
    if (step.page !== top && step.page !== state.base) {
      throw new Error(
        `step ${formatStep(step)}: page ${step.page} is not on screen (base ${state.base}, top ${top})`,
      );
    }
    const page = db.getPage(step.page);
    const pictureOrigin = page.pageType === 'popup' ? placement(page.origin) : { x: 0, y: 0 };
    const panels = locatePanels(db, page);
    const located = panels.find((candidate) => candidate.panel.id === step.panel);
    if (located === undefined) {
      throw new Error(`step ${formatStep(step)}: page ${step.page} has no panel ${step.panel}`);
    }
    const object = located.panel.objects[step.object];
    if (object === undefined || object.rect === null) {
      throw new Error(
        `step ${formatStep(step)}: panel ${step.panel} has no object ${step.object} with a rectangle`,
      );
    }
    const panelOrigin = { x: pictureOrigin.x + located.origin.x, y: pictureOrigin.y + located.origin.y };
    const obstacles = located.panel.objects
      .filter((other, index) => index !== step.object && isClickable(other) && !sameBehaviour(other, object))
      .flatMap((other) => (other.rect === null ? [] : [other.rect]));
    const visible: Rect = {
      left: -panelOrigin.x,
      top: -panelOrigin.y,
      right: options.clientSize.width - panelOrigin.x,
      bottom: options.clientSize.height - panelOrigin.y,
    };
    const choice = clickPoint(object.rect, obstacles, visible);
    const covered = step.page === state.base && state.popups.length > 0;
    const effect: StepEffect = covered ? { kind: 'closePopups' } : clickEffect(located.panel, object);
    state = applyEffect(state, effect);
    return {
      step,
      objectId: object.id,
      objectKind: object.kind,
      rect: object.rect,
      panelOrigin,
      point: { x: panelOrigin.x + choice.point.x, y: panelOrigin.y + choice.point.y },
      clear: choice.clear,
      effect,
      after: state,
    };
  });
}

/** What clicking an object does according to the database (the first page action of its click handlers). */
export function clickEffect(panel: Panel, object: DisplayObject): StepEffect {
  if (panel.kind === 'navPanel' && object.kind === 'navHotspot') {
    // [H] each NavHotspot leads to the page listed for its id in the NavPanel.
    const page = panel.buttonPages[panel.buttonIds.indexOf(object.id)];
    if (page !== undefined && page !== null) return { kind: 'changePage', page };
  }
  if (!('handlers' in object)) return { kind: 'none' };
  for (const action of actionsFor(object.handlers, HandlerEvent.Click)) {
    if (
      (action.kind === 'changePage' || action.kind === 'openPage' || action.kind === 'closePage') &&
      action.page !== null
    ) {
      return { kind: action.kind, page: action.page };
    }
  }
  return { kind: 'none' };
}

export function applyEffect(state: ScreenState, effect: StepEffect): ScreenState {
  switch (effect.kind) {
    case 'changePage':
      return { base: effect.page, popups: [] };
    case 'openPage':
      return {
        base: state.base,
        popups: [...state.popups.filter((ref) => ref !== effect.page), effect.page],
      };
    case 'closePage':
      return { base: state.base, popups: state.popups.filter((ref) => ref !== effect.page) };
    case 'closePopups':
      return { base: state.base, popups: [] };
    case 'none':
      return state;
  }
}

/** The page whose capture directory a state belongs to: the top popup, or the base page. */
export function topPage(state: ScreenState): PageRef {
  return state.popups.at(-1) ?? state.base;
}

function isClickable(object: DisplayObject): boolean {
  if (object.kind === 'bitmap') return false;
  if (object.kind === 'scrollBar' || object.kind === 'scrollBitmap') return true;
  return object.handlers.length > 0 || object.kind !== 'hotspot';
}

function sameBehaviour(a: DisplayObject, b: DisplayObject): boolean {
  if (a.kind !== b.kind) return false;
  const behaviour = (object: DisplayObject) =>
    'handlers' in object ? JSON.stringify([object.handlers, 'file' in object ? object.file : null]) : '';
  return behaviour(a) === behaviour(b);
}

/**
 * A point inside `rect` (right and bottom exclusive) and `visible`, outside every obstacle,
 * as close to the centre as possible. Falls back to the centre (clipped to `visible`) with
 * `clear: false` when there is none.
 */
export function clickPoint(
  rect: Rect,
  obstacles: readonly Rect[],
  visible: Rect,
): { point: Point; clear: boolean } {
  const area: Rect = {
    left: Math.max(rect.left, visible.left),
    top: Math.max(rect.top, visible.top),
    right: Math.min(rect.right, visible.right),
    bottom: Math.min(rect.bottom, visible.bottom),
  };
  const centre = {
    x: Math.floor((rect.left + rect.right - 1) / 2),
    y: Math.floor((rect.top + rect.bottom - 1) / 2),
  };
  if (area.right <= area.left || area.bottom <= area.top) return { point: centre, clear: false };
  const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high - 1);
  const target = { x: clamp(centre.x, area.left, area.right), y: clamp(centre.y, area.top, area.bottom) };
  const free = (x: number, y: number) =>
    !obstacles.some((o) => x >= o.left && x < o.right && y >= o.top && y < o.bottom);
  if (free(target.x, target.y)) return { point: target, clear: true };
  let best: Point | null = null;
  let bestDistance = Infinity;
  for (let y = area.top; y < area.bottom; y++) {
    for (let x = area.left; x < area.right; x++) {
      const distance = (x - target.x) ** 2 + (y - target.y) ** 2;
      if (distance < bestDistance && free(x, y)) {
        best = { x, y };
        bestDistance = distance;
      }
    }
  }
  return best === null ? { point: target, clear: false } : { point: best, clear: true };
}
