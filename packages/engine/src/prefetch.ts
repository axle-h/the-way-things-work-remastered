/**
 * Which disc files to fetch ahead of time so that the next tap feels instant: the
 * sounds and animations the pages on screen play when tapped, then
 * the pictures of the pages they can lead to, then those pages' sounds and animations. A presenter
 * fetches them in this order while nothing else happens; the engine itself never waits for them.
 */
import {
  mediaReferencedByPage,
  mediaReferencedByPanel,
  pagesReferencedByPage,
  pagesReferencedByPanel,
  resolveMedia,
  type MediaReference,
  type Page,
  type PageDatabase,
  type PageRef,
  type Panel,
} from '@twtw/formats';

/**
 * Disc paths to prefetch for the pages on screen (`shown`, base page first), most useful first,
 * each once. `alsoReachable` adds pages the presenter knows can come next (the Back target).
 * Pages that cannot be read are skipped; program resources (`@` names) are not files.
 */
export function filesToPrefetch(
  database: PageDatabase,
  shown: readonly PageRef[],
  alsoReachable: readonly PageRef[] = [],
): string[] {
  const paths = new PathList();
  const shownPages = shown.flatMap((ref) => readPage(database, ref));
  const shownRefs = new Set(shown);

  // What a tap on the pages on screen plays.
  for (const { page, panels } of shownPages) {
    paths.add(
      page,
      media(page, panels).filter((reference) => reference.kind !== 'bitmap'),
    );
  }

  // The pages they lead to, in the order their buttons and hotspots appear.
  const linked = new Map<PageRef, ReturnType<typeof readPage>[number]>();
  const reachable = [
    ...shownPages.flatMap(({ page, panels }) => [
      ...pagesReferencedByPage(page),
      ...panels.flatMap(pagesReferencedByPanel),
    ]),
    ...alsoReachable,
  ];
  for (const ref of reachable) {
    if (shownRefs.has(ref) || linked.has(ref)) continue;
    const [entry] = readPage(database, ref);
    if (entry !== undefined) linked.set(ref, entry);
  }
  const linkedMedia = [...linked.values()].map(({ page, panels }) => ({ page, all: media(page, panels) }));
  for (const kind of ['bitmap', 'wave', 'animation'] as const) {
    for (const { page, all } of linkedMedia) {
      paths.add(
        page,
        all.filter((reference) => reference.kind === kind),
      );
    }
  }
  return paths.list;
}

/** A page and its template's shared panels (navigation bar, frame). */
function readPage(database: PageDatabase, ref: PageRef): { page: Page; panels: Panel[] }[] {
  try {
    const page = database.getPage(ref);
    const template = database.templateFor(page);
    const panels = (template?.panels ?? []).flatMap((slot) =>
      slot.sharedPanel === null ? [] : [database.getSharedPanel(slot.sharedPanel, slot.panelType).panel],
    );
    return [{ page, panels }];
  } catch {
    return [];
  }
}

function media(page: Page, sharedPanels: readonly Panel[]): MediaReference[] {
  return [...mediaReferencedByPage(page), ...sharedPanels.flatMap(mediaReferencedByPanel)];
}

/** Paths in insertion order, each once (ignoring case). */
class PathList {
  readonly list: string[] = [];
  readonly #seen = new Set<string>();

  add(page: Page, references: readonly MediaReference[]): void {
    for (const reference of references) {
      const location = resolveMedia(page.directory, reference);
      if (location.kind !== 'file') continue;
      const key = location.path.toLowerCase();
      if (this.#seen.has(key)) continue;
      this.#seen.add(key);
      this.list.push(location.path);
    }
  }
}
