/**
 * Corpus test: parses the disc's whole page database and checks the structural invariants in
 * docs/formats/page-database.md. Only counts and invariants are asserted; no disc content is
 * stored in the repository.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import {
  collectReachable,
  mediaReferencedByPage,
  mediaReferencedByPanel,
  parsePageDatabase,
  resolveMedia,
  type Handler,
  type Page,
  type PageDatabase,
  type Panel,
  type ReachableSet,
} from '../src/index.ts';
import { describeIfAvailable, discFile, discFileSet, missingDiscFile } from './disc.ts';

const DATABASE = 'DKCODE/TWTW.PNG';

describeIfAvailable('page database corpus (disc)', missingDiscFile(DATABASE), () => {
  let db: PageDatabase;
  let reachable: ReachableSet;
  let panels: Panel[];
  let handlers: Handler[];

  beforeAll(() => {
    db = parsePageDatabase(readFileSync(discFile(DATABASE) ?? ''));
    reachable = collectReachable(db);
    panels = [
      ...[...reachable.pages.values()].flatMap((page) => page.panels),
      ...[...reachable.sharedPanels.values()].map((shared) => shared.panel),
    ];
    handlers = [
      ...db.product.handlers,
      ...db.product.templates.flatMap((template) => template.handlers),
      ...[...reachable.pages.values()].flatMap((page) => page.handlers),
      ...panels.flatMap((panel) => [
        ...panel.handlers,
        ...panel.objects.flatMap((object) => ('handlers' in object ? object.handlers : [])),
      ]),
    ];
  });

  it('parses the header records', () => {
    expect(db.strings).toHaveLength(4334);
    expect(db.product.width).toBe(640);
    expect(db.product.height).toBe(480);
    expect(db.product.templates).toHaveLength(7);
    expect(db.index).toHaveLength(1857);
  });

  it('reaches 1,657 pages and 4 shared panels', () => {
    expect(reachable.pages.size).toBe(1657);
    expect(countBy([...reachable.pages.values()], (page) => page.pageType)).toEqual({
      base: 397,
      popup: 1259,
      index: 1,
    });
    expect(reachable.sharedPanels.size).toBe(4);
    expect(countBy([...reachable.sharedPanels.values()], (shared) => shared.panel.kind)).toEqual({
      display: 3,
      navPanel: 1,
    });
  });

  it('covers the page heap byte for byte, apart from 4 unreferenced popups that also parse', () => {
    const spans = [...reachable.pages.values(), ...reachable.sharedPanels.values()]
      .map((item) => [item.ref, item.ref + item.byteLength] as const)
      .sort((a, b) => a[0] - b[0]);
    const unreferenced: Page[] = [];
    let position = 0;
    for (const [start, end] of spans) {
      expect(start).toBeGreaterThanOrEqual(position);
      if (start > position) {
        const page = db.getPage(position);
        expect(page.byteLength).toBe(start - position);
        unreferenced.push(page);
      }
      position = end;
    }
    expect(position).toBe(db.heapLength);
    expect(unreferenced.map((page) => page.pageType)).toEqual(['popup', 'popup', 'popup', 'popup']);
  });

  it('has the object type counts in the spec', () => {
    expect(countBy(panels, (panel) => panel.kind)).toEqual({ display: 1659, azDial: 1, navPanel: 1 });
    expect(
      countBy(
        panels.flatMap((panel) => panel.objects),
        (object) => object.kind,
      ),
    ).toEqual({
      bitmap: 1661,
      animationControl: 59,
      hotspot: 10539,
      azHotspot: 62,
      wordBox: 660,
      navHotspot: 9,
      animHotspot: 225,
      cancelButton: 1,
      scrollBitmap: 6,
      scrollBar: 6,
    });
  });

  it('has the action type and event counts in the spec', () => {
    const actions = handlers.flatMap((handler) => handler.actions);
    expect(countBy(actions, (action) => action.kind)).toEqual({
      openPage: 2158,
      sendMessage: 98,
      changePage: 7919,
      playWave: 285,
      playPics: 393,
      productOption: 3,
      closePage: 1,
    });
    expect(countBy(handlers, (handler) => String(handler.event))).toEqual({ '1': 22, '4': 10540, '6': 191 });
  });

  it('resolves every media reference to a file on the disc, or to a program resource', () => {
    const files = discFileSet();
    const missing: string[] = [];
    let resolved = 0;
    let resources = 0;
    const check = (
      directory: string | null,
      panelsOrPage: ReturnType<typeof mediaReferencedByPage>,
    ): void => {
      for (const reference of panelsOrPage) {
        const location = resolveMedia(directory, reference);
        if (location.kind === 'resource') resources++;
        else if (files.has(location.path.toLowerCase())) resolved++;
        else missing.push(location.path);
      }
    };
    for (const page of reachable.pages.values()) check(page.directory, mediaReferencedByPage(page));
    for (const shared of reachable.sharedPanels.values()) check(null, mediaReferencedByPanel(shared.panel));
    expect(missing).toEqual([]);
    expect(resolved).toBeGreaterThan(2600);
    expect(resources).toBe(48);
  });

  it('keeps references inside the heap and string indices inside the table', () => {
    for (const template of db.product.templates) {
      for (const slot of template.panels) {
        if (slot.sharedPanel !== null) expect(reachable.sharedPanels.has(slot.sharedPanel)).toBe(true);
      }
    }
    for (const entry of db.index) {
      expect(entry.name?.length).toBe(entry.nameLength);
      expect(entry.unknown1).toBe(0);
    }
  });

  it("gives every page a template, and fills exactly the template's non-shared panel slots", () => {
    for (const page of reachable.pages.values()) {
      const template = db.templateFor(page);
      expect(template?.pageType).toBe(page.pageType);
      const slots = (template?.panels ?? []).filter((slot) => slot.sharedPanel === null);
      expect(page.panels.map((panel) => [panel.kind, panel.id])).toEqual(
        slots.map((slot) => [slot.panelType, slot.panelId]),
      );
    }
  });

  it('confirms the named hypotheses: nav button ids and scroll bar partners', () => {
    for (const panel of panels) {
      if (panel.kind === 'navPanel') {
        const navIds = panel.objects.filter((o) => o.kind === 'navHotspot').map((o) => o.id);
        expect([...panel.buttonIds].sort()).toEqual(navIds.sort());
      }
      for (const object of panel.objects) {
        if (object.kind !== 'scrollBar') continue;
        const partner = panel.objects.find((o) => o.id === object.unknown2);
        expect(partner?.kind).toBe('scrollBitmap');
      }
    }
  });
});

function countBy<T>(items: readonly T[], key: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) counts[key(item)] = (counts[key(item)] ?? 0) + 1;
  return counts;
}
