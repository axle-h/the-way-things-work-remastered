// What to capture, worked out from the page database with our own parser: named pages, base pages,
// popups opened from a page, and pages that move on by themselves.
import {
  HandlerEvent,
  collectReachable,
  type Action,
  type DisplayObject,
  type Handler,
  type Page,
  type PageDatabase,
  type PageRef,
} from '@twtw/formats';

/** Display-object flag seen on the title animation and on the Principles intro pages [H]: start
 * the animation as soon as the page opens. */
export const FLAG_AUTOSTART = 0x20;

/** Named pages, for the command line and the acceptance set (PLAN Phase 2). */
export const PAGE_NAMES = ['title', 'workshop', 'az-machine', 'az-a', 'airplane'] as const;
export type PageName = (typeof PAGE_NAMES)[number];

/** The base pages of the database, by heap offset. */
export function basePages(db: PageDatabase): Page[] {
  return [...collectReachable(db).pages.values()].filter((page) => page.pageType === 'base');
}

/**
 * Resolves a page given on the command line: a heap offset (decimal or `0x` hex), one of
 * {@link PAGE_NAMES}, or a media directory such as `\ARTICLE1\AIRP\` (its single base page).
 */
export function resolvePage(db: PageDatabase, spec: string): PageRef {
  const trimmed = spec.trim();
  if (/^(0x[0-9a-f]+|\d+)$/i.test(trimmed)) {
    const ref = Number(trimmed);
    db.getPage(ref); // throws if it is not a page
    return ref;
  }
  if ((PAGE_NAMES as readonly string[]).includes(trimmed)) return namedPage(db, trimmed as PageName);
  if (trimmed.includes('\\') || trimmed.includes('/')) {
    const wanted = normaliseDirectory(trimmed);
    const matches = basePages(db).filter((page) => normaliseDirectory(page.directory ?? '') === wanted);
    if (matches.length === 1) return matches[0]!.ref;
    if (matches.length === 0) throw new Error(`no base page has the directory ${spec}`);
    throw new Error(
      `${matches.length} base pages have the directory ${spec}: ${matches.map((p) => p.ref).join(', ')}`,
    );
  }
  throw new Error(`unknown page ${spec}: give a heap offset, a directory or one of ${PAGE_NAMES.join(', ')}`);
}

/** The heap offset of a named page, found from the structure of the database. */
export function namedPage(db: PageDatabase, name: PageName): PageRef {
  switch (name) {
    case 'title': {
      if (db.product.startupPage === null) throw new Error('the database has no startup page');
      return db.product.startupPage;
    }
    case 'workshop':
      return resolvePage(db, '\\WORKSHOP\\');
    case 'az-machine':
      return azMachine(db).ref;
    case 'az-a': {
      const dial = azMachine(db).panels.find((panel) => panel.kind === 'azDial');
      const first = dial?.kind === 'azDial' ? dial.letterPages[0] : null;
      if (first === null || first === undefined) throw new Error('the A–Z dial has no page for A');
      return first;
    }
    case 'airplane':
      return resolvePage(db, '\\ARTICLE1\\AIRP\\');
  }
}

function azMachine(db: PageDatabase): Page {
  const pages = basePages(db).filter((page) => page.panels.some((panel) => panel.kind === 'azDial'));
  if (pages.length !== 1) throw new Error(`expected one page with an A–Z dial, found ${pages.length}`);
  return pages[0]!;
}

function normaliseDirectory(directory: string): string {
  const parts = directory.split(/[\\/]+/).filter((part) => part !== '');
  return parts.join('\\').toUpperCase();
}

/** The actions a list of handlers runs for one event. */
export function actionsFor(handlers: readonly Handler[], event: number): Action[] {
  return handlers.filter((handler) => handler.event === event).flatMap((handler) => handler.actions);
}

/**
 * Pages a page moves on to by itself: an object with the autostart flag whose `finished` handler
 * changes page. Follows the chain (the title animation → still title; the third title page → the
 * Workshop), stopping at a page that does not move on or at a cycle. Empty for most pages.
 */
export function autoAdvanceChain(db: PageDatabase, start: PageRef, limit = 8): PageRef[] {
  const chain: PageRef[] = [];
  const seen = new Set<PageRef>([start]);
  let current = start;
  while (chain.length < limit) {
    const next = autoAdvanceTarget(db.getPage(current));
    if (next === null || seen.has(next)) break;
    chain.push(next);
    seen.add(next);
    current = next;
  }
  return chain;
}

function autoAdvanceTarget(page: Page): PageRef | null {
  for (const panel of page.panels) {
    for (const object of panel.objects) {
      if (!('flags' in object) || (object.flags & FLAG_AUTOSTART) === 0) continue;
      for (const action of actionsFor(object.handlers, HandlerEvent.Finished)) {
        if (action.kind === 'changePage' && action.page !== null) return action.page;
      }
    }
  }
  return null;
}

/** A clickable object of a page's own panels that opens a popup. */
export interface PopupOpener {
  readonly popup: PageRef;
  readonly panel: number;
  /** Position of the object in its panel's object list. */
  readonly object: number;
}

/**
 * The popups a page opens when its objects are clicked (first opener of each popup, in object
 * order). Only the page's own panels are searched, not the shared navigation bar.
 */
export function popupOpeners(page: Page): PopupOpener[] {
  const openers = new Map<PageRef, PopupOpener>();
  for (const panel of page.panels) {
    panel.objects.forEach((object: DisplayObject, index) => {
      if (!('handlers' in object)) return;
      for (const action of actionsFor(object.handlers, HandlerEvent.Click)) {
        if (action.kind === 'openPage' && action.page !== null && !openers.has(action.page)) {
          openers.set(action.page, { popup: action.page, panel: panel.id, object: index });
        }
      }
    });
  }
  return [...openers.values()];
}
