import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFramebuffer, windowSize, type Engine } from '@twtw/engine';
import { encodeRgbPng, indexedToRgb, type RgbImage } from '@twtw/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Comparator, totals, unpaintedStrips } from './compare.ts';
import type { Reference, Sidecar, SidecarStep, StepEffect } from './references.ts';
import { showState, type ScreenState } from './state.ts';
import { CONTENT, disc, FILL, INTRO_FRAMES, ref } from './test-disc.ts';

let dir: string;
let comparator: Comparator;
let engine: Engine;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'twtw-compare-'));
  comparator = await Comparator.open(disc.source);
  engine = comparator.engine;
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Our own rendering of a state, cropped to 638×459, as a stand-in for a capture. */
async function rendering(state: ScreenState): Promise<RgbImage> {
  await showState(engine, state);
  const framebuffer = createFramebuffer();
  engine.render(framebuffer);
  const full = indexedToRgb(framebuffer, engine.palette);
  const rgb = new Uint8Array(638 * 459 * 3);
  for (let y = 0; y < 459; y++) rgb.set(full.rgb.subarray(y * 640 * 3, (y * 640 + 638) * 3), y * 638 * 3);
  return { width: 638, height: 459, rgb };
}

function setPixel(image: RgbImage, x: number, y: number, colour: number): void {
  image.rgb.set([colour >> 16, (colour >> 8) & 0xff, colour & 0xff], (y * image.width + x) * 3);
}

function paletteColour(index: number): number {
  const p = engine.palette;
  return (p[index * 3]! << 16) | (p[index * 3 + 1]! << 8) | p[index * 3 + 2]!;
}

let count = 0;

/** Writes a capture to the temporary reference directory. */
function capture(
  image: RgbImage,
  fields: Partial<Sidecar> & Pick<Sidecar, 'page' | 'expectedState'>,
): Reference {
  const name = `capture${count++}`;
  const sidecar: Sidecar = {
    pageType: 'base',
    directory: '\\ART\\',
    image: `${name}.png`,
    width: image.width,
    height: image.height,
    kind: 'startup',
    actionPath: { start: fields.page, steps: [] },
    autoAdvance: [],
    expectedSettledPage: fields.page,
    settledDiffersFromRequested: false,
    settle: { settled: true, timedOut: false, cycleFrames: 1, changingRect: null },
    resizedFrom: { width: 634, height: 454 },
    environment: { kind: 'wine', palettePatch: true },
    ...fields,
  };
  const pageDir = join(dir, String(sidecar.page));
  mkdirSync(pageDir, { recursive: true });
  const png = join(pageDir, sidecar.image);
  writeFileSync(png, encodeRgbPng(image));
  return { id: `${sidecar.page}/${name}`, page: sidecar.page, name, png, sidecar };
}

function step(page: number, object: number, effect: StepEffect, x: number, y: number): SidecarStep {
  return { step: `${page}:1:${object}`, page, panel: 1, object, clientPoint: { x, y }, effect };
}

// Where the steps click: the article's hotspot (10,10)–(50,30) in the content panel, and the
// popup's hotspot (5,5)–(25,15), its window at Wine's (111, 31) with the 8-pixel caption.
const ARTICLE_HOTSPOT = [CONTENT.x + 20, CONTENT.y + 20] as const;
const POPUP_HOTSPOT = [111 + 10, 31 + 8 + 10] as const;

describe('Comparator', () => {
  it('finds a rendering of the same state exact', async () => {
    const state = { base: ref('article'), popups: [] };
    const { result, images } = await comparator.compare(
      capture(await rendering(state), { page: ref('article'), expectedState: state }),
    );
    expect(result).toMatchObject({ status: 'exact', differing: 0, area: { width: 638, height: 459 } });
    expect(images?.ours.width).toBe(638);
  });

  it('reports pixels no mask explains as unexplained, with their bounding box', async () => {
    const state = { base: ref('other'), popups: [] };
    const image = await rendering(state);
    setPixel(image, 200, 100, 0x010203);
    setPixel(image, 201, 101, 0x010203);
    const { result } = await comparator.compare(capture(image, { page: ref('other'), expectedState: state }));
    expect(result).toMatchObject({ status: 'unexplained', differing: 2, unexplained: 2 });
    expect(result.unexplainedBoxes).toEqual([{ left: 200, top: 100, right: 202, bottom: 102 }]);
  });

  it("replays a path's clicks and explains Wine's caption colours", async () => {
    const state = { base: ref('article'), popups: [ref('popup')] };
    const image = await rendering(state);
    const window = engine.windows[0]!;
    for (let x = window.x + 12; x < window.x + 59; x++) setPixel(image, x, window.y + 3, 0x3296fa);
    const reference = capture(image, {
      page: ref('popup'),
      pageType: 'popup',
      kind: 'path',
      actionPath: {
        start: ref('article'),
        steps: [step(ref('article'), 1, { kind: 'openPage', page: ref('popup') }, ...ARTICLE_HOTSPOT)],
      },
      expectedState: state,
    });
    const { result } = await comparator.compare(reference);
    expect(result).toMatchObject({
      status: 'explained',
      rendered: state,
      byReason: { wineCaptionColour: 47 },
    });
    expect(result.steps).toEqual([`${ref('article')}:1:1`]);
  });

  it('explains the white area of a popup Wine lost, by its X window, and keeps the rest compared', async () => {
    const state = { base: ref('article'), popups: [ref('popup')] };
    const image = await rendering(state);
    const window = engine.windows[0]!;
    const { width, height } = windowSize(window);
    const whiteArea = { width: window.page.width, height: window.caption + window.page.height - 4 };
    for (let y = window.y + 4; y < window.y + 4 + whiteArea.height; y++) {
      for (let x = window.x; x < window.x + whiteArea.width; x++) setPixel(image, x, y, 0xffffff);
    }
    const sidecar = (whitePopups: number[]) => ({
      page: ref('popup'),
      pageType: 'popup',
      kind: 'path' as const,
      actionPath: {
        start: ref('article'),
        steps: [step(ref('article'), 1, { kind: 'openPage', page: ref('popup') }, ...ARTICLE_HOTSPOT)],
      },
      expectedState: state,
      clientRect: { x: 195, y: 195, width: 638, height: 459 },
      otherWindows: [
        { id: 3, x: 0, y: 0, width: 10, height: 10 },
        { id: 4, x: 195 + window.x, y: 195 + window.y, width, height },
      ],
      whitePopups,
    });
    const differing = (await comparator.compare(capture(image, sidecar([4])))).result;
    expect(differing.differing).toBeGreaterThan(0);
    expect(differing.byReason).toEqual({ wineWhitePopup: differing.differing });
    expect(differing).toMatchObject({ status: 'explained', notes: [] });
    // Listed by another window's id, nothing is explained.
    const other = (await comparator.compare(capture(image, sidecar([3])))).result;
    expect(other).toMatchObject({ status: 'unexplained', unexplained: differing.differing });
    // Caption rows 0–3 and the shadow stay compared.
    setPixel(image, window.x + 20, window.y + 2, 0xffffff);
    setPixel(image, window.x + width - 2, window.y + 10, 0x123456);
    const caption = (await comparator.compare(capture(image, sidecar([4])))).result;
    expect(caption).toMatchObject({ status: 'unexplained', unexplained: 2 });
  });

  it('closes the popup when a click in it changes the base page', async () => {
    const state = { base: ref('other'), popups: [] };
    const reference = capture(await rendering(state), {
      page: ref('other'),
      kind: 'path',
      actionPath: {
        start: ref('article'),
        steps: [
          step(ref('article'), 1, { kind: 'openPage', page: ref('popup') }, ...ARTICLE_HOTSPOT),
          step(ref('popup'), 1, { kind: 'changePage', page: ref('other') }, ...POPUP_HOTSPOT),
        ],
      },
      expectedState: state,
    });
    expect((await comparator.compare(reference)).result.status).toBe('exact');
  });

  it('notes a click that hits another object of the panel than the recorded one', async () => {
    const state = { base: ref('article'), popups: [] };
    const reference = capture(await rendering(state), {
      page: ref('article'),
      kind: 'path',
      actionPath: {
        start: ref('article'),
        steps: [step(ref('article'), 1, { kind: 'none' }, CONTENT.x + 200, CONTENT.y + 200)],
      },
      expectedState: state,
    });
    const { result } = await comparator.compare(reference);
    expect(result.status).toBe('exact');
    expect(result.notes.join()).toMatch(/hits object 0/);
  });

  it('stops with an error when the recorded point is not on the recorded page', async () => {
    const state = { base: ref('article'), popups: [] };
    const reference = capture(await rendering(state), {
      page: ref('article'),
      kind: 'path',
      actionPath: {
        start: ref('article'),
        steps: [step(ref('popup'), 1, { kind: 'none' }, ...ARTICLE_HOTSPOT)],
      },
      expectedState: state,
    });
    const { result, images } = await comparator.compare(reference);
    expect(result.status).toBe('error');
    expect(result.error).toMatch(/hits .*:1:1/);
    expect(images).toBeUndefined();
  });

  it('stops with an error when the clicks lead elsewhere than refcapture expected', async () => {
    const state = { base: ref('article'), popups: [] };
    const reference = capture(await rendering(state), {
      page: ref('article'),
      kind: 'path',
      actionPath: {
        start: ref('article'),
        steps: [step(ref('article'), 1, { kind: 'none' }, ...ARTICLE_HOTSPOT)],
      },
      expectedState: state,
    });
    const { result } = await comparator.compare(reference);
    expect(result.status).toBe('error');
    expect(result.error).toMatch(/the clicks lead to/);
  });

  it('recognises a last navigation click whose button animation Wine stalled', async () => {
    const before = { base: ref('article'), popups: [] };
    const reference = capture(await rendering(before), {
      page: ref('other'),
      kind: 'path',
      actionPath: {
        start: ref('article'),
        steps: [
          {
            step: `${ref('article')}:849:1`,
            page: ref('article'),
            panel: 849,
            object: 1,
            clientPoint: { x: 40, y: 40 },
            effect: { kind: 'changePage', page: ref('other') },
          },
        ],
      },
      expectedState: { base: ref('other'), popups: [] },
      settle: {
        settled: true,
        timedOut: false,
        cycleFrames: 3,
        changingRect: { left: 5, top: 4, right: 88, bottom: 70 },
      },
    });
    const { result } = await comparator.compare(reference);
    expect(result).toMatchObject({ status: 'exact', rendered: before });
    expect(result.notes.join()).toMatch(/stalled the last navigation button/);
  });

  it('compares only 634×454 when Wine left the rest black', async () => {
    const state = { base: ref('other'), popups: [] };
    const image = await rendering(state);
    for (let y = 0; y < 459; y++)
      for (let x = 0; x < 638; x++) if (x >= 634 || y >= 454) setPixel(image, x, y, 0);
    expect(unpaintedStrips(image)).toBe(true);
    const { result } = await comparator.compare(capture(image, { page: ref('other'), expectedState: state }));
    expect(result).toMatchObject({ status: 'exact', area: { width: 634, height: 454 } });
    expect(result.notes.join()).toMatch(/634×454/);
  });

  it("compares all of 638×459 when the sidecar says Wine's client covered it", async () => {
    const state = { base: ref('other'), popups: [] };
    const image = await rendering(state);
    for (let y = 0; y < 459; y++)
      for (let x = 0; x < 638; x++) if (x >= 634 || y >= 454) setPixel(image, x, y, 0);
    const { result } = await comparator.compare(
      capture(image, {
        page: ref('other'),
        expectedState: state,
        wineClient: { width: 638, height: 459 },
      }),
    );
    expect(result).toMatchObject({ area: { width: 638, height: 459 } });
    expect(result.byReason.wineClientStrip).toBeUndefined();
    // Black there is then a real difference wherever our page is not black.
    const ours = await rendering(state);
    let differing = 0;
    for (let y = 0; y < 459; y++)
      for (let x = 0; x < 638; x++) {
        const at = (y * 638 + x) * 3;
        if ((x >= 634 || y >= 454) && ours.rgb[at]! + ours.rgb[at + 1]! + ours.rgb[at + 2]! > 0) differing++;
      }
    expect(differing).toBeGreaterThan(0);
    expect(result.unexplained).toBe(differing);
  });

  it('explains a page that stalled part-way through its autostart animation', async () => {
    const state = { base: ref('intro'), popups: [] };
    const image = await rendering(state);
    const [frame] = INTRO_FRAMES;
    for (let y = frame.top; y < frame.bottom; y++) {
      for (let x = frame.left; x < frame.right; x++)
        setPixel(image, CONTENT.x + x, CONTENT.y + y, paletteColour(FILL.frameA));
    }
    const reference = capture(image, {
      page: ref('intro'),
      expectedState: state,
      autoAdvance: [ref('movie')],
      expectedSettledPage: ref('movie'),
      settledDiffersFromRequested: true,
    });
    const { result } = await comparator.compare(reference);
    expect(result).toMatchObject({
      status: 'explained',
      autoAdvance: 'stalled',
      rendered: state,
      byReason: { wineAnimationStall: 12 },
    });
  });

  it('recognises a capture that did move on, with the animation left behind', async () => {
    const state = { base: ref('movie'), popups: [] };
    const image = await rendering(state);
    setPixel(
      image,
      CONTENT.x + INTRO_FRAMES[1].left,
      CONTENT.y + INTRO_FRAMES[1].top,
      paletteColour(FILL.frameB),
    );
    const reference = capture(image, {
      page: ref('intro'),
      expectedState: { base: ref('intro'), popups: [] },
      autoAdvance: [ref('movie')],
      expectedSettledPage: ref('movie'),
      settledDiffersFromRequested: true,
    });
    const { result } = await comparator.compare(reference);
    expect(result).toMatchObject({
      status: 'explained',
      autoAdvance: 'arrived',
      rendered: state,
      byReason: { animationLeftover: 1 },
    });
  });

  it('in settle mode, plays everything out and compares the settled state', async () => {
    const state = { base: ref('movie'), popups: [] };
    const image = await rendering(state);
    const reference = capture(image, {
      page: ref('intro'),
      expectedState: { base: ref('intro'), popups: [] },
      autoAdvance: [ref('movie')],
      expectedSettledPage: ref('movie'),
      settledDiffersFromRequested: true,
    });
    const settling = await Comparator.open(disc.source, 'settle');
    const { result } = await settling.compare(reference);
    // The intro moved on to the movie page, whose movie played to its end: its frame is drawn,
    // which the stand-in capture (the page at rest) does not show.
    expect(result).toMatchObject({ autoAdvance: 'arrived', rendered: state });
    expect(result.notes).toContain(`settled at page ${ref('movie')}`);
    expect(settling.engine.media.isPlaying()).toBe(false);
    expect(result.differing).toBeGreaterThan(0);
  });

  it('adds up results by status and reason', async () => {
    const state = { base: ref('article'), popups: [] };
    const exact = (
      await comparator.compare(
        capture(await rendering(state), { page: ref('article'), expectedState: state }),
      )
    ).result;
    const explained = { ...exact, status: 'explained' as const, byReason: { azLamp: 5 } };
    expect(totals([exact, explained, explained])).toEqual({
      captures: 3,
      exact: 1,
      explained: 2,
      unexplained: 0,
      error: 0,
      byReason: { azLamp: { captures: 2, pixels: 10 } },
    });
  });
});
