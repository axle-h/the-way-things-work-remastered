/**
 * Corpus test: every base page can be reached from the title by
 * clicking. A breadth-first search over what is on screen starts at the startup page and clicks,
 * through the engine's own hit-testing and input, every object that can do something, in every
 * state it reaches. Animations end at once (no media yet), so pages that move on when their
 * animation ends do so.
 *
 * Pages reachable only through the A–Z index list (the Index page's list box) are not reached by
 * clicking page objects; the test derives that set from the database and expects exactly those to
 * be missing. special.corpus.test.ts goes to every Index entry. Also checks Back against what was observed under Wine (behaviour.md §6.3).
 * Only counts and page offsets are reported; nothing from the disc is stored.
 */
import {
  collectReachable,
  pagesReferencedByPage,
  pagesReferencedByPanel,
  type NavPanel,
  type Page,
  type PageDatabase,
  type PageRef,
} from '@twtw/formats';
import {
  Engine,
  SilentMedia,
  type Media,
  type PageInstance,
  type PageWindow,
  type PanelInstance,
} from '@twtw/engine';
import { beforeAll, expect, it } from 'vitest';
import { DirectoryDataSource } from '../src/index.ts';
import { describeIfAvailable, discRoot, missingDiscFile } from './disc.ts';

/**
 * Media that plays nothing (animations end at once) and remembers every page that leaves the
 * screen, so pages passed through on the way count too.
 */
function watchingMedia(): Media & { readonly shown: Set<PageRef> } {
  const silent = new SilentMedia();
  const shown = new Set<PageRef>();
  return {
    shown,
    isPlaying: () => silent.isPlaying(),
    stopAll: () => silent.stopAll(),
    runAction: () => {},
    playAnimation: (request, ended) => silent.playAnimation(request, ended),
    control: () => {},
    pageClosed: (page: PageInstance) => shown.add(page.ref),
  };
}

/** Object kinds whose click can lead somewhere; Bitmaps and WordBoxes only stop media. */
const ACTIVE_KINDS = new Set([
  'hotspot',
  'animHotspot',
  'navHotspot',
  'azHotspot',
  'cancelButton',
  'azAnimHotspot',
]);

interface Node {
  readonly base: PageRef;
  readonly popups: readonly PageRef[];
  /** The A–Z dial's letter on the base page. */
  readonly letter: number;
}

/** Popup states are keyed by their popups alone: what a popup's objects do does not depend on the base page. */
function keyOf(node: Node): string {
  return node.popups.length > 0 ? `P${node.popups.join(',')}` : `B${node.base}:${node.letter}`;
}

function nodeOf(engine: Engine): Node {
  const dial = engine.basePage!.panels.find((panel) => panel.dial !== null)?.dial;
  return {
    base: engine.basePage!.ref,
    popups: engine.windows.map((window) => window.page.ref),
    letter: dial?.letter ?? 0,
  };
}

async function click(engine: Engine, [x, y]: readonly [number, number]): Promise<void> {
  await engine.pointerDown(x, y);
  await engine.pointerUp(x, y);
  await engine.idle();
}

/**
 * A page point that clicks object `index` of `panel`: the hit-test finds it there and, as the
 * release is tested one pixel lower (behaviour.md §1.5), the row below is still inside it.
 */
function clickPoint(
  engine: Engine,
  window: PageWindow | null,
  panel: PanelInstance,
  index: number,
): [number, number] | null {
  const rect = panel.objects[index]!.rect;
  if (rect === null) return null;
  const originX = (window?.x ?? 0) + panel.x;
  const originY = (window === null ? 0 : window.y + window.caption) + panel.y;
  const candidates: [number, number][] = [
    [Math.floor((rect.left + rect.right) / 2), Math.floor((rect.top + rect.bottom) / 2)],
  ];
  for (let y = rect.top; y < rect.bottom; y += 2) {
    for (let x = rect.left; x <= rect.right; x += 2) candidates.push([x, y]);
  }
  for (const [x, y] of candidates) {
    if (y >= rect.bottom && panel.type === 'display') continue;
    const hit = engine.hitTest(originX + x, originY + y);
    if (hit !== null && hit.window === window && hit.panel === panel && hit.objectIndex === index) {
      return [originX + x, originY + y];
    }
  }
  return null;
}

/** Pages reachable in the database from the startup page without the A–Z index. */
function reachableWithoutIndex(db: PageDatabase): Set<PageRef> {
  const seen = new Set<PageRef>();
  const pending: PageRef[] = db.product.startupPage === null ? [] : [db.product.startupPage];
  for (let ref = pending.pop(); ref !== undefined; ref = pending.pop()) {
    if (seen.has(ref)) continue;
    seen.add(ref);
    const page = db.getPage(ref);
    pending.push(...pagesReferencedByPage(page));
    for (const slot of db.templateFor(page)?.panels ?? []) {
      if (slot.sharedPanel !== null) {
        pending.push(...pagesReferencedByPanel(db.getSharedPanel(slot.sharedPanel, slot.panelType).panel));
      }
    }
  }
  return seen;
}

describeIfAvailable('reaching every base page by clicking (disc)', missingDiscFile('DKCODE/TWTW.PNG'), () => {
  let source: DirectoryDataSource;
  let basePages: Page[];

  beforeAll(async () => {
    source = await DirectoryDataSource.open(discRoot);
  });

  it('reaches every base page from the title, except those only the A–Z index list leads to', async () => {
    const media = watchingMedia();
    const engine = await Engine.load(source, { media, cacheBytes: 1024 * 1024 * 1024 });
    const db = engine.content.database;
    basePages = [...collectReachable(db).pages.values()].filter((page) => page.pageType === 'base');
    expect(basePages).toHaveLength(397);

    const nodes = new Map<string, Node>();
    const queue: Node[] = [];
    const visit = (): void => {
      const node = nodeOf(engine);
      media.shown.add(node.base);
      for (const popup of node.popups) media.shown.add(popup);
      if (!nodes.has(keyOf(node))) {
        nodes.set(keyOf(node), node);
        queue.push(node);
      }
    };
    media.shown.add(db.product.startupPage!);
    visit();

    /** Puts the engine in a node's state: a direct start, the dial letter, then the popups. */
    const restore = async (node: Node): Promise<boolean> => {
      if (keyOf(nodeOf(engine)) === keyOf(node) && nodeOf(engine).base === node.base) return true;
      await engine.reset(node.base);
      if (node.letter !== 0) {
        const panel = engine.basePage!.panels.find((candidate) => candidate.dial !== null)!;
        const index = panel.objects.findIndex(
          ({ object }) => object.kind === 'azHotspot' && object.unknown2 === node.letter,
        );
        const point = clickPoint(engine, null, panel, index);
        if (point !== null) await click(engine, point);
      }
      for (const popup of node.popups) await engine.openPage(popup);
      return keyOf(nodeOf(engine)) === keyOf(node);
    };

    let clicks = 0;
    const unrestorable: string[] = [];
    for (let node = queue.shift(); node !== undefined; node = queue.shift()) {
      if (!(await restore(node))) {
        unrestorable.push(keyOf(node));
        continue;
      }
      const top = engine.windows.at(-1) ?? null;
      const page = top === null ? engine.basePage! : top.page;
      const targets: { panel: PanelInstance; index: number }[] = [];
      for (const panel of page.panels) {
        panel.objects.forEach(({ object }, index) => {
          if (ACTIVE_KINDS.has(object.kind)) targets.push({ panel, index });
        });
      }
      for (const { panel, index } of targets) {
        if (!(await restore(node))) break;
        const now = engine.windows.at(-1) ?? null;
        const nowPage = now === null ? engine.basePage! : now.page;
        const nowPanel = nowPage.panels[page.panels.indexOf(panel)]!;
        const point = clickPoint(engine, now, nowPanel, index);
        if (point === null) continue;
        await click(engine, point);
        clicks++;
        visit();
      }
    }

    const missing = basePages.filter((page) => !media.shown.has(page.ref)).map((page) => page.ref);
    const linked = reachableWithoutIndex(db);
    const indexOnly = basePages.filter((page) => !linked.has(page.ref)).map((page) => page.ref);
    // Popups and the index page, for information: some are reached only through the index list.
    const windows = [...collectReachable(db).pages.values()].filter((page) => page.pageType !== 'base');
    const windowsMissing = windows.filter((page) => !media.shown.has(page.ref)).map((page) => page.ref);
    const windowsIndexOnly = windows.filter((page) => !linked.has(page.ref)).map((page) => page.ref);
    console.info(
      `reachability: ${nodes.size} states, ${clicks} clicks, ` +
        `${basePages.length - missing.length} of ${basePages.length} base pages reached ` +
        `(not reached: ${missing.join(' ') || 'none'}; only in the A–Z index: ${indexOnly.join(' ') || 'none'}); ` +
        `${windows.length - windowsMissing.length} of ${windows.length} popup and index pages reached ` +
        `(not reached: ${windowsMissing.join(' ') || 'none'}; only in the A–Z index: ${windowsIndexOnly.join(' ') || 'none'})`,
    );
    expect(unrestorable).toEqual([]);
    expect(missing).toEqual(indexOnly);
    expect(windowsMissing).toEqual(windowsIndexOnly);
  }, 600_000);

  it('goes Back as observed under Wine, and does nothing without two entries', async () => {
    const engine = await Engine.load(source, { startPage: null, media: new SilentMedia() });
    const db = engine.content.database;
    const airplane = [...collectReachable(db).pages.values()].find(
      (page) => page.pageType === 'base' && page.directory?.toUpperCase() === '\\ARTICLE1\\AIRP\\',
    )!;
    await engine.reset(airplane.ref);
    const navPanel = engine.basePage!.panels.find((panel) => panel.type === 'navPanel')!.panel as NavPanel;
    const button = (k: number): [number, number] => {
      // Each page has its own instance of the shared nav bar.
      const nav = engine.basePage!.panels.find((panel) => panel.type === 'navPanel')!;
      const index = nav.objects.findIndex(({ object }) => object.id === navPanel.buttonIds[k]);
      return clickPoint(engine, null, nav, index)!;
    };
    const workshop = navPanel.buttonPages[0]!;
    const machines = navPanel.buttonPages[2]!;

    await click(engine, button(5));
    expect([engine.basePage!.ref, engine.busy]).toEqual([airplane.ref, false]);
    await click(engine, button(0));
    expect(engine.basePage!.ref).toBe(workshop);
    await click(engine, button(1)); // the Workshop has no page links
    expect(engine.basePage!.ref).toBe(machines);
    await click(engine, button(5));
    expect(engine.basePage!.ref).toBe(workshop);
    expect(engine.history).toEqual([workshop]);
    await click(engine, button(5));
    expect([engine.basePage!.ref, engine.busy]).toEqual([workshop, false]);
  });
});
