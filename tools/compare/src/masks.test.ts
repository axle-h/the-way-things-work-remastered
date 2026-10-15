import { DIAL_POSITIONS, Engine, stalledAutostartMedia, windowSize } from '@twtw/engine';
import { describe, expect, it } from 'vitest';
import type { Mask } from './diff.ts';
import { animationCatalog, deriveMasks, type MaskInput } from './masks.ts';
import { showState, type ScreenState } from './state.ts';
import { CONTENT, disc, FILL, INTRO_FRAMES, MOVIE_FRAME, ref } from './test-disc.ts';

const engine = await Engine.load(disc.source, {
  presentation: 'wine',
  startPage: null,
  media: stalledAutostartMedia(),
});
const animations = animationCatalog(disc.source);

/** The masks for a state, against a 638×459 reference. */
async function masksFor(state: ScreenState, extra: Partial<MaskInput> = {}): Promise<Mask[]> {
  await showState(engine, state);
  return deriveMasks(
    {
      database: engine.content.database,
      palette: engine.palette,
      base: engine.basePage,
      windows: engine.windows,
      referenceSize: { width: 638, height: 459 },
      stalled: false,
      arrivedFrom: [],
      changing: null,
      ...extra,
    },
    animations,
  );
}

/** The palette colour of an index as `0xRRGGBB`. */
function colour(index: number): number {
  const p = engine.palette;
  return (p[index * 3]! << 16) | (p[index * 3 + 1]! << 8) | p[index * 3 + 2]!;
}

const rect = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom });

describe('deriveMasks', () => {
  it("masks the strips beyond Wine's 634×454 where the reference is black", async () => {
    const masks = await masksFor({ base: ref('other'), popups: [] });
    expect(masks.map(({ reason, rect, referenceColours }) => ({ reason, rect, referenceColours }))).toEqual([
      { reason: 'wineClientStrip', rect: rect(634, 0, 638, 459), referenceColours: [0] },
      { reason: 'wineClientStrip', rect: rect(0, 454, 638, 459), referenceColours: [0] },
    ]);
  });

  it("masks a popup's caption strip in Wine's colours", async () => {
    const masks = await masksFor({ base: ref('article'), popups: [ref('popup')] });
    const window = engine.windows[0]!;
    const caption = masks.find((mask) => mask.reason === 'wineCaptionColour');
    expect(caption?.rect).toEqual(rect(window.x, window.y, window.x + 60, window.y + 8));
    expect(caption?.referenceColours).toEqual([0x9e9e9e, 0x3296fa]);
  });

  it('masks the white area of a popup whose picture Wine lost, matched by its window rectangle', async () => {
    await showState(engine, { base: ref('article'), popups: [ref('popup')] });
    const window = engine.windows[0]!;
    const { width, height } = windowSize(window);
    const white = rect(window.x, window.y, window.x + width, window.y + height);
    const masks = await masksFor({ base: ref('article'), popups: [ref('popup')] }, { whitePopups: [white] });
    const mask = masks.find((m) => m.reason === 'wineWhitePopup');
    // Window rows 4 to the shadow, across the picture: caption rows 0–3 and the shadow stay compared.
    expect(mask?.rect).toEqual(
      rect(window.x, window.y + 4, window.x + window.page.width, window.y + 8 + window.page.height),
    );
    expect(mask?.referenceColours).toEqual([0xffffff]);
    // A window that is not ours (another place or size) masks nothing.
    const elsewhere = { ...white, left: white.left + 1, right: white.right + 1 };
    const none = await masksFor(
      { base: ref('article'), popups: [ref('popup')] },
      { whitePopups: [elsewhere] },
    );
    expect(none.some((m) => m.reason === 'wineWhitePopup')).toBe(false);
  });

  it("masks only the Index page's edit box and list, where our font differs", async () => {
    const masks = await masksFor({ base: ref('other'), popups: [ref('index')] });
    const window = engine.windows[0]!;
    const top = window.y + window.caption;
    expect(masks.filter((mask) => mask.reason === 'indexText').map((mask) => mask.rect)).toEqual([
      rect(window.x + 27, top + 88, window.x + 27 + 309, top + 88 + 16),
      rect(window.x + 27, top + 138, window.x + 27 + 293, top + 138 + 169),
    ]);
  });

  it('masks the A–Z lamp', async () => {
    const masks = await masksFor({ base: ref('dial'), popups: [] });
    const left = CONTENT.x + DIAL_POSITIONS.lamp.x;
    const top = CONTENT.y + DIAL_POSITIONS.lamp.y;
    expect(masks.find((mask) => mask.reason === 'azLamp')?.rect).toEqual(rect(left, top, left + 18, top + 8));
  });

  it('accepts only the colours an autostart animation paints, where it paints them', async () => {
    const masks = await masksFor({ base: ref('intro'), popups: [] });
    const mask = masks.find((m) => m.reason === 'autostartAnimation')!;
    const [a, b] = INTRO_FRAMES;
    expect(mask.rect).toEqual(
      rect(CONTENT.x + a.left, CONTENT.y + a.top, CONTENT.x + b.right, CONTENT.y + b.bottom),
    );
    const at = (x: number, y: number) => [CONTENT.x + x, CONTENT.y + y] as const;
    expect(mask.accepts!(...at(10, 20), colour(FILL.frameA))).toBe(true);
    expect(mask.accepts!(...at(10, 20), colour(FILL.frameB))).toBe(false); // frame B does not reach here
    expect(mask.accepts!(...at(13, 22), colour(FILL.frameB))).toBe(true); // both frames do
    expect(mask.accepts!(...at(13, 22), colour(FILL.frameA))).toBe(true);
    expect(mask.accepts!(...at(13, 22), colour(FILL.article))).toBe(false);
    expect(mask.accepts!(...at(15, 20), colour(FILL.frameA))).toBe(false); // in the extent, in no frame
  });

  it('calls it a Wine stall when the animation should have moved the page on', async () => {
    const masks = await masksFor({ base: ref('intro'), popups: [] }, { stalled: true });
    expect(masks.filter((mask) => mask.reason === 'wineAnimationStall')).toHaveLength(1);
    expect(masks.filter((mask) => mask.reason === 'autostartAnimation')).toHaveLength(0);
  });

  it('masks what the animation that moved on to a page leaves behind', async () => {
    const intro = await engine.loadPage(ref('intro'));
    const masks = await masksFor({ base: ref('movie'), popups: [] }, { arrivedFrom: [intro] });
    const leftover = masks.find((mask) => mask.reason === 'animationLeftover')!;
    expect(leftover.rect.left).toBe(CONTENT.x + INTRO_FRAMES[0].left);
  });

  it('masks the movie and the control strip of an AnimationControl started by on_open', async () => {
    const masks = await masksFor({ base: ref('movie'), popups: [] });
    expect(masks.filter((mask) => mask.reason === 'moviePlaying').map((mask) => mask.rect)).toEqual([
      rect(CONTENT.x + 229, CONTENT.y + 307, CONTENT.x + 229 + 74, CONTENT.y + 307 + 22),
      rect(
        CONTENT.x + MOVIE_FRAME.left,
        CONTENT.y + MOVIE_FRAME.top,
        CONTENT.x + MOVIE_FRAME.right,
        CONTENT.y + MOVIE_FRAME.bottom,
      ),
    ]);
  });

  it('masks where the reference was still changing', async () => {
    const changing = rect(1, 2, 3, 4);
    const masks = await masksFor({ base: ref('other'), popups: [] }, { changing });
    expect(masks.at(-1)).toMatchObject({ reason: 'referenceChanging', rect: changing });
  });
});
