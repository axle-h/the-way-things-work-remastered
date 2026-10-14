/**
 * Following references through the page database: which pages a page, panel or handler list can
 * lead to, and which media files they use.
 */
import type { DisplayObject, Handler, Page, PageRef, Panel, SharedPanel } from './model.ts';
import type { PageDatabase } from './parse.ts';

/** Page refs that a list of handlers can open, change to or close. */
export function pagesReferencedByHandlers(handlers: readonly Handler[]): PageRef[] {
  const refs: PageRef[] = [];
  for (const handler of handlers) {
    for (const action of handler.actions) {
      if (
        (action.kind === 'openPage' || action.kind === 'changePage' || action.kind === 'closePage') &&
        action.page !== null
      ) {
        refs.push(action.page);
      }
    }
  }
  return refs;
}

/** Page refs reachable from a panel: its objects' and its own handlers, dial letters and nav buttons. */
export function pagesReferencedByPanel(panel: Panel): PageRef[] {
  const refs: PageRef[] = [];
  for (const object of panel.objects) {
    if ('handlers' in object) refs.push(...pagesReferencedByHandlers(object.handlers));
  }
  refs.push(...pagesReferencedByHandlers(panel.handlers));
  if (panel.kind === 'azDial') refs.push(...nonNull(panel.letterPages));
  if (panel.kind === 'navPanel') refs.push(...nonNull(panel.buttonPages));
  return refs;
}

/** Page refs reachable from a page: its panels, its handlers and its link block. */
export function pagesReferencedByPage(page: Page): PageRef[] {
  const refs = page.panels.flatMap(pagesReferencedByPanel);
  refs.push(...pagesReferencedByHandlers(page.handlers));
  if (page.links !== null) refs.push(...nonNull(page.links));
  return refs;
}

export interface ReachableSet {
  /** Every page reachable from the product record, templates and A–Z index, by heap offset. */
  readonly pages: ReadonlyMap<PageRef, Page>;
  /** Every shared panel referenced by a template, by heap offset. */
  readonly sharedPanels: ReadonlyMap<PageRef, SharedPanel>;
}

/**
 * Parses every page and shared panel reachable from the database's roots: the startup page,
 * product and template handlers, templates' shared panels, and the A–Z index. Both maps are
 * ordered by heap offset.
 */
export function collectReachable(db: PageDatabase): ReachableSet {
  const pages = new Map<PageRef, Page>();
  const sharedPanels = new Map<PageRef, SharedPanel>();
  const pending: PageRef[] = [];

  const { product } = db;
  if (product.startupPage !== null) pending.push(product.startupPage);
  pending.push(...pagesReferencedByHandlers(product.handlers));
  for (const template of product.templates) {
    pending.push(...pagesReferencedByHandlers(template.handlers));
    for (const slot of template.panels) {
      if (slot.sharedPanel === null || sharedPanels.has(slot.sharedPanel)) continue;
      const shared = db.getSharedPanel(slot.sharedPanel, slot.panelType);
      sharedPanels.set(shared.ref, shared);
      pending.push(...pagesReferencedByPanel(shared.panel));
    }
  }
  for (const entry of db.index) {
    if (entry.page !== null) pending.push(entry.page);
    pending.push(...nonNull(entry.seeAlso));
  }

  for (let ref = pending.pop(); ref !== undefined; ref = pending.pop()) {
    if (pages.has(ref)) continue;
    const page = db.getPage(ref);
    pages.set(ref, page);
    pending.push(...pagesReferencedByPage(page));
  }

  return { pages: sortByKey(pages), sharedPanels: sortByKey(sharedPanels) };
}

// ---------------------------------------------------------------------------------------------
// Media

export type MediaKind = 'bitmap' | 'animation' | 'wave';

/** File extension the original appends for each kind of media reference. */
export const MEDIA_EXTENSIONS: Readonly<Record<MediaKind, string>> = {
  bitmap: '.DIB',
  animation: '.ANI',
  wave: '.WAV',
};

/** A media file name as stored in the database (no extension), and what kind of file it names. */
export interface MediaReference {
  readonly kind: MediaKind;
  readonly name: string;
}

/** Where a media reference points. */
export type MediaLocation =
  /** A file on the disc: path from the disc root with `/` separators, case as stored. */
  | { readonly kind: 'file'; readonly path: string }
  /** A bitmap resource in `TWTW.EXE`, by name (without the `@`). */
  | { readonly kind: 'resource'; readonly name: string };

/**
 * Resolves a media name the way the original does: page directory + name + extension. A name
 * containing `\` is relative to the disc root instead, and a name starting with `@` is a bitmap
 * resource in `TWTW.EXE`. The returned path keeps the stored case; look it up ignoring case.
 */
export function resolveMedia(directory: string | null, reference: MediaReference): MediaLocation {
  const { name } = reference;
  if (name.startsWith('@')) return { kind: 'resource', name: name.slice(1) };
  const base = name.includes('\\') ? '' : (directory ?? '');
  const parts = `${base}\\${name}`.split(/[\\/]+/).filter((part) => part !== '');
  return { kind: 'file', path: parts.join('/') + MEDIA_EXTENSIONS[reference.kind] };
}

/** Media referenced by one display object (including its handlers' actions). */
export function mediaReferencedByObject(object: DisplayObject): MediaReference[] {
  const refs: MediaReference[] = [];
  const add = (kind: MediaKind, name: string | null): void => {
    if (name !== null) refs.push({ kind, name });
  };
  switch (object.kind) {
    case 'bitmap':
    case 'scrollBitmap':
      add('bitmap', object.file);
      break;
    case 'scrollBar':
      for (const part of object.parts) add('bitmap', part);
      break;
    case 'animationControl':
    case 'navHotspot':
    case 'animHotspot':
    case 'azAnimHotspot':
      add('animation', object.file);
      break;
    case 'hotspot':
    case 'azHotspot':
    case 'wordBox':
    case 'cancelButton':
      break;
  }
  if ('handlers' in object) refs.push(...mediaReferencedByHandlers(object.handlers));
  return refs;
}

/** Media played by a list of handlers. */
export function mediaReferencedByHandlers(handlers: readonly Handler[]): MediaReference[] {
  const refs: MediaReference[] = [];
  for (const handler of handlers) {
    for (const action of handler.actions) {
      if (!('file' in action) || action.file === null) continue;
      refs.push({ kind: action.kind === 'playWave' ? 'wave' : 'animation', name: action.file });
    }
  }
  return refs;
}

/** Media referenced by a panel: its objects, its handlers and, for the A–Z dial, the letter animations. */
export function mediaReferencedByPanel(panel: Panel): MediaReference[] {
  const refs = panel.objects.flatMap(mediaReferencedByObject);
  refs.push(...mediaReferencedByHandlers(panel.handlers));
  if (panel.kind === 'azDial') {
    for (const name of nonNull(panel.letterAnimations)) refs.push({ kind: 'animation', name });
  }
  return refs;
}

/** Media referenced by a page; resolve them against `page.directory`. */
export function mediaReferencedByPage(page: Page): MediaReference[] {
  const refs = page.panels.flatMap(mediaReferencedByPanel);
  refs.push(...mediaReferencedByHandlers(page.handlers));
  return refs;
}

function nonNull<T>(values: readonly (T | null)[]): T[] {
  return values.filter((value): value is T => value !== null);
}

function sortByKey<V>(map: Map<number, V>): Map<number, V> {
  return new Map([...map].sort(([a], [b]) => a - b));
}
