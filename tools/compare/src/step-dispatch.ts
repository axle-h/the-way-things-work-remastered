/**
 * Stand-in for input dispatch, until the engine has its own (Phase 4).
 *
 * A reference capture's action path is a start page plus clicks named by database object
 * references (`page:panel:object`). The engine cannot take clicks yet, so this module reads what
 * the clicked object does from the database (its click handlers' page actions, or the NavPanel's
 * button table) and turns it into the engine's state operations. Animations, sounds and messages
 * leave the pages as they are. Phase 4 replaces this module with real hit-testing and dispatch:
 * a click at the step's point, through the engine.
 */
import {
  HandlerEvent,
  type Action,
  type DisplayObject,
  type PageDatabase,
  type PageRef,
  type Panel,
} from '@twtw/formats';
import type { Engine } from '@twtw/engine';

/** One click: object number `object` of panel `panel` on page `page`. */
export interface ClickStep {
  readonly page: PageRef;
  readonly panel: number;
  /** The object's position in the panel's object list (object ids repeat). */
  readonly object: number;
}

/** What is on screen: the base page and the popups open over it, bottom first. */
export interface ScreenState {
  readonly base: PageRef;
  readonly popups: readonly PageRef[];
}

/** What a click does to the pages on screen; the kinds follow the database's page actions. */
export type StepEffect =
  /** A base page replaces the base page; a popup page replaces the page in the top popup window. */
  | { readonly kind: 'changePage'; readonly page: PageRef }
  | { readonly kind: 'openPage'; readonly page: PageRef }
  | { readonly kind: 'closePage'; readonly page: PageRef }
  /** A click on the base page while a popup is open only closes the popups [V under Wine]. */
  | { readonly kind: 'closePopups' }
  | { readonly kind: 'none' };

/** The effect of clicking `step` with `state` on screen. Throws when the step is not on screen. */
export function stepEffect(db: PageDatabase, state: ScreenState, step: ClickStep): StepEffect {
  const top = state.popups.at(-1) ?? state.base;
  if (step.page !== top && step.page !== state.base) {
    throw new Error(`step ${formatClickStep(step)}: page ${step.page} is not on screen`);
  }
  const panel = findPanel(db, step.page, step.panel);
  const object = panel?.objects[step.object];
  if (panel === undefined || object === undefined) {
    throw new Error(`step ${formatClickStep(step)}: no such object`);
  }
  if (step.page === state.base && state.popups.length > 0) return { kind: 'closePopups' };
  return clickEffect(panel, object);
}

/** The first page action a click on the object runs, or the NavPanel button's page. */
export function clickEffect(panel: Panel, object: DisplayObject): StepEffect {
  if (panel.kind === 'navPanel' && object.kind === 'navHotspot') {
    const page = panel.buttonPages[panel.buttonIds.indexOf(object.id)];
    if (page !== undefined && page !== null) return { kind: 'changePage', page };
  }
  if (!('handlers' in object)) return { kind: 'none' };
  const actions: Action[] = object.handlers
    .filter((handler) => handler.event === HandlerEvent.Click)
    .flatMap((handler) => handler.actions);
  for (const action of actions) {
    if (
      (action.kind === 'changePage' || action.kind === 'openPage' || action.kind === 'closePage') &&
      action.page !== null
    ) {
      return { kind: action.kind, page: action.page };
    }
  }
  return { kind: 'none' };
}

/**
 * The state after an effect. ChangePage to a base page closes every popup: the Wine capture of a
 * popup's ChangePage to a base page shows no popup (reported for the spec; rendering.md §7.7
 * leaves it open).
 */
export function nextState(db: PageDatabase, state: ScreenState, effect: StepEffect): ScreenState {
  switch (effect.kind) {
    case 'changePage':
      if (db.getPage(effect.page).pageType === 'base') return { base: effect.page, popups: [] };
      return { base: state.base, popups: [...state.popups.slice(0, -1), effect.page] };
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

/** Applies an effect to the engine with its state operations. */
export async function applyEffect(engine: Engine, effect: StepEffect): Promise<void> {
  switch (effect.kind) {
    case 'changePage':
      if (engine.content.database.getPage(effect.page).pageType === 'base') closeAll(engine);
      await engine.changePage(effect.page);
      return;
    case 'openPage':
      engine.closePopup(effect.page);
      await engine.openPopup(effect.page);
      return;
    case 'closePage':
      engine.closePopup(effect.page);
      return;
    case 'closePopups':
      closeAll(engine);
      return;
    case 'none':
      return;
  }
}

/** Puts the engine in `state`: the base page and its popups, opened bottom first. */
export async function showState(engine: Engine, state: ScreenState): Promise<void> {
  closeAll(engine);
  await engine.changePage(state.base);
  for (const popup of state.popups) await engine.openPopup(popup);
}

/** The engine's current state, in the same terms. */
export function engineState(engine: Engine): ScreenState | null {
  const base = engine.basePage;
  if (base === null) return null;
  return { base: base.ref, popups: engine.windows.map((window) => window.page.ref) };
}

export function sameState(a: ScreenState, b: ScreenState): boolean {
  return (
    a.base === b.base &&
    a.popups.length === b.popups.length &&
    a.popups.every((ref, i) => ref === b.popups[i])
  );
}

export function sameEffect(a: StepEffect, b: StepEffect): boolean {
  return a.kind === b.kind && ('page' in a ? a.page : null) === ('page' in b ? b.page : null);
}

export function formatClickStep(step: ClickStep): string {
  return `${step.page}:${step.panel}:${step.object}`;
}

function closeAll(engine: Engine): void {
  while (engine.closePopup()) {
    // close the top window until none is left
  }
}

/** A panel of a page by id: one of the page's own, or a shared panel its template supplies. */
function findPanel(db: PageDatabase, ref: PageRef, panelId: number): Panel | undefined {
  const page = db.getPage(ref);
  const own = page.panels.find((panel) => panel.id === panelId);
  if (own !== undefined) return own;
  const slot = db.templateFor(page)?.panels.find((candidate) => candidate.panelId === panelId);
  if (slot === undefined || slot.sharedPanel === null) return undefined;
  return db.getSharedPanel(slot.sharedPanel, slot.panelType).panel;
}
