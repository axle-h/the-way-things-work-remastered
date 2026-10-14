import type { DisplayObject, Panel, Product } from '@twtw/formats';
import type { HeapEntrySpec, PageContent, RefOf } from '@twtw/formats/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { Engine } from './engine.ts';
import {
  CLIENT_HEIGHT,
  CLIENT_WIDTH,
  createFramebuffer,
  SCREEN_HEIGHT,
  SCREEN_WIDTH,
  type Framebuffer,
} from './screen.ts';
import {
  bitmapObject,
  hotspotObject,
  panelSlot,
  rect,
  rgb,
  syntheticDib,
  syntheticDisc,
  template,
} from './testing/index.ts';

// Palette indices of the colours used below (dib-and-palette.md).
const RED = 249;
const GREEN = 250;
const BLUE = 252;
const CREAM = 246; // FFFBF0, also artwork entry 245 in the synthetic palette
const NAVY = 4;
const WHITE = 255;
const LIGHT_GREY = 7;
const DARK_GREY = 248;

// The base template's content slot: panel 1 at (20,4), 300×300, red. The page origins of the
// popups are relative to it, through the popup template's flag A block (7, 1).
const CONTENT = { x: 20, y: 4 };

function display(id: number, objects: readonly DisplayObject[]): Panel {
  return { kind: 'display', id, objects, handlers: [] };
}

function page(
  fields: Partial<PageContent> & Pick<PageContent, 'pageType' | 'templateId' | 'panels'>,
): PageContent {
  return { origin: { x: 0, y: 0 }, directory: '\\ART\\', handlers: [], links: null, ...fields };
}

function popup(
  origin: { x: number; y: number },
  file: string,
  extra: readonly DisplayObject[] = [],
): PageContent {
  return page({
    pageType: 'popup',
    templateId: 0,
    origin,
    panels: [display(5, [bitmapObject(1, 0, 0, file), ...extra])],
  });
}

const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const heap: HeapEntrySpec[] = [
  {
    label: 'base',
    page: () =>
      page({
        pageType: 'base',
        templateId: 7,
        panels: [
          display(1, [
            bitmapObject(1, 2, 3, 'under'),
            bitmapObject(2, 6, 7, 'over'),
            hotspotObject(3, rect(0, 0, 300, 300)),
            bitmapObject(4, 280, 290, 'big'),
          ]),
        ],
      }),
  },
  {
    label: 'nav',
    sharedPanel: () => ({ unknown1: 0, panel: display(849, [bitmapObject(1, 0, 0, 'NAV\\NAV')]) }),
  },
  { label: 'popup', page: () => popup({ x: 100, y: 200 }, 'pop') },
  { label: 'popupSameSize', page: () => popup({ x: 5, y: 6 }, 'pop') },
  { label: 'popupBig', page: () => popup({ x: 7, y: 8 }, 'popbig') },
  { label: 'popupHotspot', page: () => popup({ x: 0, y: 0 }, 'pop', [hotspotObject(2, rect(0, 0, 45, 4))]) },
  { label: 'popupWide', page: () => popup({ x: 600, y: 400 }, 'popbig') },
  {
    label: 'missing',
    page: () =>
      page({ pageType: 'base', templateId: 7, panels: [display(1, [bitmapObject(1, 0, 0, 'nothere')])] }),
  },
  {
    label: 'widgets',
    page: () =>
      page({
        pageType: 'base',
        templateId: 7,
        panels: [
          display(1, [
            {
              kind: 'cancelButton',
              id: 1,
              flags: 0,
              rect: rect(10, 10, 74, 34),
              cursor: null,
              handlers: [],
              unknownStrings: [null, null, null],
            },
            {
              kind: 'animationControl',
              id: 2,
              flags: 0,
              rect: rect(100, 10, 300, 300),
              cursor: null,
              handlers: [],
              unknown1: 0,
              unknownRect: rect(100, 10, 300, 300),
              file: 'anim',
              unknownCursor: null,
              unknown2: 0,
              unknown3: 0,
              unknown4: 59,
            },
            {
              kind: 'scrollBitmap',
              id: 3,
              rect: rect(10, 100, 30, 120),
              cursor: null,
              unknown1: 0,
              unknown2: 0,
              unknown3: 0,
              unknown4: 0,
              unknown5: 0,
              file: 'tall',
            },
            {
              kind: 'scrollBar',
              id: 4,
              rect: rect(50, 100, 66, 200),
              cursor: null,
              unknown1: 0,
              unknown2: 3,
              unknown3: 0,
              unknown4: 0,
              unknown5: 0,
              parts: [
                '@LINEUP',
                '@LINEDOWN',
                '@THUMB',
                '@THUMBTRACK',
                '@LINEUP',
                '@LINEDOWN',
                '@THUMB',
                '@THUMBTRACK',
              ],
            },
          ]),
        ],
      }),
  },
  {
    label: 'dial',
    page: () =>
      page({
        pageType: 'base',
        templateId: 77,
        directory: '\\AZ\\',
        panels: [
          {
            kind: 'azDial',
            id: 78,
            objects: [bitmapObject(1, 0, 0, 'azbg')],
            handlers: [],
            letterPages: Array.from({ length: 26 }, () => null),
            letterAnimations: [...letters].map((letter) => `azl${letter}`),
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
  startupPage: ref('base'),
  handlers: [],
  templates: [
    template({
      id: 7,
      pageType: 'base',
      panels: [
        panelSlot(1, CONTENT.x, CONTENT.y, 300, 300, 0xff0000),
        panelSlot(849, 0, 0, 20, 50, 0x000000, ref('nav')),
        panelSlot(387, 320, 4, 10, 300, 0x00ff00),
        panelSlot(9, 630, 450, 20, 20, 0x0000ff),
      ],
    }),
    template({
      id: 77,
      pageType: 'base',
      panels: [{ ...panelSlot(78, CONTENT.x, CONTENT.y, 400, 400, 0xfffbf0), panelType: 'azDial' }],
    }),
    // Like the disc's popup template 0: origin relative to panel 1 of template 7, caption, shadow 4.
    template({
      id: 0,
      pageType: 'popup',
      unknown1: [7, 1],
      unknown3: 1,
      unknown4: 4,
      panels: [panelSlot(5, 0, 0, 0, 0, 0xfffbf0)],
    }),
  ],
});

const files: Record<string, Uint8Array> = {
  'ART/UNDER.DIB': syntheticDib(10, 10, 20),
  'ART/OVER.DIB': syntheticDib(10, 10, 30),
  'ART/BIG.DIB': syntheticDib(40, 50, 31),
  'NAV/NAV.DIB': syntheticDib(20, 60, 11),
  'ART/POP.DIB': syntheticDib(30, 10, (x) => 40 + x),
  'ART/POPBIG.DIB': syntheticDib(50, 16, 90),
  'ART/TALL.DIB': syntheticDib(20, 50, (_x, y) => 100 + y),
  'AZ/AZBG.DIB': syntheticDib(400, 400, 50),
  ...Object.fromEntries(
    [...letters].map((letter, i) => [`AZ/AZL${letter}.DIB`, syntheticDib(5, 5, 200 + i)]),
  ),
};

const { source, refs } = syntheticDisc({ product, heap }, files);
const ref = (label: string): number => refs.get(label)!;

function pixel(fb: Framebuffer, x: number, y: number): number {
  return fb.pixels[y * fb.width + x]!;
}

describe('Engine', () => {
  let engine: Engine;
  let fb: Framebuffer;

  beforeEach(async () => {
    engine = await Engine.load(source);
    fb = createFramebuffer();
  });

  it('loads the palette and shows the startup page', () => {
    expect(engine.palette).toHaveLength(768);
    expect([...engine.palette.subarray(RED * 3, RED * 3 + 3)]).toEqual([255, 0, 0]);
    expect(engine.basePage?.ref).toBe(ref('base'));
    expect(engine.windows).toEqual([]);
  });

  describe('page instantiation', () => {
    it("lists the page's panels, then the template's shared and empty slots", () => {
      const panels = engine.basePage!.panels;
      expect(panels.map((p) => [p.id, p.source])).toEqual([
        [1, 'page'],
        [849, 'shared'],
        [387, 'empty'],
        [9, 'empty'],
      ]);
      expect(panels.map((p) => [p.x, p.y, p.width, p.height])).toEqual([
        [20, 4, 300, 300],
        [0, 0, 20, 50],
        [320, 4, 10, 300],
        [630, 450, 20, 20],
      ]);
      expect(panels.map((p) => p.colour)).toEqual([RED, 0, GREEN, BLUE]);
      expect(engine.basePage!.problems).toEqual([]);
    });

    it('takes Bitmap rectangles from the picture size', () => {
      const [under, , hotspot] = engine.basePage!.panels[0]!.objects;
      expect(under!.rect).toEqual(rect(2, 3, 12, 13));
      expect(hotspot!.rect).toEqual(rect(0, 0, 300, 300));
      expect(hotspot!.look).toBeNull();
    });

    it('sizes a size-0 panel to the extent of its objects', async () => {
      const plain = await engine.loadPage(ref('popup'));
      expect([plain.panels[0]!.width, plain.panels[0]!.height, plain.width, plain.height]).toEqual([
        30, 10, 30, 10,
      ]);
      const wider = await engine.loadPage(ref('popupHotspot'));
      expect([wider.width, wider.height]).toEqual([45, 10]);
    });

    it('maps panel colours to static palette entries first', async () => {
      const dial = await engine.loadPage(ref('dial'));
      expect(dial.panels[0]!.colour).toBe(CREAM);
    });

    it('records a picture that fails to load and paints the panel colour instead', async () => {
      await engine.changePage(ref('missing'));
      expect(engine.basePage!.problems).toEqual([expect.stringContaining('ART/nothere.DIB')]);
      engine.render(fb);
      expect(pixel(fb, CONTENT.x, CONTENT.y)).toBe(RED);
    });

    it('decodes each picture file once', async () => {
      const before = source.reads.filter((path) => path === 'ART/POP.DIB').length;
      await engine.openPopup(ref('popup'));
      await engine.openPopup(ref('popupSameSize'));
      await engine.openPopup(ref('popup'));
      expect(source.reads.filter((path) => path === 'ART/POP.DIB').length - before).toBeLessThanOrEqual(1);
    });
  });

  describe('painting a base page', () => {
    beforeEach(() => engine.render(fb));

    it('fills panels with their colour and draws objects in data order', () => {
      expect(pixel(fb, CONTENT.x, CONTENT.y)).toBe(RED);
      expect(pixel(fb, CONTENT.x + 2, CONTENT.y + 3)).toBe(20);
      // "over" (6,7)–(16,17) is drawn after "under" (2,3)–(12,13).
      expect(pixel(fb, CONTENT.x + 8, CONTENT.y + 9)).toBe(30);
      expect(pixel(fb, CONTENT.x + 11, CONTENT.y + 6)).toBe(20);
    });

    it('clips objects to their panel', () => {
      // "big" is 40×50 at (280,290) in a 300×300 panel.
      expect(pixel(fb, CONTENT.x + 299, CONTENT.y + 299)).toBe(31);
      expect(pixel(fb, CONTENT.x + 300, CONTENT.y + 299)).toBe(GREEN); // the next panel
      expect(pixel(fb, CONTENT.x + 299, CONTENT.y + 300)).toBe(0); // no panel there
      // The shared nav picture is 60 high in a 50-high slot.
      expect(pixel(fb, 0, 49)).toBe(11);
      expect(pixel(fb, 0, 50)).toBe(0);
    });

    it('leaves everything outside the 638×459 client area at index 0', () => {
      expect(pixel(fb, CLIENT_WIDTH - 1, CLIENT_HEIGHT - 1)).toBe(BLUE);
      for (let y = 0; y < SCREEN_HEIGHT; y++) {
        for (let x = 0; x < SCREEN_WIDTH; x++) {
          if (x >= CLIENT_WIDTH || y >= CLIENT_HEIGHT) expect(pixel(fb, x, y)).toBe(0);
        }
      }
    });
  });

  describe('objects at rest', () => {
    beforeEach(async () => {
      await engine.changePage(ref('widgets'));
      engine.render(fb);
    });
    const at = (x: number, y: number): number => pixel(fb, CONTENT.x + x, CONTENT.y + y);

    it('draws the CancelButton picture at its natural size', () => {
      expect(at(10, 10)).toBe(170);
      expect(at(71, 31)).toBe(170);
      expect(at(72, 10)).toBe(RED);
      expect(at(10, 32)).toBe(RED);
    });

    it('draws the AnimationControl strip at rest, 74×22', () => {
      const control = engine.basePage!.panels[0]!.objects[1]!;
      expect(control.rect).toEqual(rect(100, 10, 174, 32));
      expect(at(100, 10)).toBe(101);
      expect(at(103, 3 + 10)).toBe(115);
      expect(at(120, 3 + 10)).toBe(116);
      expect(at(139, 17)).toBe(101); // no progress indicator at rest
      expect(at(174, 10)).toBe(RED);
    });

    it("draws a ScrollBitmap's rectangle from the top of its picture", () => {
      expect(at(10, 100)).toBe(100);
      expect(at(29, 119)).toBe(119);
      expect(at(10, 120)).toBe(RED);
      expect(at(30, 100)).toBe(RED);
    });

    it('draws a ScrollBar with its thumb at the top of the track', () => {
      expect([at(50, 100), at(50, 101), at(65, 115)]).toEqual([60, 61, 61]); // up arrow
      expect([at(50, 116), at(50, 131)]).toEqual([80, 81]); // thumb
      expect([at(50, 132), at(50, 133), at(50, 183)]).toEqual([90, 91, 91]); // track from row 16
      expect([at(50, 184), at(50, 199)]).toEqual([70, 71]); // down arrow
      expect(at(66, 150)).toBe(RED);
    });
  });

  describe('the A–Z dial', () => {
    beforeEach(() => engine.changePage(ref('dial')));

    it("draws the current letter's picture and the lamp", () => {
      engine.render(fb);
      expect(pixel(fb, CONTENT.x + 161, CONTENT.y + 101)).toBe(200);
      expect(pixel(fb, CONTENT.x + 160, CONTENT.y + 101)).toBe(50);
      expect(pixel(fb, CONTENT.x + 334 + 17, CONTENT.y + 350)).toBe(173); // lamp off is 18 wide

      const dial = engine.basePage!.panels[0]!.dial!;
      dial.letter = 2;
      dial.lampOn = true;
      engine.render(fb);
      expect(pixel(fb, CONTENT.x + 161, CONTENT.y + 101)).toBe(202);
      expect(pixel(fb, CONTENT.x + 334, CONTENT.y + 350)).toBe(172);
      expect(pixel(fb, CONTENT.x + 334 + 17, CONTENT.y + 350)).toBe(50);
    });
  });

  describe('popup windows (Windows 3.1)', () => {
    // Window top-left = (−1, −20) frame + (20, 4) reference panel + origin (100, 200) + (0, 20).
    const wx = 119;
    const wy = 204;

    beforeEach(async () => {
      await engine.openPopup(ref('popup'));
      engine.render(fb);
    });
    const win = (x: number, y: number): number => pixel(fb, wx + x, wy + y);

    it('places the window and draws the picture below an 8-pixel caption strip', () => {
      expect(engine.windows.map((w) => [w.x, w.y, w.caption, w.shadow])).toEqual([[wx, wy, 8, 4]]);
      expect(win(0, 8)).toBe(40);
      expect(win(29, 17)).toBe(69);
    });

    it('draws the caption strip and system box', () => {
      // Frame colour: row 0 x 0–11, column 0, column 12.
      expect([win(0, 0), win(11, 0), win(0, 7), win(12, 1), win(12, 7)]).toEqual([0, 0, 0, 0, 0]);
      expect([win(1, 1), win(11, 7), win(10, 2)]).toEqual([LIGHT_GREY, LIGHT_GREY, LIGHT_GREY]);
      // The bar: dark grey x 4–10 rows 4–6, black x 3–9 rows 3–5, white x 4–8 row 4.
      expect([win(10, 6), win(4, 6), win(10, 4)]).toEqual([DARK_GREY, DARK_GREY, DARK_GREY]);
      expect([win(3, 3), win(9, 5), win(9, 4)]).toEqual([0, 0, 0]);
      expect([win(4, 4), win(8, 4)]).toEqual([WHITE, WHITE]);
      // The bordered caption rectangle (11,0)–(30,9), filled with the active caption colour.
      expect([win(12, 0), win(29, 0), win(29, 7)]).toEqual([0, 0, 0]);
      expect([win(13, 1), win(28, 7)]).toEqual([NAVY, NAVY]);
    });

    it('stipples the shadow over the base page, black where page x + y is even', () => {
      // Window 34×22: right strip x 30–33 rows 4–21, bottom strip rows 18–21 x 4–33.
      for (const [x, y] of [
        [30, 4],
        [32, 21],
        [4, 18],
        [20, 20],
      ] as const) {
        expect(win(x, y)).toBe((wx + x + wy + y) % 2 === 0 ? 0 : RED);
        expect(win(x + 1, y) + win(x, y)).toBe(RED); // neighbours alternate
      }
      // Not shadow: the top-right and bottom-left corners, and the pixels beyond.
      expect([win(30, 0), win(33, 3), win(0, 18), win(3, 21), win(34, 10), win(10, 22)]).toEqual([
        RED,
        RED,
        RED,
        RED,
        RED,
        RED,
      ]);
    });

    it('shows inactive captions on all but the top window', async () => {
      await engine.openPopup(ref('popupWide'));
      engine.render(fb);
      expect(win(13, 1)).toBe(WHITE);
    });

    it('clips windows that reach past the stage', async () => {
      await engine.openPopup(ref('popupWide'));
      engine.render(fb);
      // Window at (619, 404), 54×30: the picture starts at (619, 412).
      expect(pixel(fb, 639, 412)).toBe(90);
      expect(pixel(fb, 639, 427)).toBe(90);
    });

    it('closes the top window, or a given page', async () => {
      await engine.openPopup(ref('popupBig'));
      expect(engine.closePopup(ref('popup'))).toBe(true);
      expect(engine.windows.map((w) => w.page.ref)).toEqual([ref('popupBig')]);
      expect(engine.closePopup()).toBe(true);
      expect(engine.closePopup()).toBe(false);
      engine.render(fb);
      expect(win(0, 8)).toBe(RED);
    });

    it('ChangePage keeps the window in place for a page of the same size', async () => {
      await engine.changePage(ref('popupSameSize'));
      expect(engine.windows.map((w) => [w.page.ref, w.x, w.y])).toEqual([[ref('popupSameSize'), wx, wy]]);
    });

    it('ChangePage moves a resized window without the caption-height term', async () => {
      await engine.changePage(ref('popupBig'));
      // (−1, −20) + (20, 4) + origin (7, 8).
      expect(engine.windows.map((w) => [w.page.ref, w.x, w.y])).toEqual([[ref('popupBig'), 26, -8]]);
    });

    it('ChangePage of a base page keeps the windows open', async () => {
      await engine.changePage(ref('widgets'));
      expect(engine.basePage?.ref).toBe(ref('widgets'));
      expect(engine.windows).toHaveLength(1);
    });

    it('refuses to open a base page as a popup', async () => {
      await expect(engine.openPopup(ref('base'))).rejects.toThrow(/base page/);
    });
  });

  describe('popup windows (Wine)', () => {
    it('places windows (−2, −3) from Windows 3.1 and stipples the shadow over white', async () => {
      const wine = await Engine.load(source, { presentation: 'wine' });
      await wine.openPopup(ref('popup'));
      wine.render(fb);
      const [wx, wy] = [117, 201];
      expect(wine.windows.map((w) => [w.x, w.y])).toEqual([[wx, wy]]);
      expect(pixel(fb, wx, wy + 8)).toBe(40);
      // Corners and shadow show white; black where page x + y is odd.
      expect([pixel(fb, wx + 30, wy), pixel(fb, wx, wy + 21)]).toEqual([WHITE, WHITE]);
      const [sx, sy] = [wx + 31, wy + 10];
      expect(pixel(fb, sx, sy)).toBe((sx + sy) % 2 === 1 ? 0 : WHITE);
      expect(pixel(fb, sx + 1, sy)).toBe((sx + sy) % 2 === 1 ? WHITE : 0);
    });
  });

  it('can start without a page', async () => {
    const empty = await Engine.load(source, { startPage: null });
    expect(empty.basePage).toBeNull();
    fb.pixels.fill(7);
    empty.render(fb);
    expect(fb.pixels.every((value) => value === 0)).toBe(true);
  });
});
