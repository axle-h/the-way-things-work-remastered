// A small synthetic disc for the unit tests, shaped like the real one (no disc bytes): an article
// with a popup, a page an autostart animation moves on from, a movie page, the A–Z dial and a
// shared navigation bar.
import { HandlerEvent, type DisplayObject, type Handler, type Panel, type Product } from '@twtw/formats';
import {
  buildPics,
  packPicsRuns,
  type HeapEntrySpec,
  type PageContent,
  type RefOf,
} from '@twtw/formats/testing';
import {
  bitmapObject,
  hotspotObject,
  panelSlot,
  rect,
  rgb,
  syntheticDib,
  syntheticDisc,
  template,
} from '@twtw/engine/testing';

/** The base template's content panel, as on the disc. */
export const CONTENT = { x: 94, y: 4 } as const;
/** Pixel values of the synthetic pictures and animation frames. */
export const FILL = {
  article: 20,
  other: 30,
  popup: 40,
  popup2: 41,
  frameA: 100,
  frameB: 101,
  movie: 110,
} as const;
/** Animation frame rectangles, in panel coordinates. */
export const INTRO_FRAMES = [rect(10, 20, 14, 23), rect(12, 22, 16, 24)] as const;
export const MOVIE_FRAME = rect(100, 50, 140, 80);

const onClick = (actions: Handler['actions']): Handler[] => [{ event: HandlerEvent.Click, actions }];

function display(id: number, objects: readonly DisplayObject[], handlers: Handler[] = []): Panel {
  return { kind: 'display', id, objects, handlers };
}

function page(fields: Partial<PageContent> & Pick<PageContent, 'panels'>): PageContent {
  return {
    pageType: 'base',
    templateId: 7,
    origin: { x: 0, y: 0 },
    directory: '\\ART\\',
    handlers: [],
    links: null,
    ...fields,
  };
}

function hotspot(id: number, area: ReturnType<typeof rect>, handlers: Handler[]): DisplayObject {
  return { ...hotspotObject(id, area), handlers } as DisplayObject;
}

const heap: HeapEntrySpec[] = [
  {
    label: 'nav',
    sharedPanel: (ref) => ({
      unknown1: 0,
      panel: {
        kind: 'navPanel',
        id: 849,
        objects: [
          bitmapObject(2, 0, 0, 'NAV\\NAV'),
          {
            kind: 'navHotspot',
            id: 850,
            flags: 0,
            rect: rect(4, 3, 89, 75),
            cursor: null,
            handlers: [],
            file: null,
            unknown1: 1,
          },
        ],
        handlers: [],
        buttonIds: [850, 851, 852, 853, 854, 855, 856, 857, 858],
        buttonPages: [ref('other'), null, null, null, null, null, null, null, null],
      },
    }),
  },
  {
    label: 'article',
    page: (ref) =>
      page({
        panels: [
          display(1, [
            bitmapObject(2, 0, 0, 'ARTICLE'),
            hotspot(
              3,
              rect(10, 10, 50, 30),
              onClick([{ kind: 'openPage', page: ref('popup'), unknown1: 0 }]),
            ),
            hotspot(
              4,
              rect(300, 300, 320, 320),
              onClick([{ kind: 'changePage', page: ref('other'), unknown1: 0 }]),
            ),
            hotspot(5, rect(400, 10, 420, 30), onClick([{ kind: 'sendMessage', target: 1, message: 2 }])),
          ]),
        ],
      }),
  },
  {
    label: 'popup',
    page: (ref) =>
      page({
        pageType: 'popup',
        templateId: 0,
        origin: { x: 20, y: 30 },
        panels: [
          display(1, [
            bitmapObject(2, 0, 0, 'POPUP'),
            hotspot(
              3,
              rect(5, 5, 25, 15),
              onClick([{ kind: 'changePage', page: ref('other'), unknown1: 0 }]),
            ),
            hotspot(
              4,
              rect(30, 5, 50, 15),
              onClick([{ kind: 'changePage', page: ref('popup2'), unknown1: 0 }]),
            ),
            hotspot(5, rect(5, 20, 25, 30), onClick([{ kind: 'closePage', page: ref('popup') }])),
          ]),
        ],
      }),
  },
  {
    label: 'popup2',
    page: () =>
      page({
        pageType: 'popup',
        templateId: 0,
        origin: { x: 40, y: 50 },
        panels: [display(1, [bitmapObject(2, 0, 0, 'POPUP2')])],
      }),
  },
  { label: 'other', page: () => page({ panels: [display(1, [bitmapObject(2, 0, 0, 'OTHER')])] }) },
  {
    label: 'index',
    page: () =>
      page({
        pageType: 'index',
        templateId: 617,
        origin: { x: 89, y: 42 },
        panels: [display(1, [bitmapObject(2, 0, 0, 'INDEX')])],
      }),
  },
  {
    label: 'intro',
    page: (ref) =>
      page({
        panels: [
          display(1, [
            bitmapObject(2, 0, 0, 'ARTICLE'),
            {
              kind: 'animHotspot',
              id: 2,
              flags: 0x20,
              rect: rect(530, 1, 539, 5),
              cursor: null,
              handlers: [
                {
                  event: HandlerEvent.Finished,
                  actions: [{ kind: 'changePage', page: ref('movie'), unknown1: 0 }],
                },
              ],
              file: 'INTRO',
              unknown1: 1,
            },
          ]),
        ],
      }),
  },
  {
    label: 'movie',
    page: () =>
      page({
        panels: [
          display(
            1,
            [
              bitmapObject(2, 0, 0, 'OTHER'),
              {
                kind: 'animationControl',
                id: 181,
                flags: 0,
                rect: rect(229, 307, 303, 329),
                cursor: null,
                handlers: [],
                unknown1: 0,
                unknownRect: rect(229, 307, 303, 329),
                file: 'MOVIE',
                unknownCursor: null,
                unknown2: 0,
                unknown3: 0,
                unknown4: 59,
              },
            ],
            [{ event: HandlerEvent.Open, actions: [{ kind: 'sendMessage', target: 181, message: 59 }] }],
          ),
        ],
      }),
  },
  {
    label: 'dial',
    page: () =>
      page({
        templateId: 77,
        panels: [
          {
            kind: 'azDial',
            id: 78,
            objects: [bitmapObject(2, 0, 0, 'ARTICLE')],
            handlers: [],
            letterPages: Array.from({ length: 26 }, () => null),
            letterAnimations: Array.from({ length: 26 }, () => null),
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
  startupPage: ref('article'),
  handlers: [],
  templates: [
    template({
      id: 7,
      pageType: 'base',
      panels: [
        { ...panelSlot(849, 0, 0, 94, 459, 0x000000, ref('nav')), panelType: 'navPanel' },
        panelSlot(1, CONTENT.x, CONTENT.y, 540, 450, 0xff0000),
        panelSlot(387, 94, 454, 544, 5, 0x0000ff),
        panelSlot(388, 634, 4, 4, 450, 0x00ff00),
        panelSlot(389, 94, 0, 544, 4, 0x00ffff),
      ],
    }),
    template({
      id: 77,
      pageType: 'base',
      panels: [
        { ...panelSlot(849, 0, 0, 94, 459, 0x000000, ref('nav')), panelType: 'navPanel' },
        { ...panelSlot(78, CONTENT.x, CONTENT.y, 540, 450, 0xfffbf0), panelType: 'azDial' },
      ],
    }),
    // Like the disc's popup template 0: origin relative to panel 1 of template 7, caption, shadow 4.
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

/** A PICS file with one solid-colour image per rectangle (no pre-roll, a little sound each). */
function animation(frames: readonly (readonly [ReturnType<typeof rect>, number])[]): Uint8Array {
  return buildPics({
    preRollFactorA: 0,
    preRollFactorB: 0,
    chunks: frames.map(([area, value]) => {
      const width = area.right - area.left;
      const size = (width + (width & 1)) * (area.bottom - area.top);
      return {
        sound: [128, 128],
        rect: area,
        unpackedSize: size,
        packed: packPicsRuns(new Array<number>(size).fill(value)),
      };
    }),
  });
}

const files: Record<string, Uint8Array> = {
  'NAV/NAV.DIB': syntheticDib(94, 460, 11),
  'ART/ARTICLE.DIB': syntheticDib(540, 450, FILL.article),
  'ART/OTHER.DIB': syntheticDib(540, 450, FILL.other),
  'ART/POPUP.DIB': syntheticDib(60, 40, FILL.popup),
  'ART/POPUP2.DIB': syntheticDib(70, 30, FILL.popup2),
  'ART/INDEX.DIB': syntheticDib(363, 360, FILL.popup2),
  'ART/INTRO.ANI': animation([
    [INTRO_FRAMES[0], FILL.frameA],
    [INTRO_FRAMES[1], FILL.frameB],
  ]),
  'ART/MOVIE.ANI': animation([[MOVIE_FRAME, FILL.movie]]),
};

export const disc = syntheticDisc(
  {
    product,
    heap,
    index: (ref) => [{ name: 'Entry', nameLength: 5, unknown1: 0, page: ref('other'), seeAlso: [] }],
  },
  files,
);

export function ref(label: string): number {
  const value = disc.refs.get(label);
  if (value === undefined) throw new Error(`no heap entry ${label}`);
  return value;
}
