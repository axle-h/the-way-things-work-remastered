/**
 * A synthetic disc shaped like the real one for the interaction tests (behaviour.md): a base
 * template with a navigation bar and a frame piece, the A–Z template, popup and index templates,
 * and pages exercising every action and object type. No disc bytes.
 */
import {
  HandlerEvent,
  type Action,
  type DisplayObject,
  type Handler,
  type Panel,
  type Product,
  type Rect,
} from '@twtw/formats';
import type { HeapEntrySpec, PageContent, RefOf } from '@twtw/formats/testing';
import {
  bitmapObject,
  panelSlot,
  rect,
  rgb,
  syntheticDib,
  syntheticDisc,
  syntheticPics,
  syntheticWave,
  template,
} from './index.ts';

/** Where the content panel sits, as on the disc. */
export const CONTENT = { x: 94, y: 4 } as const;
/** Nav button k's rectangle in the nav panel: (4, 10 + 40k)–(89, 40 + 40k). */
export const NAV_BUTTON_TOP = (k: number): number => 10 + 40 * k;
/** Button k's object id, in the disc's order (Options and Help swap ids). */
export const NAV_IDS = [850, 851, 852, 853, 854, 855, 856, 858, 857] as const;

const click = (...actions: Action[]): Handler[] => [{ event: HandlerEvent.Click, actions }];
const finished = (...actions: Action[]): Handler[] => [{ event: HandlerEvent.Finished, actions }];

export function hotspot(
  id: number,
  area: Rect,
  handlers: Handler[],
  flags = 4,
  cursor = 'Hand',
): DisplayObject {
  return { kind: 'hotspot', id, flags, rect: area, cursor, handlers, unknown1: 0 };
}

function display(id: number, objects: readonly DisplayObject[], handlers: Handler[] = []): Panel {
  return { kind: 'display', id, objects, handlers };
}

function base(objects: readonly DisplayObject[], fields: Partial<PageContent> = {}): PageContent {
  return {
    pageType: 'base',
    templateId: 7,
    origin: { x: 0, y: 0 },
    directory: '\\ART\\',
    handlers: [],
    links: null,
    panels: [display(1, [bitmapObject(1, 0, 0, 'BACK'), ...objects])],
    ...fields,
  };
}

function popup(
  origin: { x: number; y: number },
  file: string,
  objects: readonly DisplayObject[] = [],
  fields: Partial<PageContent> = {},
): PageContent {
  return {
    pageType: 'popup',
    templateId: 0,
    origin,
    directory: '\\ART\\',
    handlers: [],
    links: null,
    panels: [display(1, [bitmapObject(1, 0, 0, file), ...objects])],
    ...fields,
  };
}

const open = (ref: number, zoom = 0): Action => ({ kind: 'openPage', page: ref, unknown1: zoom });
const change = (ref: number): Action => ({ kind: 'changePage', page: ref, unknown1: 0 });
const close = (ref: number): Action => ({ kind: 'closePage', page: ref });
const wave = (file: string): Action => ({
  kind: 'playWave',
  file,
  unknown1: -1,
  unknown2: -1,
  unknown3: 1,
  unknown4: 1,
  unknown5: 0,
});

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
            rect: rect(4, NAV_BUTTON_TOP(k), 89, NAV_BUTTON_TOP(k) + 30),
            cursor: 'Hand',
            handlers: [],
            file: `nav\\navb${k}`,
            unknown1: 1,
          })),
        ],
        handlers: [],
        buttonIds: [...NAV_IDS],
        buttonPages: [
          ref('home'),
          ref('principles'),
          ref('dial'),
          ref('inventors'),
          ref('timeline'),
          ref('options'),
          ref('options2'),
          ref('index'),
          ref('help'),
        ],
      },
    }),
  },
  {
    label: 'frame',
    sharedPanel: () => ({ unknown1: 0, panel: display(387, [bitmapObject(1, 0, 0, 'NAV\\FRAME')]) }),
  },
  {
    label: 'home',
    page: (ref) =>
      base([
        hotspot(10, rect(10, 10, 50, 30), click(open(ref('pop1')))),
        hotspot(11, rect(60, 10, 100, 30), click(change(ref('article')))),
        hotspot(12, rect(110, 10, 150, 30), click(open(ref('zoomer'), 1))),
        hotspot(13, rect(160, 10, 200, 30), click(wave('SND'), change(ref('article')))),
        hotspot(14, rect(10, 40, 50, 60), click(change(ref('article'))), 5),
        hotspot(15, rect(60, 40, 100, 60), click(change(ref('article'))), 1),
        hotspot(16, rect(110, 40, 150, 60), click(change(ref('dial')), open(ref('dial'), 1))),
        hotspot(17, rect(160, 40, 200, 60), click(open(ref('pop1')), open(ref('pop1')))),
        {
          kind: 'animHotspot',
          id: 18,
          flags: 0,
          rect: rect(10, 70, 50, 90),
          cursor: 'Hand',
          handlers: finished(change(ref('article'))),
          file: 'ANIM',
          unknown1: 1,
        },
        hotspot(19, rect(60, 70, 100, 90), click(change(ref('movie')))),
        hotspot(20, rect(110, 70, 150, 90), click(change(ref('auto')))),
        // Overlapping: the later object wins.
        hotspot(21, rect(10, 100, 50, 120), click(change(ref('article')))),
        hotspot(22, rect(30, 100, 70, 120), click(change(ref('movie')))),
        hotspot(23, rect(160, 70, 200, 90), click(change(ref('article'))), 4, 'normal'),
        hotspot(24, rect(210, 70, 250, 90), click(change(ref('article'))), 4, 'Gizmo'),
        hotspot(25, rect(210, 10, 250, 30), click(open(ref('options')))),
        { kind: 'wordBox', id: 26, flags: 0, rect: rect(0, 0, 0, 0), cursor: null, handlers: [] },
      ]),
  },
  {
    label: 'article',
    page: (ref) =>
      base([hotspot(10, rect(10, 10, 50, 30), click(open(ref('pop1'))))], {
        links: [ref('rela'), ref('azlist'), ref('inventor2'), ref('timeline2')],
      }),
  },
  { label: 'principles', page: () => base([]) },
  { label: 'inventors', page: () => base([]) },
  { label: 'timeline', page: () => base([]) },
  { label: 'azlist', page: () => base([]) },
  { label: 'inventor2', page: () => base([]) },
  { label: 'timeline2', page: () => base([]) },
  {
    label: 'movie',
    page: () =>
      base([], {
        panels: [
          display(
            1,
            [
              bitmapObject(1, 0, 0, 'BACK'),
              {
                kind: 'animationControl',
                id: 181,
                flags: 0,
                rect: rect(200, 300, 274, 322),
                cursor: 'Hand',
                handlers: [],
                unknown1: 0,
                unknownRect: rect(200, 300, 274, 322),
                file: 'MOVIE',
                unknownCursor: 'Hand',
                unknown2: 0,
                unknown3: 0,
                unknown4: 59,
              },
              hotspot(2, rect(10, 10, 50, 30), click({ kind: 'sendMessage', target: 181, message: 59 })),
              hotspot(3, rect(60, 10, 100, 30), click({ kind: 'sendMessage', target: 999, message: 1 })),
            ],
            [{ event: HandlerEvent.Open, actions: [{ kind: 'sendMessage', target: 181, message: 59 }] }],
          ),
        ],
      }),
  },
  {
    label: 'auto',
    page: (ref) =>
      base([
        {
          kind: 'animHotspot',
          id: 2,
          flags: 0x20,
          rect: rect(0, 0, 0, 0),
          cursor: 'Hand',
          handlers: finished(change(ref('home'))),
          file: 'AUTO',
          unknown1: 1,
        },
      ]),
  },
  {
    label: 'pop1',
    page: (ref) =>
      popup({ x: 100, y: 100 }, 'P60X40', [
        hotspot(2, rect(5, 5, 25, 15), click(open(ref('pop2')))),
        hotspot(3, rect(30, 5, 50, 15), click(change(ref('pop3')))),
        hotspot(4, rect(5, 20, 25, 30), click(close(ref('pop1')))),
        hotspot(5, rect(30, 20, 50, 30), click(change(ref('article')))),
        hotspot(6, rect(5, 32, 25, 38), click(change(ref('pop1b')))),
      ]),
  },
  { label: 'pop1b', page: () => popup({ x: 10, y: 10 }, 'P60X40') },
  { label: 'pop2', page: () => popup({ x: 120, y: 160 }, 'P40X30') },
  { label: 'pop3', page: () => popup({ x: 50, y: 50 }, 'P70X30') },
  { label: 'rela', page: () => popup({ x: 300, y: 10 }, 'P40X30') },
  { label: 'zoomer', page: () => popup({ x: 200, y: 200 }, 'P40X30') },
  {
    label: 'options',
    page: (ref) =>
      popup({ x: 250, y: 250 }, 'P70X30', [
        {
          kind: 'cancelButton',
          id: 2,
          flags: 0,
          rect: rect(2, 2, 66, 26),
          cursor: 'Hand',
          handlers: click(close(ref('options'))),
          unknownStrings: [null, null, null],
        },
        hotspot(3, rect(68, 0, 70, 9), click({ kind: 'productOption', option: 1 })),
        hotspot(4, rect(68, 10, 70, 19), click({ kind: 'productOption', option: 3 })),
      ]),
  },
  { label: 'options2', page: () => popup({ x: 260, y: 20 }, 'P40X30') },
  { label: 'help', page: () => popup({ x: 300, y: 300 }, 'P40X30') },
  {
    label: 'index',
    page: () => ({ ...popup({ x: 20, y: 20 }, 'P40X30'), pageType: 'index', templateId: 617 }),
  },
  {
    label: 'dial',
    page: (ref) => ({
      pageType: 'base',
      templateId: 77,
      origin: { x: 0, y: 0 },
      directory: '\\AZ\\',
      handlers: [],
      links: null,
      panels: [
        {
          kind: 'azDial',
          id: 78,
          objects: [
            bitmapObject(1, 0, 0, 'AZBG'),
            ...(
              [
                [0, rect(10, 10, 20, 20)],
                [1, rect(30, 10, 40, 20)],
                [25, rect(50, 10, 60, 20)],
                [26, rect(10, 30, 20, 40)],
                [27, rect(30, 30, 40, 40)],
                [28, rect(334, 335, 361, 368)],
              ] as const
            ).map(([code, area], i): DisplayObject => ({
              kind: 'azHotspot',
              id: 80 + i,
              flags: 4,
              rect: area,
              cursor: 'Hand',
              handlers: [],
              unknown1: 0,
              unknown2: code,
            })),
            hotspot(90, rect(100, 10, 120, 20), click(open(ref('pop2')))),
          ],
          handlers: [],
          letterPages: Array.from({ length: 26 }, (_, i) =>
            i === 0 ? ref('azlist') : i === 1 ? ref('article') : i === 2 ? ref('rela') : null,
          ),
          letterAnimations: Array.from({ length: 26 }, (_, i) =>
            i === 3 ? null : `azl${String.fromCharCode(97 + i)}`,
          ),
        },
      ],
    }),
  },
];

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
        panelSlot(1, CONTENT.x, CONTENT.y, 540, 450, 0xff0000),
        panelSlot(387, 94, 454, 544, 5, 0x0000ff, ref('frame')),
      ],
    }),
    template({
      id: 77,
      pageType: 'base',
      unknown3: 1,
      panels: [
        { ...panelSlot(849, 0, 0, 94, 459, 0xfffbf0, ref('nav')), panelType: 'navPanel' },
        { ...panelSlot(78, CONTENT.x, CONTENT.y, 540, 450, 0xfffbf0), panelType: 'azDial' },
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

/** Pixel values of the synthetic pictures. */
export const PICTURE = { back: 20, nav: 11, frame: 12, dial: 50, popup: 40 } as const;

/**
 * Sounds and animations (for the media tests; the interaction tests do not play them). Sound runs
 * at 1,000 bytes per second. Each animation has one pre-roll chunk and three frame chunks of
 * 0.2 s, so it lasts 0.8 s; its frames are 20×10 rectangles of `MEDIA_FRAME_FILL[name]` + 0, 1, 2
 * at panel (100,200), (110,200), (120,200).
 */
export const MEDIA_RATE = 1000;
export const MEDIA_DURATION_MS = 800;
export const MEDIA_FRAME_FILL = { anim: 60, auto: 70, movie: 80, nav: 90, letter: 140 } as const;

function animation(fill: number): Uint8Array {
  return syntheticPics({
    preRoll: [1, 1],
    preRollSound: 200,
    rate: MEDIA_RATE,
    frames: [0, 1, 2].map((k) => ({
      sound: 200,
      image: { left: 100 + 10 * k, top: 200, width: 20, height: 10, fill: fill + k },
    })),
  });
}

const files: Record<string, Uint8Array> = {
  'ART/BACK.DIB': syntheticDib(540, 450, PICTURE.back),
  'NAV/NAV.DIB': syntheticDib(94, 459, PICTURE.nav),
  'NAV/FRAME.DIB': syntheticDib(544, 5, PICTURE.frame),
  'ART/P60X40.DIB': syntheticDib(60, 40, PICTURE.popup),
  'ART/P40X30.DIB': syntheticDib(40, 30, PICTURE.popup),
  'ART/P70X30.DIB': syntheticDib(70, 30, PICTURE.popup),
  'AZ/AZBG.DIB': syntheticDib(540, 450, PICTURE.dial),
  ...Object.fromEntries(
    Array.from({ length: 26 }, (_, i) => [
      `AZ/AZL${String.fromCharCode(65 + i)}.DIB`,
      syntheticDib(5, 5, 200 + i),
    ]),
  ),
  'ART/ANIM.ANI': animation(MEDIA_FRAME_FILL.anim),
  'ART/AUTO.ANI': animation(MEDIA_FRAME_FILL.auto),
  'ART/MOVIE.ANI': animation(MEDIA_FRAME_FILL.movie),
  ...Object.fromEntries(
    Array.from({ length: 9 }, (_, k) => [`NAV/NAVB${k}.ANI`, animation(MEDIA_FRAME_FILL.nav)]),
  ),
  ...Object.fromEntries(
    Array.from({ length: 26 }, (_, i) => [
      `AZ/AZL${String.fromCharCode(65 + i)}.ANI`,
      animation(MEDIA_FRAME_FILL.letter),
    ]),
  ),
  'ART/SND.WAV': syntheticWave(300, MEDIA_RATE),
  'AZAZ/DIAL.WAV': syntheticWave(100, MEDIA_RATE),
};

export const interactionDisc = syntheticDisc({ product, heap }, files);

export function interactionRef(label: string): number {
  const value = interactionDisc.refs.get(label);
  if (value === undefined) throw new Error(`no heap entry ${label}`);
  return value;
}
