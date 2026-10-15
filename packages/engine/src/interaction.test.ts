// Interaction rules of docs/formats/behaviour.md on a synthetic disc: hit-testing, clicks, events
// and actions, popups, the navigation bar and history, the A–Z machine, the zoom, cursors, keys.
import { beforeEach, describe, expect, it } from 'vitest';
import { Engine, type EngineEvent } from './engine.ts';
import type { PageWindow } from './render/window.ts';
import { createFramebuffer, type Framebuffer } from './screen.ts';
import { ManualClock, RecordingMedia, SYNTHETIC_BITMAP_FILL } from './testing/index.ts';
import {
  CONTENT,
  interactionDisc,
  interactionRef as ref,
  NAV_BUTTON_TOP,
  PICTURE,
} from './testing/interaction-disc.ts';

let engine: Engine;
let media: RecordingMedia;
let events: EngineEvent[];

async function start(page = 'home', options: { clock?: ManualClock } = {}): Promise<void> {
  media = new RecordingMedia();
  media.endAtOnce = true;
  engine = await Engine.load(interactionDisc.source, {
    startPage: ref(page),
    media,
    ...(options.clock === undefined ? {} : { clock: options.clock }),
  });
  events = [];
  engine.on((event) => events.push(event));
  media.clear();
}

/** A point of the content panel (94,4) in page coordinates. */
const content = (x: number, y: number): [number, number] => [CONTENT.x + x, CONTENT.y + y];
/** A point of a popup's picture. */
const inPopup = (window: PageWindow, x: number, y: number): [number, number] => [
  window.x + x,
  window.y + window.caption + y,
];
/** The centre of nav button k. */
const navButton = (k: number): [number, number] => [40, NAV_BUTTON_TOP(k) + 15];

async function click([x, y]: [number, number], release: [number, number] = [x, y]): Promise<void> {
  await engine.pointerDown(x, y);
  await engine.pointerUp(release[0], release[1]);
  await engine.idle();
}

const base = (): number | undefined => engine.basePage?.ref;
const popups = (): number[] => engine.windows.map((window) => window.page.ref);
const windowOf = (label: string): PageWindow => engine.windows.find((w) => w.page.ref === ref(label))!;

function pixel(fb: Framebuffer, x: number, y: number): number {
  return fb.pixels[y * fb.width + x]!;
}

/** Lets pending page loads (promise chains on the in-memory disc) settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

describe('hit-testing (behaviour.md §1)', () => {
  beforeEach(() => start());

  it('finds the first panel in panel-list order, with inclusive rectangles', () => {
    // Column 94 is shared by the nav bar (0–94) and the content panel (94–634): the page's own
    // panel comes first and wins.
    expect(engine.hitTest(94, 100)?.panel?.id).toBe(1);
    expect(engine.hitTest(93, 100)?.panel?.id).toBe(849);
    // Row 454 is shared by the content panel and the bottom frame.
    expect(engine.hitTest(200, 454)?.panel?.id).toBe(1);
    expect(engine.hitTest(200, 455)?.panel?.id).toBe(387);
  });

  it('finds the last object in data order, edges included', () => {
    expect(engine.hitTest(...content(35, 110))?.object?.object.id).toBe(22);
    expect(engine.hitTest(...content(20, 110))?.object?.object.id).toBe(21);
    const corner = engine.hitTest(...content(50, 30));
    expect(corner?.object?.object.id).toBe(10);
    expect([corner?.panelX, corner?.panelY]).toEqual([50, 30]);
    expect(engine.hitTest(...content(51, 30))?.object?.object.kind).toBe('bitmap');
  });

  it('lets the WordBox at (0,0)–(0,0) catch panel pixel (0,0)', () => {
    expect(engine.hitTest(...content(0, 0))?.object?.object.kind).toBe('wordBox');
  });

  it('finds nothing outside the 638×459 client area', () => {
    expect(engine.hitTest(638, 10)).toBeNull();
    expect(engine.hitTest(10, 459)).toBeNull();
    expect(engine.hitTest(637, 458)?.window).toBeNull();
  });

  it("classifies a popup's caption strip, system box and shadow (§5)", async () => {
    await engine.openPage(ref('pop1'));
    const w = windowOf('pop1'); // 60×40 picture: window 64×52
    const area = (x: number, y: number) => engine.hitTest(w.x + x, w.y + y)?.area;
    expect([area(0, 0), area(11, 7), area(11, 8)]).toEqual(['systemBox', 'systemBox', 'systemBox']);
    expect([area(12, 0), area(59, 8)]).toEqual(['caption', 'caption']);
    // Row 8 (the picture's first row) still counts as caption; row 9 is the picture's row 1.
    expect(area(30, 9)).toBe('client');
    expect(engine.hitTest(w.x + 30, w.y + 9)?.panelY).toBe(1);
    // The shadow bands, including the corners the stipple leaves out.
    expect([area(60, 0), area(63, 51), area(0, 48), area(59, 47)]).toEqual([
      'shadow',
      'shadow',
      'shadow',
      'client',
    ]);
    expect(engine.hitTest(w.x + 64, w.y)?.window).toBeNull();
  });
});

describe('clicks (behaviour.md §1.4–1.7, §3)', () => {
  beforeEach(() => start());

  it('does nothing on a press, and acts on the release', async () => {
    await engine.pointerDown(...content(70, 20));
    expect(base()).toBe(ref('home'));
    await engine.pointerUp(...content(70, 20));
    expect(base()).toBe(ref('article'));
  });

  it('counts a click only when press and release are on the same object', async () => {
    await click(content(70, 20), content(20, 20));
    expect([base(), popups()]).toEqual([ref('home'), []]);
    // The release outside the pressed object stops all media and nothing else.
    expect(media.of('stopAll')).toHaveLength(1);
  });

  it('tests the release one pixel lower than the pointer (§1.5)', async () => {
    await click(content(70, 30)); // bottom row of (60,10)–(100,30)
    expect(base()).toBe(ref('home'));
    await click(content(70, 29));
    expect(base()).toBe(ref('article'));
  });

  it('ignores the second press of a double click and its release (§1.7)', async () => {
    await engine.pointerDown(...content(70, 20), { doubleClick: true });
    await engine.pointerUp(...content(70, 20));
    expect(base()).toBe(ref('home'));
    await click(content(70, 20));
    expect(base()).toBe(ref('article'));
  });

  it('forgets a cancelled press', async () => {
    await engine.pointerDown(...content(70, 20));
    engine.pointerCancel();
    await engine.pointerUp(...content(70, 20));
    expect(base()).toBe(ref('home'));
  });

  it('stops all media on a click on a plain Bitmap', async () => {
    await click(content(300, 300));
    expect(media.of('stopAll')).toHaveLength(1);
    expect(base()).toBe(ref('home'));
  });

  describe('Hotspot flags while something plays', () => {
    beforeEach(() => {
      media.playing = true;
    });

    it('0x4: the click only stops the media', async () => {
      await click(content(70, 20));
      expect(media.of('stopAll')).toEqual([{ kind: 'stopAll', wasPlaying: true }]);
      expect(base()).toBe(ref('home'));
    });

    it('0x5: stops the media and acts anyway', async () => {
      await click(content(30, 50));
      expect(media.of('stopAll')).toHaveLength(1);
      expect(base()).toBe(ref('article'));
    });

    it('0x1: acts without stopping anything', async () => {
      await click(content(80, 50));
      expect(media.of('stopAll')).toHaveLength(0);
      expect(base()).toBe(ref('article'));
    });
  });

  describe('AnimHotspot (§3, playback.md §6)', () => {
    it('starts its animation; its end fires the finished handlers', async () => {
      media.endAtOnce = false;
      await click(content(30, 80));
      expect(media.of('animation').map((call) => [call.request.reason, call.request.path])).toEqual([
        ['click', 'ART/ANIM.ANI'],
      ]);
      expect(base()).toBe(ref('home'));
      media.endAnimations();
      await engine.idle();
      expect(base()).toBe(ref('article'));
    });

    it('only stops the media when something was playing', async () => {
      media.playing = true;
      await click(content(30, 80));
      expect(media.of('animation')).toEqual([]);
    });

    it('ignores the end of an animation whose page has gone', async () => {
      media.endAtOnce = false;
      await click(content(30, 80));
      await click(content(80, 80)); // to 'movie' (the animation is not stopped: nothing "played")
      media.endAnimations();
      await engine.idle();
      expect(base()).toBe(ref('movie'));
    });
  });

  it('starts autostart animations when a page opens and follows its finished handler', async () => {
    media.endAtOnce = false;
    await click(content(130, 80));
    expect(base()).toBe(ref('auto'));
    expect(media.of('animation').map((call) => call.request.reason)).toEqual(['autostart']);
    media.endAnimations();
    await engine.idle();
    expect(base()).toBe(ref('home'));
  });
});

describe('actions (behaviour.md §2, §4)', () => {
  beforeEach(() => start());

  it('runs media actions at once and page actions after the handler, in order', async () => {
    await click(content(180, 20)); // PLAYWAVE, CHANGEPAGE
    const [sound] = media.of('action');
    expect(sound?.action).toMatchObject({ kind: 'playWave', file: 'SND' });
    expect(sound?.target.page.ref).toBe(ref('home'));
    expect(base()).toBe(ref('article'));
  });

  it('does nothing for an OpenPage of a page already open', async () => {
    await click(content(180, 50)); // OPENPAGE pop1, OPENPAGE pop1
    expect(popups()).toEqual([ref('pop1')]);
    expect(await engine.openPage(ref('pop1'))).toBe(true);
    expect(popups()).toEqual([ref('pop1')]);
  });

  it('runs CHANGEPAGE, OPENPAGE of the same base page as one page change', async () => {
    await click(content(130, 50));
    expect([base(), popups()]).toEqual([ref('dial'), []]);
    expect(events).toEqual([]);
  });

  it('opens a popup owned by the active page, which takes the focus', async () => {
    await click(content(30, 20));
    const pop1 = windowOf('pop1');
    expect([pop1.owner, pop1.focusable, engine.focusWindow, engine.activeWindow]).toEqual([
      null,
      true,
      pop1,
      pop1,
    ]);
    await click(inPopup(pop1, 10, 10));
    const pop2 = windowOf('pop2');
    expect(pop2.owner).toBe(pop1);
    expect(engine.focusWindow).toBe(pop2);
  });

  it('ChangePage replaces the page in the popup window, moving it only if the size changes', async () => {
    await click(content(30, 20));
    const before = windowOf('pop1');
    const [x, y] = [before.x, before.y];
    await click(inPopup(before, 10, 35)); // to pop1b, same size
    expect(popups()).toEqual([ref('pop1b')]);
    expect([engine.windows[0]!.x, engine.windows[0]!.y]).toEqual([x, y]);
  });

  it('ChangePage of a popup of another size moves it to its origin without the caption term', async () => {
    await click(content(30, 20));
    await click(inPopup(windowOf('pop1'), 40, 10));
    expect(popups()).toEqual([ref('pop3')]);
    // (−1, −20) + reference panel (94, 4) + origin (50, 50).
    expect([engine.windows[0]!.x, engine.windows[0]!.y]).toEqual([143, 34]);
  });

  it('picks the focus popup for a ChangePage when several popups are open, and fails otherwise', async () => {
    await engine.openPage(ref('pop2'));
    await engine.openPage(ref('rela'));
    expect(await engine.changePage(ref('pop3'))).toBe(true);
    expect(popups()).toEqual([ref('pop2'), ref('pop3')]);
    // With no popup open, a ChangePage to a popup has no window.
    await engine.reset(ref('home'));
    expect(await engine.changePage(ref('pop3'))).toBe(false);
  });

  it('ChangePage to a base page closes every popup, whichever window issued it', async () => {
    await click(content(30, 20));
    await click(inPopup(windowOf('pop1'), 10, 10));
    expect(popups()).toEqual([ref('pop1'), ref('pop2')]);
    await engine.pointerDown(...inPopup(windowOf('pop1'), 40, 25));
    expect(popups()).toEqual([ref('pop1'), ref('pop2')]);
    await engine.pointerUp(...inPopup(windowOf('pop1'), 40, 25));
    // pop1 owns pop2: the click only closed it.
    expect(popups()).toEqual([ref('pop1')]);
    await click(inPopup(windowOf('pop1'), 40, 25));
    expect([base(), popups()]).toEqual([ref('article'), []]);
  });

  it('ClosePage closes the popup and gives the focus back to its opener', async () => {
    await click(content(30, 20));
    await click(inPopup(windowOf('pop1'), 10, 25));
    expect(popups()).toEqual([]);
    expect([engine.focusWindow, engine.activeWindow]).toEqual([null, null]);
  });

  it('routes SendMessage to the target object in the same panel (§4.5)', async () => {
    await click(content(80, 80)); // to the movie page: its panel's on_open sends (181, 59)
    const opened = media.of('control');
    expect(opened.map((call) => [call.request.kind, call.request.control.id])).toEqual([['message', 181]]);
    media.clear();
    await click(content(30, 20));
    await click(content(80, 20)); // no object 999: nothing
    const sent = media.of('control');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.request).toMatchObject({ kind: 'message', message: 59 });
    expect(sent[0]!.request.target.object?.object.id).toBe(181);
  });

  it('passes an AnimationControl click to the media', async () => {
    await click(content(80, 80));
    media.clear();
    await click(content(210, 305));
    expect(media.of('control').map((call) => call.request)).toMatchObject([
      { kind: 'click', x: 210, y: 306 },
    ]);
  });
});

describe('popups and their owners (behaviour.md §1.5, §5)', () => {
  beforeEach(async () => {
    await start();
    await click(content(30, 20));
    await click(inPopup(windowOf('pop1'), 10, 10));
  });

  it('a click on a page that owns popups closes them and does nothing else', async () => {
    await click(inPopup(windowOf('pop1'), 40, 10)); // would change to pop3
    expect(popups()).toEqual([ref('pop1')]);
    expect(media.of('stopAll').length).toBeGreaterThan(0);
    await click(content(70, 20)); // would change to the article
    expect([base(), popups()]).toEqual([ref('home'), []]);
  });

  it('the nav bar works while popups are open', async () => {
    await click(navButton(0));
    expect([base(), popups()]).toEqual([ref('home'), []]);
    expect(engine.history).toEqual([ref('home')]);
  });

  it('a press and release on the system box or the shadow closes the popup with those it owns', async () => {
    const pop1 = windowOf('pop1');
    await click([pop1.x + 3, pop1.y + 3]);
    expect(popups()).toEqual([]);
  });

  it('closes only when the release is on the same system box or shadow', async () => {
    const pop2 = windowOf('pop2');
    await click([pop2.x + 3, pop2.y + 3], [pop2.x + 30, pop2.y + 3]);
    expect(popups()).toEqual([ref('pop1'), ref('pop2')]);
    await click([pop2.x + 30, pop2.y + 3], [pop2.x + 3, pop2.y + 3]);
    expect(popups()).toEqual([ref('pop1'), ref('pop2')]);
    await click([pop2.x + 42, pop2.y + 20]); // the right shadow band
    expect(popups()).toEqual([ref('pop1')]);
  });

  it('drags a popup by its caption, with a dotted rectangle until the release', async () => {
    const pop2 = windowOf('pop2');
    const [x, y] = [pop2.x, pop2.y];
    await engine.pointerDown(x + 20, y + 3);
    engine.pointerMove(x + 30, y + 13);
    const fb = createFramebuffer();
    engine.render(fb);
    // The frame of the 40×38 window-minus-shadow rectangle at (x+10, y+10): every other pixel inverted.
    const top = [0, 1].map((dx) => pixel(fb, x + 10 + dx, y + 10));
    expect(top.some((value) => value === 255 - PICTURE.popup)).toBe(true);
    await engine.pointerUp(x + 30, y + 13);
    expect([pop2.x, pop2.y]).toEqual([x + 10, y + 10]);
    // A press that does not move leaves it in place.
    await click([pop2.x + 20, pop2.y + 3]);
    expect([pop2.x, pop2.y]).toEqual([x + 10, y + 10]);
  });

  it('a caption press on a popup that owns popups closes them instead of dragging', async () => {
    const pop1 = windowOf('pop1');
    const [x, y] = [pop1.x, pop1.y];
    await engine.pointerDown(x + 30, y + 3);
    expect(popups()).toEqual([ref('pop1')]);
    engine.pointerMove(x + 50, y + 23);
    await engine.pointerUp(x + 50, y + 23);
    expect([pop1.x, pop1.y]).toEqual([x, y]);
  });

  it('a press on a popup gives it the focus and brings it to the top with its owned windows', async () => {
    await engine.reset(ref('home'));
    // Two siblings owned by the main window.
    await engine.openPage(ref('pop2'));
    await click(navButton(6)); // the index page, owned by the main window (the nav bar was pressed)
    expect(popups()).toEqual([ref('pop2'), ref('index')]);
    expect(engine.focusWindow?.page.ref).toBe(ref('index'));
    const pop2 = windowOf('pop2');
    await engine.pointerDown(...inPopup(pop2, 1, 1));
    expect(popups()).toEqual([ref('index'), ref('pop2')]);
    expect(engine.focusWindow).toBe(pop2);
    const fb = createFramebuffer();
    engine.render(fb);
    expect(pixel(fb, pop2.x + 14, pop2.y + 2)).toBe(4); // navy: active caption
  });
});

describe('the navigation bar and history (behaviour.md §6)', () => {
  beforeEach(() => start());

  it('plays the button animation, then goes to its page; busy until done', async () => {
    media.endAtOnce = false;
    await engine.pointerDown(...navButton(0));
    const release = engine.pointerUp(...navButton(0));
    expect(engine.busy).toBe(true);
    expect(engine.cursor).toBe('wait');
    expect(media.pending.map((request) => [request.reason, request.path])).toEqual([
      ['nav', 'nav/navb0.ANI'],
    ]);
    // Input is ignored meanwhile.
    await engine.pointerDown(...content(70, 20));
    media.endAnimations();
    await release;
    await engine.idle();
    expect(engine.busy).toBe(false);
    expect(base()).toBe(ref('home'));
    expect(engine.history).toEqual([ref('home')]);
  });

  it('only stops the media when something was playing', async () => {
    media.playing = true;
    await click(navButton(2));
    expect(media.of('animation')).toEqual([]);
    expect(base()).toBe(ref('home'));
  });

  it('acts on the button the release lands on (§1.6)', async () => {
    await click(navButton(0), navButton(4));
    expect(base()).toBe(ref('inventors'));
  });

  it("uses the base page's links for four buttons", async () => {
    await click(navButton(1)); // Machines, no links: the dial
    expect(base()).toBe(ref('dial'));
    await engine.reset(ref('article'));
    await click(navButton(1)); // link 1
    expect(base()).toBe(ref('azlist'));
    await engine.reset(ref('article'));
    await click(navButton(2)); // Principles: link 0, a popup, so OpenPage
    expect([base(), popups()]).toEqual([ref('article'), [ref('rela')]]);
    await click(navButton(3));
    expect(base()).toBe(ref('timeline2'));
    await engine.reset(ref('article'));
    await click(navButton(4));
    expect(base()).toBe(ref('inventor2'));
  });

  it('Index and Help close their page if open, then open it again', async () => {
    await click(navButton(6));
    const first = windowOf('index');
    await click(navButton(6));
    expect(popups()).toEqual([ref('index')]);
    expect(windowOf('index')).not.toBe(first);
    await click(navButton(7));
    expect(popups()).toEqual([ref('index'), ref('help')]);
  });

  it('Options records the newest window for copy and print and opens the first Options popup', async () => {
    await click(content(30, 20)); // pop1
    await engine.openPage(ref('options2'));
    await click(navButton(8));
    expect(popups()).toEqual([ref('pop1'), ref('options')]);
    expect(windowOf('options').owner).toBe(windowOf('pop1'));
    await click(inPopup(windowOf('options'), 69, 5));
    await click(inPopup(windowOf('options'), 69, 12));
    const page = windowOf('pop1').page;
    expect(events).toEqual([
      { kind: 'productOption', option: 1, page, image: expect.objectContaining({ width: 60, height: 80 }) },
      { kind: 'productOption', option: 3, page, image: null },
    ]);
  });

  it('records base pages after each ChangePage, never popups or the start page', async () => {
    expect(engine.history).toEqual([]);
    await click(content(70, 20)); // article
    await click(content(30, 20)); // pop1 (popup)
    await click(inPopup(windowOf('pop1'), 40, 10)); // popup to popup
    expect(engine.history).toEqual([ref('article')]);
    await click(navButton(0));
    await click(navButton(0)); // the same page again: not recorded twice
    expect(engine.history).toEqual([ref('article'), ref('home')]);
  });

  it('Back goes to the previous base page, which is recorded again', async () => {
    await click(navButton(0)); // home
    await click(navButton(1)); // dial
    await click(navButton(3)); // inventors
    await click(navButton(5));
    expect(base()).toBe(ref('dial'));
    expect(engine.history).toEqual([ref('home'), ref('dial')]);
    await click(navButton(5));
    expect(base()).toBe(ref('home'));
    expect(engine.history).toEqual([ref('home')]);
  });

  it('Back with fewer than two entries does nothing and leaves the engine usable (§6.3, §11)', async () => {
    await click(navButton(5));
    expect([base(), engine.busy, engine.history]).toEqual([ref('home'), false, []]);
    await click(navButton(4));
    expect(base()).toBe(ref('inventors'));
    await click(navButton(5));
    expect([base(), engine.busy]).toEqual([ref('inventors'), false]);
  });

  it('Back closes the popups', async () => {
    await click(navButton(0));
    await click(navButton(3));
    await click(navButton(6));
    await click(navButton(5));
    expect([base(), popups()]).toEqual([ref('home'), []]);
  });
});

describe('the A–Z machine (behaviour.md §7)', () => {
  const dialPoint = (x: number, y: number): [number, number] => content(x, y);
  const dial = () => engine.basePage!.panels[0]!.dial!;

  beforeEach(() => start('dial'));

  it('selects and steps letters, wrapping, with the dial sound', async () => {
    await click(dialPoint(35, 15));
    expect(dial().letter).toBe(1);
    await click(dialPoint(15, 35)); // previous
    await click(dialPoint(15, 35)); // A → Z
    expect(dial().letter).toBe(25);
    await click(dialPoint(35, 35)); // Z → A
    expect(dial().letter).toBe(0);
    await click(dialPoint(55, 15));
    expect(dial().letter).toBe(25);
    const sounds = media.of('action').map((call) => call.action);
    expect(sounds).toHaveLength(5);
    expect(sounds[0]).toMatchObject({ kind: 'playWave', file: '\\AZAZ\\DIAL' });
    expect(media.of('stopAll')).toEqual([]);
  });

  it("go plays the letter's animation with the pressed button, then goes to the letter's page", async () => {
    media.endAtOnce = false;
    await click(dialPoint(35, 15)); // B
    await click(dialPoint(340, 340));
    expect(media.pending.map((r) => [r.reason, r.path])).toEqual([['dial', 'AZ/azlb.ANI']]);
    const fb = createFramebuffer();
    engine.render(fb);
    expect(pixel(fb, ...content(320, 335))).toBe(SYNTHETIC_BITMAP_FILL[352]);
    // Presses on the dial are ignored while it runs.
    await click(dialPoint(15, 15));
    expect(dial().letter).toBe(1);
    media.endAnimations();
    await engine.idle();
    expect(base()).toBe(ref('article'));
  });

  it('goes to a popup letter page with OpenPage, and without an animation straight away', async () => {
    await click(dialPoint(35, 35)); // B
    await click(dialPoint(35, 35)); // C: a popup
    await click(dialPoint(340, 340));
    expect([base(), popups()]).toEqual([ref('dial'), [ref('rela')]]);
    await engine.reset(ref('dial'));
    for (let i = 0; i < 3; i++) await click(dialPoint(35, 35)); // D: no animation, no page
    await click(dialPoint(340, 340));
    expect(base()).toBe(ref('dial'));
  });

  it('a press on the dial first closes the popups the page owns', async () => {
    await click(dialPoint(110, 15)); // opens pop2
    expect(popups()).toEqual([ref('pop2')]);
    await engine.pointerDown(...dialPoint(35, 15));
    expect(popups()).toEqual([]);
    await engine.pointerUp(...dialPoint(35, 15));
    expect(dial().letter).toBe(1);
  });

  it('blinks the lamp once a second, starting off', async () => {
    const clock = new ManualClock();
    await start('dial', { clock });
    const fb = createFramebuffer();
    const lamp = (): number => {
      engine.update();
      engine.render(fb);
      return pixel(fb, ...content(334, 350));
    };
    expect(lamp()).toBe(173);
    clock.advance(999);
    expect(lamp()).toBe(173);
    clock.advance(1);
    expect(lamp()).toBe(172);
    expect(engine.update()).toBe(false);
    clock.advance(1000);
    expect(engine.update()).toBe(true);
    expect(lamp()).toBe(173);
  });
});

describe('the zoom (behaviour.md §4.2)', () => {
  it('draws inverted outlines from the press to the window, then opens it; reversed on close', async () => {
    const clock = new ManualClock();
    await start('home', { clock });
    const press = content(130, 20);
    await engine.pointerDown(...press);
    const release = engine.pointerUp(...press);
    await settle();
    expect(engine.zooming).toBe(true);
    expect(engine.busy).toBe(true);
    expect(popups()).toEqual([]);

    const fb = createFramebuffer();
    engine.update();
    engine.render(fb);
    // Rectangle 0 is the bare point: four zero-length lines draw nothing.
    expect(fb.pixels.filter((value) => value === 255 - PICTURE.back)).toHaveLength(0);
    clock.advance(50);
    engine.update();
    engine.render(fb);
    expect(fb.pixels.some((value) => value === 255 - PICTURE.back)).toBe(true);

    clock.advance(500);
    await release;
    expect(engine.zooming).toBe(false);
    expect(popups()).toEqual([ref('zoomer')]);

    // Closing plays the reverse.
    const zoomer = windowOf('zoomer');
    await engine.pointerDown(zoomer.x + 2, zoomer.y + 2);
    const closing = engine.pointerUp(zoomer.x + 2, zoomer.y + 2);
    await settle();
    expect([popups(), engine.zooming]).toEqual([[], true]);
    clock.advance(550);
    await closing;
    expect(engine.zooming).toBe(false);
  });
});

describe('the CancelButton (behaviour.md §3)', () => {
  beforeEach(async () => {
    await start();
    await click(content(230, 20)); // Options
    media.clear();
  });

  it('shows its pressed picture while pressed and inside, and closes the popup on release', async () => {
    const options = windowOf('options');
    const fb = createFramebuffer();
    await engine.pointerDown(...inPopup(options, 10, 10));
    expect(media.of('stopAll')).toHaveLength(1);
    engine.render(fb);
    expect(pixel(fb, ...inPopup(options, 10, 10))).toBe(171);
    engine.pointerMove(...inPopup(options, 200, 10));
    engine.render(fb);
    expect(pixel(fb, ...inPopup(options, 10, 10))).toBe(170);
    engine.pointerMove(...inPopup(options, 11, 11));
    await engine.pointerUp(...inPopup(options, 11, 11));
    await engine.idle();
    expect(popups()).toEqual([]);
  });
});

describe('cursors (behaviour.md §8)', () => {
  beforeEach(() => start());
  const at = (point: [number, number]): string => {
    engine.pointerMove(...point);
    return engine.cursor;
  };

  it("shows the object's cursor, ignoring case, and the arrow elsewhere", () => {
    expect(at(content(70, 20))).toBe('hand');
    expect(at(content(300, 300))).toBe('hand'); // the synthetic Bitmap names no cursor: unchanged
    expect(at(content(180, 80))).toBe('arrow'); // "normal"
    expect(at(content(230, 80))).toBe('arrow'); // an unknown name leaves it as it is
    expect(at(content(70, 20))).toBe('hand');
    expect(at(content(230, 80))).toBe('hand');
    expect(at([700, 470])).toBe('arrow');
  });

  it('shows the arrow over objects of a page that owns popups, and over a caption strip', async () => {
    await click(content(30, 20));
    expect(at(content(70, 20))).toBe('arrow');
    const pop1 = windowOf('pop1');
    expect(at(inPopup(pop1, 10, 10))).toBe('hand');
    expect(at([pop1.x + 30, pop1.y + 2])).toBe('arrow');
  });

  it('shows the arrow over hotspots without flag 0x1 while something plays', () => {
    media.playing = true;
    expect(at(content(70, 20))).toBe('arrow');
    expect(at(content(80, 50))).toBe('hand');
  });
});

describe('keyboard and activation (behaviour.md §9, §10)', () => {
  beforeEach(() => start());

  it('ignores keys on ordinary pages', () => {
    for (const key of ['F1', 'a', 'Escape', 'Enter', 'Backspace']) expect(engine.key({ key })).toBe(false);
  });

  it('Alt+F4 closes the focused popup, or asks to quit from the main window', async () => {
    await click(content(30, 20));
    expect(engine.key({ key: 'F4', altKey: true })).toBe(true);
    await engine.idle();
    expect(popups()).toEqual([]);
    engine.key({ key: 'F4', altKey: true });
    expect(events).toEqual([{ kind: 'quit' }]);
  });

  it('losing activation stops all media and shows the caption inactive', async () => {
    await click(content(30, 20));
    engine.setActive(false);
    expect(media.of('stopAll').at(-1)).toEqual({ kind: 'stopAll', wasPlaying: false });
    const fb = createFramebuffer();
    engine.render(fb);
    const pop1 = windowOf('pop1');
    expect(pixel(fb, pop1.x + 14, pop1.y + 2)).toBe(255);
    engine.setActive(true);
    engine.render(fb);
    expect(pixel(fb, pop1.x + 14, pop1.y + 2)).toBe(4);
  });
});
