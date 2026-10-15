/**
 * A synthetic disc for the special screens (special-screens.md): an Index page with an A–Z index,
 * Help popups with a ScrollBar and its ScrollBitmap, and an Options popup. Laid out like the real
 * disc (template 7 with a navigation bar, popup template 0, index template 617), with made-up
 * names and pictures. No disc bytes.
 */
import {
  HandlerEvent,
  type Action,
  type DisplayObject,
  type Handler,
  type IndexEntry,
  type Panel,
  type Product,
} from '@twtw/formats';
import type { HeapEntrySpec, PageContent, RefOf } from '@twtw/formats/testing';
import { bitmapObject, panelSlot, rect, rgb, syntheticDib, syntheticDisc, template } from './index.ts';

/** Where the content panel sits, as on the disc. */
export const SPECIAL_CONTENT = { x: 94, y: 4 } as const;
/** Nav button k's rectangle in the nav panel: (4, 10 + 40k)–(89, 40 + 40k). */
export const SPECIAL_NAV_TOP = (k: number): number => 10 + 40 * k;

/** The index names, in data order: almost alphabetical, with one out of order, as on the disc. */
export const SPECIAL_INDEX_NAMES: readonly string[] = [
  'A. Example',
  'Abacus',
  'Abrasive \u00ad Sanding',
  'Air Pump',
  'Airplane',
  'airship',
  'Zebra Crossing', // out of order, kept where it is
  'Bell',
  'Bicycle',
  'Café Machine',
  ...Array.from({ length: 30 }, (_, i) => `Gear ${String(i + 10)}`),
];

/** Pixel values of the synthetic pictures. */
export const SPECIAL_PICTURE = { back: 20, index: 231, help: 40, options: 45 } as const;

/** The scrolling Help picture's pixel at row y: different on every row of a window's height. */
export const helpRowFill = (y: number): number => 10 + (y % 230);

const click = (...actions: Action[]): Handler[] => [{ event: HandlerEvent.Click, actions }];
const change = (ref: number): Action => ({ kind: 'changePage', page: ref, unknown1: 0 });
const close = (ref: number): Action => ({ kind: 'closePage', page: ref });

function hotspot(id: number, area: ReturnType<typeof rect>, handlers: Handler[]): DisplayObject {
  return { kind: 'hotspot', id, flags: 4, rect: area, cursor: 'Hand', handlers, unknown1: 0 };
}

function display(objects: readonly DisplayObject[]): Panel {
  return { kind: 'display', id: 1, objects, handlers: [] };
}

function base(file = 'BACK'): PageContent {
  return {
    pageType: 'base',
    templateId: 7,
    origin: { x: 0, y: 0 },
    directory: '\\ART\\',
    handlers: [],
    links: null,
    panels: [display([bitmapObject(1, 0, 0, file)])],
  };
}

function popup(
  origin: { x: number; y: number },
  file: string,
  objects: readonly DisplayObject[] = [],
): PageContent {
  return {
    pageType: 'popup',
    templateId: 0,
    origin,
    directory: '\\ART\\',
    handlers: [],
    links: null,
    panels: [display([bitmapObject(2, 0, 0, file), ...objects])],
  };
}

/** A Help page with a ScrollBar (518) and its ScrollBitmap (519), as on the disc (§3.1). */
function scrollingHelp(picture: string, others: readonly DisplayObject[]): PageContent {
  return popup({ x: -54, y: 17 }, 'HELP', [
    ...others,
    {
      kind: 'scrollBar',
      id: 518,
      rect: rect(530, 49, 546, 349),
      cursor: 'Hand',
      unknown1: 1,
      unknown2: 519,
      unknown3: 0,
      unknown4: 0,
      unknown5: 0,
      parts: [
        '@LINEUP',
        '@LINEDOWN',
        '@THUMB',
        '@THUMBTRACK',
        '@LINEUPALT',
        '@LINEDOWNALT',
        '@THUMBALT',
        '@THUMBTRACKALT',
      ],
    },
    {
      kind: 'scrollBitmap',
      id: 519,
      rect: rect(274, 50, 530, 348),
      cursor: 'Arrow',
      unknown1: 0,
      unknown2: 520,
      unknown3: 0,
      unknown4: 0,
      unknown5: 0,
      file: picture,
    },
  ]);
}

const NAV_IDS = [850, 851, 852, 853, 854, 855, 856, 858, 857] as const;

const heap: HeapEntrySpec[] = [
  {
    label: 'nav',
    sharedPanel: (ref) => ({
      unknown1: 0,
      panel: {
        kind: 'navPanel',
        id: 849,
        objects: [
          bitmapObject(1, 0, 0, 'NAV\\NAV'),
          ...NAV_IDS.map((id, k): DisplayObject => ({
            kind: 'navHotspot',
            id,
            flags: 0,
            rect: rect(4, SPECIAL_NAV_TOP(k), 89, SPECIAL_NAV_TOP(k) + 30),
            cursor: 'Hand',
            handlers: [],
            file: null,
            unknown1: 1,
          })),
        ],
        handlers: [],
        buttonIds: [...NAV_IDS],
        buttonPages: [
          ref('home'),
          ref('home'),
          ref('home'),
          ref('home'),
          ref('home'),
          ref('options'),
          ref('options'),
          ref('index'),
          ref('help0'),
        ],
      },
    }),
  },
  { label: 'home', page: () => base() },
  { label: 'art0', page: () => base() },
  { label: 'art1', page: () => base() },
  { label: 'art2', page: () => base() },
  { label: 'other', page: () => base() },
  { label: 'label0', page: () => popup({ x: 10, y: 10 }, 'P40X30') },
  { label: 'label1', page: () => popup({ x: 60, y: 10 }, 'P40X30') },
  {
    label: 'index',
    page: () => ({ ...popup({ x: 89, y: 42 }, 'INDE'), pageType: 'index', templateId: 617 }),
  },
  {
    label: 'help0',
    page: (ref) =>
      popup({ x: -54, y: 17 }, 'HELP', [
        hotspot(3, rect(10, 10, 40, 30), click(change(ref('help1')))),
        hotspot(4, rect(50, 10, 80, 30), click(change(ref('help2')))),
      ]),
  },
  {
    label: 'help1',
    page: (ref) => scrollingHelp('HELPT1', [hotspot(3, rect(10, 10, 40, 30), click(change(ref('help0'))))]),
  },
  {
    label: 'help2',
    page: (ref) => scrollingHelp('HELPT0', [hotspot(3, rect(10, 10, 40, 30), click(change(ref('help0'))))]),
  },
  {
    label: 'options',
    page: (ref) =>
      popup({ x: 152, y: 105 }, 'OPTI', [
        {
          kind: 'cancelButton',
          id: 2,
          flags: 0,
          rect: rect(87, 188, 151, 212),
          cursor: 'Hand',
          handlers: click(close(ref('options'))),
          unknownStrings: [null, null, null],
        },
        hotspot(2, rect(41, 66, 199, 81), click({ kind: 'productOption', option: 1 })),
        hotspot(2, rect(39, 96, 199, 110), click({ kind: 'productOption', option: 2 })),
        hotspot(2, rect(58, 126, 179, 141), click({ kind: 'productOption', option: 3 })),
      ]),
  },
];

const index = (ref: RefOf): IndexEntry[] =>
  SPECIAL_INDEX_NAMES.map((name, i) => ({
    name,
    nameLength: name.length,
    unknown1: 0,
    page: ref(`art${i % 3}`),
    seeAlso:
      i === 0 ? [ref('label0')] : i === 1 ? [ref('label0'), ref('label1')] : i === 2 ? [ref('other')] : [],
  }));

const product = (ref: RefOf): Product => ({
  title: 'Synthetic',
  width: 640,
  height: 480,
  version: null,
  defaultCursor: 'Arrow',
  backgroundColour: rgb(0x00ff00),
  unknown1: 0,
  startupPage: ref('home'),
  handlers: [],
  templates: [
    template({
      id: 7,
      pageType: 'base',
      unknown3: 1,
      panels: [
        { ...panelSlot(849, 0, 0, 94, 459, 0x000000, ref('nav')), panelType: 'navPanel' },
        panelSlot(1, SPECIAL_CONTENT.x, SPECIAL_CONTENT.y, 544, 455, 0xff0000),
      ],
    }),
    template({
      id: 0,
      pageType: 'popup',
      unknown1: [7, 1],
      unknown3: 1,
      unknown4: 4,
      panels: [panelSlot(1, 0, 0, 0, 0, 0xfffbf0)],
    }),
    template({
      id: 617,
      pageType: 'index',
      unknown1: [7, 1],
      unknown3: 1,
      unknown4: 4,
      panels: [panelSlot(1, 0, 0, 0, 0, 0xfffbf0)],
    }),
  ],
});

const files: Record<string, Uint8Array> = {
  'ART/BACK.DIB': syntheticDib(544, 455, SPECIAL_PICTURE.back),
  'NAV/NAV.DIB': syntheticDib(94, 459, 11),
  'ART/P40X30.DIB': syntheticDib(40, 30, 41),
  'ART/INDE.DIB': syntheticDib(363, 360, SPECIAL_PICTURE.index),
  'ART/HELP.DIB': syntheticDib(560, 410, SPECIAL_PICTURE.help),
  'ART/HELPT1.DIB': syntheticDib(256, 807, (_x, y) => helpRowFill(y)),
  'ART/HELPT0.DIB': syntheticDib(256, 298, (_x, y) => helpRowFill(y)),
  'ART/OPTI.DIB': syntheticDib(237, 230, SPECIAL_PICTURE.options),
};

export const specialDisc = syntheticDisc({ product, heap, index }, files);

export function specialRef(label: string): number {
  const value = specialDisc.refs.get(label);
  if (value === undefined) throw new Error(`no heap entry ${label}`);
  return value;
}
