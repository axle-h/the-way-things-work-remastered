/**
 * Oracle comparison (docs/architecture.md, "Validation" 3): our parse of the disc's page database against the JSON
 * written by the private oracle (`analysis/decompiled/out/twtw_png.json`, gitignored). Only the
 * oracle's output is used. Our model is converted to the oracle's JSON shape and compared value
 * by value. Skips when the disc or the JSON is absent; `$TWTW_ORACLE_JSON` overrides the path.
 */
import { existsSync, readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { beforeAll, expect, it } from 'vitest';
import {
  collectReachable,
  parsePageDatabase,
  type Action,
  type DisplayObject,
  type Handler,
  type IndexEntry,
  type Page,
  type PageDatabase,
  type PageType,
  type Panel,
  type PanelRef,
  type Product,
  type Rect,
  type Rgb,
  type ReachableSet,
  type SharedPanel,
  type Template,
} from '../src/index.ts';
import { describeIfAvailable, discFile, missingDiscFile, repoPath } from './disc.ts';

const DATABASE = 'DKCODE/TWTW.PNG';
const oraclePath = process.env.TWTW_ORACLE_JSON ?? repoPath('analysis', 'decompiled', 'out', 'twtw_png.json');

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

interface Oracle {
  header: { page_data_start: number; strtab_size: number };
  strings: string[];
  product: JsonObject;
  az_index: Json[];
  shared_panels: Record<string, JsonObject>;
  pages: Record<string, JsonObject>;
}

function missing(): string | null {
  return (
    missingDiscFile(DATABASE) ??
    (existsSync(oraclePath) ? null : `oracle output ${oraclePath} not found (set TWTW_ORACLE_JSON)`)
  );
}

describeIfAvailable('page database vs oracle output', missing(), () => {
  let db: PageDatabase;
  let reachable: ReachableSet;
  let oracle: Oracle;

  beforeAll(() => {
    db = parsePageDatabase(readFileSync(discFile(DATABASE) ?? ''));
    reachable = collectReachable(db);
    oracle = JSON.parse(readFileSync(oraclePath, 'utf8')) as Oracle;
  });

  it('agrees on the header and string table', () => {
    expect({ page_data_start: db.heapOffset, strtab_size: db.stringTableLength }).toEqual(oracle.header);
    expect(db.strings).toEqual(oracle.strings);
  });

  it('agrees on the product record and templates', () => {
    expect(productJson(db.product)).toEqual(oracle.product);
  });

  it('agrees on the A–Z index', () => {
    expectAllEqual(db.index.map(indexEntryJson), oracle.az_index, (i) => `index entry ${i}`);
  });

  it('agrees on which pages and shared panels exist', () => {
    expect([...reachable.pages.keys()].map(hex).sort()).toEqual(Object.keys(oracle.pages).sort());
    expect([...reachable.sharedPanels.keys()].map(hex).sort()).toEqual(
      Object.keys(oracle.shared_panels).sort(),
    );
  });

  it('agrees on every page', () => {
    const ours = [...reachable.pages.values()];
    expectAllEqual(
      ours.map(pageJson),
      ours.map((page) => withoutObjectOffsets(oracle.pages[hex(page.ref)] ?? null)),
      (i) => `page ${hex(ours[i]?.ref ?? -1)}`,
    );
  });

  it('agrees on every shared panel', () => {
    const ours = [...reachable.sharedPanels.values()];
    expectAllEqual(
      ours.map(sharedPanelJson),
      ours.map((shared) => withoutObjectOffsets(oracle.shared_panels[hex(shared.ref)] ?? null)),
      (i) => `shared panel ${hex(ours[i]?.ref ?? -1)}`,
    );
  });
});

/** Compares two lists item by item, reporting how many differ and showing the first difference. */
function expectAllEqual(ours: Json[], theirs: Json[], label: (index: number) => string): void {
  expect(ours.length).toBe(theirs.length);
  const differing = ours.flatMap((item, i) => (isDeepStrictEqual(item, theirs[i]) ? [] : [i]));
  const first = differing[0];
  if (first !== undefined) {
    expect(ours[first], `${label(first)} (${differing.length} of ${ours.length} differ)`).toEqual(
      theirs[first],
    );
  }
}

// ---------------------------------------------------------------------------------------------
// Our model in the oracle's JSON shape

const hex = (ref: number): string => `0x${ref.toString(16)}`;

const PAGE_TYPE_NAMES: Record<PageType, string> = {
  popup: 'POPUP_PAGE',
  base: 'BASE_PAGE',
  index: 'INDEX_PAGE',
  child: 'CHILD_PAGE',
};
const PANEL_TYPE_NAMES: Record<Panel['kind'], string> = {
  display: 'Display',
  azDial: 'AZDial',
  navPanel: 'NavPanel',
};
const OBJECT_TYPE_NAMES: Record<DisplayObject['kind'], string> = {
  bitmap: 'Bitmap',
  animationControl: 'AnimationControl',
  hotspot: 'Hotspot',
  azHotspot: 'AZHotspot',
  wordBox: 'WordBox',
  navHotspot: 'NavHotspot',
  animHotspot: 'AnimHotspot',
  cancelButton: 'CancelButton',
  scrollBitmap: 'ScrollBitmap',
  scrollBar: 'ScrollBaa',
  azAnimHotspot: 'AZAnimHotspot',
};
const EVENT_NAMES: Record<number, string> = { 1: 'on_open', 4: 'on_click', 6: 'on_finish' };

const rectJson = (r: Rect): Json => [r.left, r.top, r.right, r.bottom];
const rgbJson = (c: Rgb): Json => [c.red, c.green, c.blue];

function productJson(p: Product): Json {
  return {
    title: p.title,
    size: [p.width, p.height],
    version: p.version,
    default_cursor: p.defaultCursor,
    bkgrnd_colour: rgbJson(p.backgroundColour),
    x38: p.unknown1,
    startup_page: p.startupPage,
    templates: p.templates.map(templateJson),
    handlers: p.handlers.map(handlerJson),
  };
}

function templateJson(t: Template): Json {
  return {
    page_type: PAGE_TYPE_NAMES[t.pageType],
    id: t.id,
    ...(t.unknown1 === null ? {} : { x10: [...t.unknown1] }),
    x1e: t.unknown2,
    size: [t.width, t.height],
    // Blocks B and C never occur on the disc; the oracle's names for them are unknown.
    ...(t.position === null ? {} : { position: [t.position.x, t.position.y] }),
    x18: t.unknown3,
    x1a: t.unknown4,
    x1c: t.unknown5,
    x16: t.unknown6,
    ...(t.unknownRect === null ? {} : { rect: rectJson(t.unknownRect) }),
    list38: [...t.unknownList1],
    list4c: [...t.unknownList2],
    panels: t.panels.map(panelRefJson),
    handlers: t.handlers.map(handlerJson),
  };
}

function panelRefJson(slot: PanelRef): Json {
  return {
    type: PANEL_TYPE_NAMES[slot.panelType],
    panel_id: slot.panelId,
    ...(slot.sharedPanel === null ? {} : { shared_offset: slot.sharedPanel }),
    colour: rgbJson(slot.colour),
    size: [slot.width, slot.height],
    position: [slot.x, slot.y],
  };
}

function indexEntryJson(e: IndexEntry): Json {
  return { name: e.name, len: e.nameLength, x10: e.unknown1, page: e.page, also: [...e.seeAlso] };
}

function pageJson(page: Page): Json {
  return {
    offset: page.ref,
    page_type: PAGE_TYPE_NAMES[page.pageType],
    template: page.templateId,
    origin: [page.origin.x, page.origin.y],
    name: page.directory,
    panels: page.panels.map(panelJson),
    handlers: page.handlers.map(handlerJson),
    ...(page.links === null ? {} : { links: [...page.links] }),
    _end: page.ref + page.byteLength,
  };
}

function sharedPanelJson(shared: SharedPanel): Json {
  return {
    ...(panelJson(shared.panel) as JsonObject),
    offset: shared.ref,
    _lead: shared.unknown1,
    _end: shared.ref + shared.byteLength,
  };
}

function panelJson(panel: Panel): Json {
  const common = {
    type: PANEL_TYPE_NAMES[panel.kind],
    panel_id: panel.id,
    objects: panel.objects.map(objectJson),
    handlers: panel.handlers.map(handlerJson),
  };
  switch (panel.kind) {
    case 'display':
      return common;
    case 'azDial':
      return { ...common, letter_pages: [...panel.letterPages], letter_strings: [...panel.letterAnimations] };
    case 'navPanel':
      return { ...common, ints: [...panel.buttonIds], pages: [...panel.buttonPages] };
  }
}

function objectJson(o: DisplayObject): Json {
  const type = OBJECT_TYPE_NAMES[o.kind];
  if (o.kind === 'scrollBitmap' || o.kind === 'scrollBar') {
    const common = {
      type,
      id: o.id,
      rect: rectJson(o.rect),
      cursor: o.cursor,
      x3e: o.unknown1,
      x44: o.unknown2,
      x4a: o.unknown3,
      x4c: o.unknown4,
      x4e: o.unknown5,
    };
    return o.kind === 'scrollBitmap' ? { ...common, file: o.file } : { ...common, files: [...o.parts] };
  }
  const common = {
    type,
    id: o.id,
    flags: o.flags,
    rect: o.rect === null ? null : rectJson(o.rect),
    cursor: o.cursor,
    handlers: o.handlers.map(handlerJson),
  };
  switch (o.kind) {
    case 'bitmap':
      return { ...common, file: o.file };
    case 'animationControl':
      return {
        ...common,
        x1a: o.unknown1,
        rect2: rectJson(o.unknownRect),
        file: o.file,
        cursor2: o.unknownCursor,
        xdc: o.unknown2,
        xde: o.unknown3,
        x108: o.unknown4,
      };
    case 'hotspot':
      return { ...common, x3e: o.unknown1 };
    case 'azHotspot':
      return { ...common, x3e: o.unknown1, x44: o.unknown2 };
    case 'wordBox':
      return common;
    case 'navHotspot':
    case 'animHotspot':
    case 'azAnimHotspot':
      return { ...common, file: o.file, x42: o.unknown1 };
    case 'cancelButton':
      return { ...common, files: [...o.unknownStrings] };
  }
}

function handlerJson(h: Handler): Json {
  return { event: EVENT_NAMES[h.event] ?? `event_${h.event}`, actions: h.actions.map(actionJson) };
}

function actionJson(a: Action): Json {
  switch (a.kind) {
    case 'openPage':
      return { action: 'OPENPAGE', page: a.page, flag: a.unknown1 };
    case 'changePage':
      return { action: 'CHANGEPAGE', page: a.page, flag: a.unknown1 };
    case 'closePage':
      return { action: 'Closepage', page: a.page };
    case 'sendMessage':
      return { action: 'SENDMESSAGE', msg: a.target, param: a.message };
    case 'productOption':
      return { action: 'TWTWOPTION', option: a.option };
    case 'playWave':
    case 'playPics':
      return {
        action: a.kind === 'playWave' ? 'PLAYWAVE' : 'PLAYPICS',
        file: a.file,
        v1e: a.unknown1,
        v20: a.unknown2,
        v24: a.unknown3,
        v22: a.unknown4,
        v26: a.unknown5,
      };
    default:
      // Not on the disc; the oracle's spelling is unknown, so any occurrence shows up as a difference.
      return { action: a.kind };
  }
}

/** The oracle records each object's file offset (`_off`); we do not keep it. */
function withoutObjectOffsets(value: Json): Json {
  if (Array.isArray(value)) return value.map(withoutObjectOffsets);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== '_off')
      .map(([key, item]) => [key, withoutObjectOffsets(item)]),
  );
}
