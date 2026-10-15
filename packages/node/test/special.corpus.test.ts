/**
 * Corpus tests for the special screens (special-screens.md) and the Phase 6 coverage criterion:
 * every type the disc uses is implemented; the Index page renders and every one of its entries
 * goes to its target and opens its companion pages; the six scrolling Help pages scroll through
 * their whole range. Only counts, positions and page offsets are asserted; nothing from the disc
 * is stored in the repository.
 */
import {
  collectReachable,
  readBitmapResource,
  type Action,
  type Handler,
  type Page,
  type PageRef,
  type Panel,
} from '@twtw/formats';
import {
  ACTION_TYPE_SUPPORT,
  createFramebuffer,
  Engine,
  EVENT_SUPPORT,
  INDEX_CONTROLS,
  INDEX_ROW_HEIGHT,
  OBJECT_TYPE_SUPPORT,
  PAGE_TYPE_SUPPORT,
  PANEL_TYPE_SUPPORT,
  ProgramBitmap,
  stalledAutostartMedia,
  StaticColour,
  TEMPLATE_FIELD_SUPPORT,
  templateFieldInUse,
  type EngineEvent,
  type PageWindow,
  type PlacedObject,
} from '@twtw/engine';
import { beforeAll, expect, it } from 'vitest';
import { DirectoryDataSource } from '../src/index.ts';
import { describeIfAvailable, discRoot, missingDiscFile } from './disc.ts';

describeIfAvailable('special screens and type coverage (disc)', missingDiscFile('DKCODE/TWTW.PNG'), () => {
  let source: DirectoryDataSource;
  let pages: Page[];
  let engine: Engine;
  let events: EngineEvent[];

  beforeAll(async () => {
    source = await DirectoryDataSource.open(discRoot);
    // Pages that move on when their autostart animation ends stay put, so each target can be checked.
    engine = await Engine.load(source, { media: stalledAutostartMedia(), cacheBytes: 1024 * 1024 * 1024 });
    pages = [...collectReachable(engine.content.database).pages.values()];
    events = [];
    engine.on((event) => events.push(event));
  });

  it('implements every page, panel, object, action and event type on the disc (special-screens.md §8)', () => {
    const db = engine.content.database;
    const panels: Panel[] = pages.flatMap((page) => page.panels);
    for (const template of db.product.templates) {
      for (const slot of template.panels) {
        if (slot.sharedPanel !== null) panels.push(db.getSharedPanel(slot.sharedPanel, slot.panelType).panel);
      }
    }
    const handlers: Handler[] = [
      ...db.product.handlers,
      ...db.product.templates.flatMap((template) => template.handlers),
      ...pages.flatMap((page) => page.handlers),
      ...panels.flatMap((panel) => panel.handlers),
      ...panels.flatMap((panel) =>
        panel.objects.flatMap((object) => ('handlers' in object ? object.handlers : [])),
      ),
    ];
    const actions: Action[] = handlers.flatMap((handler) => handler.actions);
    const used = {
      pages: new Set(pages.map((page) => page.pageType)),
      panels: new Set(panels.map((panel) => panel.kind)),
      objects: new Set(panels.flatMap((panel) => panel.objects.map((object) => object.kind))),
      actions: new Set(actions.map((action) => action.kind)),
      events: new Set(handlers.map((handler) => handler.event)),
    };
    const notImplemented = [
      ...[...used.pages].filter((type) => PAGE_TYPE_SUPPORT[type].support !== 'implemented'),
      ...[...used.panels].filter((type) => PANEL_TYPE_SUPPORT[type].support !== 'implemented'),
      ...[...used.objects].filter((type) => OBJECT_TYPE_SUPPORT[type].support !== 'implemented'),
      ...[...used.actions].filter((type) => ACTION_TYPE_SUPPORT[type].support !== 'implemented'),
      ...[...used.events].filter((event) => EVENT_SUPPORT[event]?.support !== 'implemented'),
    ];
    expect(notImplemented).toEqual([]);
    expect([...used.events].toSorted()).toEqual([1, 4, 6]);
    // No page has a transition on its ChangePage (special-screens.md §6).
    expect(actions.filter((action) => action.kind === 'changePage' && action.unknown1 !== 0)).toEqual([]);

    // Template fields the engine drops are unused by the templates pages use, unless they have no effect.
    const usedTemplates = new Set(pages.map((page) => page.templateId));
    const droppedInUse: string[] = [];
    for (const template of db.product.templates.filter((candidate) => usedTemplates.has(candidate.id))) {
      const fields: Record<string, unknown> = { ...template, size: template.width + template.height };
      for (const [field, support] of Object.entries(TEMPLATE_FIELD_SUPPORT)) {
        if (support.support === 'dropped' && support.noEffect !== true && templateFieldInUse(fields[field])) {
          droppedInUse.push(`template ${template.id}: ${field}`);
        }
      }
    }
    expect(droppedInUse).toEqual([]);
  });

  /** The Index page: the only page of type 103. */
  const indexPage = (): Page => {
    const found = pages.filter((page) => page.pageType === 'index');
    expect(found).toHaveLength(1);
    return found[0]!;
  };

  async function openIndex(): Promise<PageWindow> {
    if (engine.indexScreen === null) expect(await engine.openPage(indexPage().ref)).toBe(true);
    return engine.windows.findLast((window) => window.page.ref === indexPage().ref)!;
  }

  it('renders the Index with its controls in place (special-screens.md §1.2)', async () => {
    await engine.reset(engine.content.database.product.startupPage!);
    const window = await openIndex();
    expect([window.x, window.y, window.page.width, window.page.height]).toEqual([182, 46, 363, 360]);
    const screen = engine.indexScreen!;
    expect(screen.count).toBe(1857);
    expect([screen.selection, screen.top, screen.focus]).toEqual([0, 0, 'edit']);
    expect(screen.editText).toBe(engine.content.database.index[0]!.name);

    const framebuffer = createFramebuffer();
    engine.render(framebuffer);
    const at = (x: number, y: number) =>
      framebuffer.pixels[(window.y + window.caption + y) * framebuffer.width + window.x + x]!;
    const list = INDEX_CONTROLS.list;
    const rows = (from: number, to: number) => {
      const colours = new Set<number>();
      for (let y = list.y + from; y < list.y + to; y++) {
        for (let x = list.x; x < list.x + list.width; x++) colours.add(at(x, y));
      }
      return [...colours].toSorted((a, b) => a - b);
    };
    expect(rows(0, INDEX_ROW_HEIGHT)).toEqual([StaticColour.navy, StaticColour.white]);
    expect(rows(INDEX_ROW_HEIGHT, list.height)).toEqual([StaticColour.black, StaticColour.white]);
    // The buttons are the program's bitmaps.
    for (const [id, control] of [
      [ProgramBitmap.ok, INDEX_CONTROLS.ok],
      [ProgramBitmap.cancel, INDEX_CONTROLS.cancel],
    ] as const) {
      const bitmap = readBitmapResource(engine.content.program, id);
      expect([bitmap.width, bitmap.height]).toEqual([control.width, control.height]);
      for (let y = 0; y < control.height; y++) {
        for (let x = 0; x < control.width; x++) {
          expect(at(control.x + x, control.y + y)).toBe(bitmap.indices[y * bitmap.width + x]);
        }
      }
    }
  });

  it('goes from every Index entry to its target, then opens its companion pages (§1.10)', async () => {
    const db = engine.content.database;
    const indexRef = indexPage().ref;
    await engine.reset(db.product.startupPage!);
    events.length = 0;
    const failures: string[] = [];
    const problems = new Set<string>();
    let companions = 0;
    for (let entry = 0; entry < db.index.length; entry++) {
      await openIndex();
      engine.indexScreen!.selectEntry(entry);
      expect(engine.key({ key: 'Enter' })).toBe(true);
      await engine.idle();
      // What "go to a page" does for the target and then each companion page (behaviour.md §6.1).
      const { page, seeAlso } = db.index[entry]!;
      let base: PageRef | null = engine.basePage!.ref;
      let popups: PageRef[] = [];
      for (const ref of [page, ...seeAlso]) {
        if (ref === null) continue;
        if (db.getPage(ref).pageType === 'base') {
          base = ref;
          popups = [];
        } else if (!popups.includes(ref)) {
          popups.push(ref);
          companions++;
        }
      }
      const shown = [engine.basePage!.ref, ...engine.windows.map((window) => window.page.ref)];
      if (shown.join() !== [base, ...popups].join() || engine.indexScreen !== null) {
        failures.push(`entry ${entry}: expected ${[base, ...popups].join(' ')}, shows ${shown.join(' ')}`);
      }
      for (const instance of [engine.basePage!, ...engine.windows.map((window) => window.page)]) {
        for (const problem of instance.problems) problems.add(`${instance.ref}: ${problem}`);
      }
      // Back to an ordinary state for the next entry.
      for (const window of [...engine.windows].reverse()) await engine.closePage(window.page.ref);
    }
    expect(failures).toEqual([]);
    expect(events.filter((event) => event.kind === 'error' || event.kind === 'actionFailed')).toEqual([]);
    expect([...problems]).toEqual([]);
    expect(companions).toBeGreaterThan(1500);
    expect(engine.windows.some((window) => window.page.ref === indexRef)).toBe(false);
  }, 600_000);

  it('scrolls the six scrolling Help pages through their full range (§3)', async () => {
    const db = engine.content.database;
    await engine.reset(db.product.startupPage!);
    const helpPages = pages.filter((page) =>
      page.panels.some((panel) => panel.objects.some((object) => object.kind === 'scrollBar')),
    );
    expect(helpPages).toHaveLength(6);
    const ranges: [number, number][] = [];
    for (const page of helpPages) {
      expect(await engine.openPage(page.ref)).toBe(true);
      const window = engine.windows.at(-1)!;
      const panel = window.page.panels[0]!;
      const placed = (kind: string): PlacedObject =>
        panel.objects.find(({ object }) => object.kind === kind)!;
      const bar = placed('scrollBar');
      const bitmap = placed('scrollBitmap');
      if (bar.look?.kind !== 'scrollBar' || bitmap.look?.kind !== 'scrollBitmap' || bar.rect === null) {
        throw new Error(`page ${page.ref}: no linked scroll bar`);
      }
      const { scroll } = bar.look;
      expect(bitmap.look.scroll).toBe(scroll);
      ranges.push([scroll.max, scroll.page]);
      const origin = { x: window.x + panel.x, y: window.y + window.caption + panel.y };
      const clickBar = async (y: number): Promise<void> => {
        const x = origin.x + bar.rect!.left + 8;
        await engine.pointerDown(x, origin.y + y);
        await engine.pointerUp(x, origin.y + y);
      };
      // Line down to the end, one step per click; then page up to the start.
      for (let step = 1; step <= scroll.max + 2; step++) {
        await clickBar(bar.rect.bottom - 4);
        expect(scroll.position).toBe(Math.min(step, scroll.max));
      }
      if (scroll.max > 0) {
        // The last position shows the picture's bottom exactly.
        const picture = bitmap.look.picture!;
        const view = bitmap.rect!.bottom - bitmap.rect!.top;
        expect(scroll.distance).toBe(picture.height - view);
      }
      let previous = scroll.position;
      while (scroll.position > 0) {
        await clickBar(bar.rect.top + 17);
        expect(scroll.position).toBe(Math.max(0, previous - scroll.page));
        previous = scroll.position;
      }
      // Dragging the thumb to the bottom reaches the end.
      await engine.pointerDown(origin.x + bar.rect.left + 8, origin.y + bar.rect.top + 20);
      engine.pointerMove(origin.x + bar.rect.left + 8, origin.y + bar.rect.bottom - 20);
      await engine.pointerUp(origin.x + bar.rect.left + 8, origin.y + bar.rect.bottom - 20);
      expect(scroll.position).toBe(scroll.max);
      engine.render(createFramebuffer());
      await engine.closePage(page.ref);
    }
    expect(ranges.toSorted((a, b) => a[0] - b[0])).toEqual([
      [0, 0],
      [0, 0],
      [6, 15],
      [28, 16],
      [65, 17],
      [67, 16],
    ]);
  });
});
