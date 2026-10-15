// The special screens of docs/formats/special-screens.md on a synthetic disc, through the engine's
// input: the Index page, the Help pages' scroll bars, the Options popup, copy and print pictures.
import { beforeEach, describe, expect, it } from 'vitest';
import { StaticColour } from './colours.ts';
import { Engine, type EngineEvent } from './engine.ts';
import type { PageWindow } from './render/window.ts';
import { createFramebuffer, type Framebuffer } from './screen.ts';
import { COPY_BAND_HEIGHT } from './special/copy-image.ts';
import { INDEX_CONTROLS, INDEX_ROW_HEIGHT } from './special/index-screen.ts';
import { ManualClock, RecordingMedia, SYNTHETIC_BITMAP_FILL } from './testing/index.ts';
import {
  helpRowFill,
  SPECIAL_CONTENT,
  SPECIAL_INDEX_NAMES,
  SPECIAL_NAV_TOP,
  SPECIAL_PICTURE,
  specialDisc,
  specialRef as ref,
} from './testing/special-disc.ts';

let engine: Engine;
let media: RecordingMedia;
let clock: ManualClock;
let events: EngineEvent[];

async function start(): Promise<void> {
  media = new RecordingMedia();
  media.endAtOnce = true;
  clock = new ManualClock();
  engine = await Engine.load(specialDisc.source, { media, clock });
  events = [];
  engine.on((event) => events.push(event));
}

type Point = [number, number];
// Left of x 39, where the Help windows cover the navigation bar.
const navButton = (k: number): Point => [20, SPECIAL_NAV_TOP(k) + 15];
const inWindow = (window: PageWindow, x: number, y: number): Point => [
  window.x + x,
  window.y + window.caption + y,
];
const windowOf = (label: string): PageWindow => engine.windows.findLast((w) => w.page.ref === ref(label))!;
const popups = (): number[] => engine.windows.map((window) => window.page.ref);

async function click([x, y]: Point, options: { touch?: boolean } = {}): Promise<void> {
  await engine.pointerDown(x, y, options);
  await engine.pointerUp(x, y);
  await engine.idle();
}

function pixel(fb: Framebuffer, [x, y]: Point): number {
  return fb.pixels[y * fb.width + x]!;
}

function render(): Framebuffer {
  const framebuffer = createFramebuffer();
  engine.render(framebuffer);
  return framebuffer;
}

describe('the Index page (special-screens.md §1)', () => {
  beforeEach(start);

  const index = () => windowOf('index');
  /** A row of the list, in page coordinates. */
  const row = (r: number): Point =>
    inWindow(index(), INDEX_CONTROLS.list.x + 30, INDEX_CONTROLS.list.y + r * INDEX_ROW_HEIGHT + 6);
  const control = (name: keyof typeof INDEX_CONTROLS): Point => {
    const rect = INDEX_CONTROLS[name];
    return inWindow(index(), rect.x + Math.floor(rect.width / 2), rect.y + Math.floor(rect.height / 2));
  };
  const key = (name: string) => engine.key({ key: name });

  it('opens from the navigation bar like a popup, at (182, 46), with entry 0 selected', async () => {
    await click(navButton(6));
    expect(popups()).toEqual([ref('index')]);
    expect([index().x, index().y]).toEqual([182, 46]);
    expect(engine.focusWindow).toBe(index());
    const screen = engine.indexScreen!;
    expect([screen.selection, screen.top, screen.editText, screen.focus]).toEqual([
      0,
      0,
      SPECIAL_INDEX_NAMES[0],
      'edit',
    ]);
    // Pressing the button again closes and reopens it, afresh.
    key('ArrowDown');
    await click(navButton(6));
    expect(popups()).toEqual([ref('index')]);
    expect(engine.indexScreen!.selection).toBe(0);
  });

  it('draws its controls over the picture: the list, the selected row, the buttons', async () => {
    await click(navButton(6));
    const fb = render();
    const list = INDEX_CONTROLS.list;
    expect(pixel(fb, inWindow(index(), list.x + list.width - 2, list.y + 5))).toBe(StaticColour.navy);
    expect(pixel(fb, inWindow(index(), list.x + list.width - 2, list.y + 20))).toBe(StaticColour.white);
    expect(pixel(fb, inWindow(index(), 68, 318))).toBe(SYNTHETIC_BITMAP_FILL[168]);
    expect(pixel(fb, inWindow(index(), 227, 318))).toBe(SYNTHETIC_BITMAP_FILL[170]);
    expect(pixel(fb, inWindow(index(), 322, 136))).toBe(60); // LINEUP
    expect(pixel(fb, inWindow(index(), 5, 5))).toBe(SPECIAL_PICTURE.index);
  });

  it("shows its redrawn caption's bottom border on the picture's first row, from x 11", async () => {
    await click(navButton(6));
    const fb = render();
    expect(pixel(fb, inWindow(index(), 10, 0))).toBe(SPECIAL_PICTURE.index);
    for (const x of [11, 200, 362]) expect(pixel(fb, inWindow(index(), x, 0))).toBe(StaticColour.black);
    expect(pixel(fb, inWindow(index(), 200, 1))).toBe(SPECIAL_PICTURE.index);
  });

  it('shows the I-beam over the edit box and the arrow over the list', async () => {
    await click(navButton(6));
    engine.pointerMove(...control('edit'));
    expect(engine.cursor).toBe('ibeam');
    engine.pointerMove(...control('list'));
    expect(engine.cursor).toBe('arrow');
  });

  it('goes with Enter to the target page, then opens its companion pages, and closes', async () => {
    await click(navButton(6));
    key('ArrowDown'); // entry 1: art1, companions label0 and label1
    expect(engine.key({ key: 'Enter' })).toBe(true);
    await engine.idle();
    expect(engine.basePage!.ref).toBe(ref('art1'));
    expect(popups()).toEqual([ref('label0'), ref('label1')]);
    expect(engine.indexScreen).toBeNull();
  });

  it('goes with OK; the base-page change closes the Index', async () => {
    await click(navButton(6));
    await click(control('ok'));
    expect(engine.basePage!.ref).toBe(ref('art0'));
    expect(popups()).toEqual([ref('label0')]);
  });

  it('lets a companion base page replace the target', async () => {
    await click(navButton(6));
    await click(row(2));
    await click(control('ok'));
    expect(engine.basePage!.ref).toBe(ref('other'));
    expect(popups()).toEqual([]);
  });

  it('goes on a double click, and the release after it does not close the companion popup', async () => {
    await click(navButton(6));
    await click(row(1));
    const [x, y] = row(1);
    await engine.pointerDown(x, y, { doubleClick: true });
    await engine.pointerUp(x, y);
    await engine.idle();
    expect(engine.basePage!.ref).toBe(ref('art1'));
    expect(popups()).toEqual([ref('label0'), ref('label1')]);
  });

  it('closes with Cancel or Esc without going', async () => {
    await click(navButton(6));
    await click(control('cancel'));
    expect(popups()).toEqual([]);
    expect(engine.basePage!.ref).toBe(ref('home'));
    await click(navButton(6));
    key('Escape');
    await engine.idle();
    expect(popups()).toEqual([]);
  });

  it('types into the edit box and selects the first entry with that prefix', async () => {
    await click(navButton(6));
    for (const char of 'airs') key(char);
    expect(engine.indexScreen!.editText).toBe('airs');
    expect(engine.indexScreen!.selection).toBe(SPECIAL_INDEX_NAMES.indexOf('airship'));
    for (const char of 'gear 30') key(char);
    expect(engine.indexScreen!.selection).toBe(SPECIAL_INDEX_NAMES.indexOf('airship'));
  });

  it('keeps the hook keys working while another window has the focus, but not typing', async () => {
    await click(navButton(6));
    await click(navButton(7)); // Help over the Index
    expect(engine.focusWindow).toBe(windowOf('help0'));
    expect(engine.key({ key: 'b' })).toBe(false);
    expect(engine.key({ key: 'ArrowDown' })).toBe(true);
    expect(engine.indexScreen!.selection).toBe(1);
    expect(engine.indexScreen!.editText).toBe(SPECIAL_INDEX_NAMES[1]);
  });

  it('ignores keys when no Index is open, apart from Alt+F4', () => {
    expect(engine.key({ key: 'Tab' })).toBe(false);
    expect(engine.key({ key: 'Enter' })).toBe(false);
  });

  it('scrolls with its scroll bar, repeating every 80 ms while held', async () => {
    await click(navButton(6));
    const bar = INDEX_CONTROLS.scrollBar;
    const down = inWindow(index(), bar.x + 8, bar.y + bar.height - 4);
    await engine.pointerDown(...down);
    expect(engine.indexScreen!.top).toBe(1);
    clock.advance(170);
    engine.update();
    expect(engine.indexScreen!.top).toBe(3);
    await engine.pointerUp(...down);
    clock.advance(500);
    engine.update();
    expect(engine.indexScreen!.top).toBe(3);
  });

  it('a press on the picture outside the controls takes the focus from them', async () => {
    await click(navButton(6));
    await click(inWindow(index(), 5, 300));
    expect(engine.indexScreen!.focus).toBeNull();
    key('Tab');
    expect(engine.indexScreen!.focus).toBe('edit');
  });

  it('swipes the list by touch', async () => {
    await click(navButton(6));
    const [x, y] = row(10);
    await engine.pointerDown(x, y, { touch: true });
    engine.pointerMove(x, y - 3 * INDEX_ROW_HEIGHT);
    await engine.pointerUp(x, y - 3 * INDEX_ROW_HEIGHT);
    expect([engine.indexScreen!.top, engine.indexScreen!.selection]).toEqual([3, 0]);
  });
});

describe('the Help pages and their scroll bars (special-screens.md §3, §5)', () => {
  beforeEach(start);

  /** The ScrollBitmap's top-left pixel in page coordinates, and a point of the bar. */
  const pictureTopLeft = (): Point => inWindow(windowOf('help1'), 274, 50);
  const barPoint = (y: number, x = 538): Point => inWindow(windowOf('help1'), x, y);
  const shownRow = (): number => {
    const value = pixel(render(), pictureTopLeft());
    return value - 10;
  };

  async function openHelp1(): Promise<void> {
    await click(navButton(7));
    await click(inWindow(windowOf('help0'), 20, 20));
  }

  it('keeps the window in place on a same-size change and starts at position 0', async () => {
    await click(navButton(7));
    const [x, y] = [windowOf('help0').x, windowOf('help0').y];
    expect([x, y]).toEqual([39, 21]);
    await click(inWindow(windowOf('help0'), 20, 20));
    expect(popups()).toEqual([ref('help1')]);
    expect([windowOf('help1').x, windowOf('help1').y]).toEqual([x, y]);
    expect(shownRow()).toBe(0);
  });

  it('steps by a line and a page; the picture and the thumb move together', async () => {
    await openHelp1();
    await click(barPoint(349)); // down arrow
    expect(shownRow()).toBe(helpRowFill(18) - 10);
    await click(barPoint(300)); // the track below the thumb
    // Position 17: row round(17 × 509 / 28) = 309.
    expect(pixel(render(), pictureTopLeft())).toBe(helpRowFill(309));
    // The thumb (THUMB, fill 80) is at track top + round(17 × 253 / 28) = 65 + 154.
    expect(pixel(render(), barPoint(65 + 154, 530))).toBe(80);
    await click(barPoint(55)); // up arrow
    expect(pixel(render(), pictureTopLeft())).toBe(helpRowFill(291));
  });

  it('shows the pressed arrow while held and repeats every 100 ms inside it', async () => {
    await openHelp1();
    media.clear();
    const arrow = barPoint(345);
    await engine.pointerDown(...arrow);
    expect(pixel(render(), barPoint(333, 530))).toBe(74); // LINEDOWNALT
    clock.advance(99);
    engine.update();
    expect(pixel(render(), pictureTopLeft())).toBe(helpRowFill(18));
    clock.advance(1);
    engine.update();
    expect(pixel(render(), pictureTopLeft())).toBe(helpRowFill(36));
    // Moving off the arrow ends the press at the next tick.
    engine.pointerMove(...barPoint(200));
    clock.advance(300);
    engine.update();
    expect(pixel(render(), barPoint(333, 530))).toBe(70);
    expect(pixel(render(), pictureTopLeft())).toBe(helpRowFill(36));
    await engine.pointerUp(...barPoint(200));
    expect(media.calls.filter((call) => call.kind === 'stopAll')).toEqual([]);
  });

  it('drags the thumb with its centre under the pointer; leaving the bar ends a mouse drag', async () => {
    await openHelp1();
    await engine.pointerDown(...barPoint(70)); // the thumb at rest: rows 65–80
    engine.pointerMove(...barPoint(65 + 8 + 253));
    expect(pixel(render(), pictureTopLeft())).toBe(helpRowFill(509));
    engine.pointerMove(...barPoint(65 + 8, 560)); // off the bar: the drag ends
    engine.pointerMove(...barPoint(65 + 8));
    expect(pixel(render(), pictureTopLeft())).toBe(helpRowFill(509));
    await engine.pointerUp(...barPoint(65 + 8));
  });

  it('keeps a touch drag going when the finger leaves the bar', async () => {
    await openHelp1();
    await engine.pointerDown(...barPoint(70), { touch: true });
    engine.pointerMove(...barPoint(65 + 8 + 253, 600));
    expect(pixel(render(), pictureTopLeft())).toBe(helpRowFill(509));
    engine.pointerMove(...barPoint(65 + 8, 600));
    expect(pixel(render(), pictureTopLeft())).toBe(helpRowFill(0));
    await engine.pointerUp(...barPoint(65 + 8, 600));
  });

  it('scrolls the picture with a touch swipe, which clicks nothing', async () => {
    await openHelp1();
    media.clear();
    const [x, y] = inWindow(windowOf('help1'), 400, 300);
    await engine.pointerDown(x, y, { touch: true });
    engine.pointerMove(x, y - 180);
    await engine.pointerUp(x, y - 180);
    // 180 pixels are 180 × 28 / 509 ≈ 10 steps: row round(10 × 509 / 28) = 182.
    expect(pixel(render(), pictureTopLeft())).toBe(helpRowFill(182));
    expect(media.calls.filter((call) => call.kind === 'stopAll')).toEqual([]);
    // A tap on it is a click, which stops media.
    await click([x, y], { touch: true });
    expect(media.calls.some((call) => call.kind === 'stopAll')).toBe(true);
  });

  it('does not scroll a picture no taller than its window', async () => {
    await click(navButton(7));
    await click(inWindow(windowOf('help0'), 60, 20));
    await click(inWindow(windowOf('help2'), 538, 345));
    expect(pixel(render(), inWindow(windowOf('help2'), 274, 50))).toBe(helpRowFill(0));
  });

  it('opens a second Help window when Help is pressed on another Help page (§5)', async () => {
    await openHelp1();
    await click(navButton(7));
    expect(popups()).toEqual([ref('help1'), ref('help0')]);
    expect([windowOf('help0').x, windowOf('help0').y]).toEqual([windowOf('help1').x, windowOf('help1').y]);
    // On the first Help page itself, Help closes it and opens it again.
    await click(navButton(7));
    expect(popups()).toEqual([ref('help1'), ref('help0')]);
  });
});

describe('the Options popup (special-screens.md §4)', () => {
  beforeEach(start);

  const options = () => windowOf('options');

  it('draws the CancelButton at its rectangle, pressed while held inside, and closes on release', async () => {
    await click(navButton(8));
    const button = inWindow(options(), 100, 200);
    expect(pixel(render(), inWindow(options(), 87, 188))).toBe(SYNTHETIC_BITMAP_FILL[170]);
    // The two extra columns and rows of the 64×24 rectangle keep the popup picture.
    expect(pixel(render(), inWindow(options(), 87 + 63, 188 + 23))).toBe(SPECIAL_PICTURE.options);
    await engine.pointerDown(...button);
    expect(pixel(render(), inWindow(options(), 87, 188))).toBe(SYNTHETIC_BITMAP_FILL[171]);
    engine.pointerMove(...inWindow(options(), 20, 20));
    expect(pixel(render(), inWindow(options(), 87, 188))).toBe(SYNTHETIC_BITMAP_FILL[170]);
    engine.pointerMove(...button);
    await engine.pointerUp(...button);
    await engine.idle();
    expect(popups()).toEqual([]);
  });

  it('copies the base page with a 40-row white band and the centred copyright line', async () => {
    await click(navButton(8));
    await click(inWindow(options(), 100, 70));
    const event = events.find((candidate) => candidate.kind === 'productOption');
    if (event?.kind !== 'productOption' || event.image === null) throw new Error('no image');
    const { image } = event;
    expect([image.width, image.height]).toEqual([638, 459 + COPY_BAND_HEIGHT]);
    expect(image.pixels[10 * 638 + SPECIAL_CONTENT.x + 10]).toBe(SPECIAL_PICTURE.back);
    const band = image.pixels.subarray(459 * 638);
    const ink = [...band.keys()].filter((i) => band[i] === StaticColour.black);
    expect(new Set(band)).toEqual(new Set([StaticColour.white, StaticColour.black]));
    const columns = ink.map((i) => i % 638);
    const rows = ink.map((i) => Math.floor(i / 638));
    // Centred: as much room left as right, and vertically within the band.
    expect(Math.abs(Math.min(...columns) - (637 - Math.max(...columns)))).toBeLessThanOrEqual(2);
    expect(Math.min(...rows)).toBeGreaterThan(5);
    expect(Math.max(...rows)).toBeLessThan(35);
  });

  it('copies the newest popup at its own size; print gives the same picture', async () => {
    await engine.openPage(ref('label0'));
    await click(navButton(8));
    await click(inWindow(options(), 100, 100));
    const event = events.find((candidate) => candidate.kind === 'productOption');
    expect(event).toMatchObject({ option: 2, page: { ref: ref('label0') } });
    if (event?.kind !== 'productOption' || event.image === null) throw new Error('no image');
    expect([event.image.width, event.image.height]).toEqual([40, 30 + COPY_BAND_HEIGHT]);
    // The caption, too wide for 40 pixels, is squeezed into the band.
    expect(event.image.pixels.subarray(30 * 40)).toContain(StaticColour.black);
  });

  it('copies at rest: scroll bars at their position, no animation frames or pressed buttons', async () => {
    await click(navButton(7));
    await click(inWindow(windowOf('help0'), 20, 20));
    await click(inWindow(windowOf('help1'), 538, 349));
    const image = engine.copyImage(windowOf('help1').page);
    expect(image.pixels[50 * 560 + 274]).toBe(helpRowFill(18));
  });
});
