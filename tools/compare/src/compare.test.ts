import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFramebuffer, type Engine } from '@twtw/engine';
import { encodeRgbPng, indexedToRgb, type RgbImage } from '@twtw/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Comparator, totals, unpaintedStrips } from './compare.ts';
import type { Reference, Sidecar, SidecarStep } from './references.ts';
import { showState, type ScreenState, type StepEffect } from './step-dispatch.ts';
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

function step(page: number, object: number, effect: StepEffect): SidecarStep {
  return { step: `${page}:1:${object}`, page, panel: 1, object, effect };
}

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
        steps: [step(ref('article'), 1, { kind: 'openPage', page: ref('popup') })],
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

  it('closes the popup when a click in it changes the base page', async () => {
    const state = { base: ref('other'), popups: [] };
    const reference = capture(await rendering(state), {
      page: ref('other'),
      kind: 'path',
      actionPath: {
        start: ref('article'),
        steps: [
          step(ref('article'), 1, { kind: 'openPage', page: ref('popup') }),
          step(ref('popup'), 1, { kind: 'changePage', page: ref('other') }),
        ],
      },
      expectedState: state,
    });
    expect((await comparator.compare(reference)).result.status).toBe('exact');
  });

  it('stops with an error when the database disagrees with the recorded click', async () => {
    const state = { base: ref('article'), popups: [] };
    const reference = capture(await rendering(state), {
      page: ref('article'),
      kind: 'path',
      actionPath: { start: ref('article'), steps: [step(ref('article'), 1, { kind: 'none' })] },
      expectedState: state,
    });
    const { result, images } = await comparator.compare(reference);
    expect(result.status).toBe('error');
    expect(result.error).toMatch(/refcapture recorded/);
    expect(images).toBeUndefined();
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
