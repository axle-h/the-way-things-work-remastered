/**
 * Comparing one reference capture: replay its action path in the engine (Wine presentation) as
 * real clicks, render, and diff against the capture with the expected differences masked.
 */
import { readFileSync } from 'node:fs';
import type { PageRef, Rect } from '@twtw/formats';
import {
  CLIENT_HEIGHT,
  CLIENT_WIDTH,
  createFramebuffer,
  Engine,
  headlessMedia,
  stalledAutostartMedia,
  VirtualClock,
  type DataSource,
  type IndexedImage,
  type PageInstance,
} from '@twtw/engine';
import { decodePng, indexedToRgb, type RgbImage } from '@twtw/node';
import {
  boundingBoxes,
  diffImages,
  diffPicture,
  PixelClass,
  type DiffResult,
  type Mask,
  type Reason,
} from './diff.ts';
import { animationCatalog, deriveMasks, WINE_VISIBLE, type AnimationCatalog } from './masks.ts';
import type { Reference } from './references.ts';
import { engineState, replayStep, sameState, showState, type ScreenState } from './state.ts';

export type Status = 'exact' | 'explained' | 'unexplained' | 'error';

/**
 * How the replay treats sound and animation: `stall` (the default) mimics Wine, where animations
 * that start with their page stall and all others end at once; `settle` plays everything on a
 * virtual clock and renders the true settled state, frames included (playback.md), which Wine's
 * captures do not show.
 */
export type MediaMode = 'stall' | 'settle';

/** One capture's comparison, as written to results.json. */
export interface CaptureResult {
  readonly id: string;
  readonly page: PageRef;
  readonly name: string;
  readonly kind: 'startup' | 'path';
  readonly directory: string | null;
  readonly start: PageRef;
  readonly steps: readonly string[];
  /** What the engine showed when rendering. */
  readonly rendered: ScreenState | null;
  /**
   * For a page that should move on by itself: `stalled` when the reference still shows it (the
   * Wine animation stall), `arrived` when it shows the page it moves on to.
   */
  readonly autoAdvance: 'none' | 'stalled' | 'arrived';
  readonly referenceSize: { readonly width: number; readonly height: number };
  /** The compared area, from page (0,0). */
  readonly area: { readonly width: number; readonly height: number };
  readonly status: Status;
  readonly differing: number;
  readonly differingPercent: number;
  readonly unexplained: number;
  readonly byReason: Partial<Record<Reason, number>>;
  readonly unexplainedBoxes: readonly Rect[];
  readonly differingBoxes: readonly Rect[];
  readonly masks: readonly Mask[];
  readonly notes: readonly string[];
  readonly error?: string;
}

export interface CaptureComparison {
  readonly result: CaptureResult;
  /** For the report; absent on errors. */
  readonly images?: {
    readonly reference: RgbImage;
    /** Our rendering, cropped to the reference size, in palette indices. */
    readonly ours: IndexedImage;
    readonly diff: RgbImage;
  };
}

export class Comparator {
  readonly engine: Engine;
  readonly mode: MediaMode;
  readonly #animations: AnimationCatalog;

  private constructor(engine: Engine, animations: AnimationCatalog, mode: MediaMode) {
    this.engine = engine;
    this.#animations = animations;
    this.mode = mode;
  }

  static async open(source: DataSource, mode: MediaMode = 'stall'): Promise<Comparator> {
    // Stall: autostart animations never end, as under Wine; the auto-advance candidates below
    // decide whether the capture still shows the page or the one it moves on to.
    const clock = new VirtualClock();
    const engine = await Engine.load(source, {
      presentation: 'wine',
      startPage: null,
      clock,
      media: mode === 'stall' ? stalledAutostartMedia() : headlessMedia(source, clock),
    });
    return new Comparator(engine, animationCatalog(source), mode);
  }

  get palette(): Uint8Array {
    return this.engine.palette;
  }

  async compare(reference: Reference): Promise<CaptureComparison> {
    const { sidecar } = reference;
    const base = {
      id: reference.id,
      page: reference.page,
      name: reference.name,
      kind: sidecar.kind,
      directory: sidecar.directory,
      start: sidecar.actionPath.start,
      steps: sidecar.actionPath.steps.map((step) => step.step),
    };
    const image = decodePng(readFileSync(reference.png));
    const referenceSize = { width: image.width, height: image.height };
    const notes: string[] = [];
    let area = { width: Math.min(image.width, CLIENT_WIDTH), height: Math.min(image.height, CLIENT_HEIGHT) };
    if (unpaintedStrips(image)) {
      // Wine painted only its own 634×454 client (rendering.md §10): compare that part.
      area = { width: WINE_VISIBLE.width, height: WINE_VISIBLE.height };
      notes.push(
        `the reference is black beyond Wine's ${WINE_VISIBLE.width}×${WINE_VISIBLE.height}: compared that part only`,
      );
    }
    try {
      if (sidecar.environment.kind !== 'wine' || !sidecar.environment.palettePatch) {
        notes.push(`captured in ${sidecar.environment.kind} without the palette patch; compared anyway`);
      }
      if (!sidecar.settle.settled) notes.push('the reference never settled');

      // Replay the action path: a direct start, then a press and release at each recorded point.
      await showState(this.engine, { base: sidecar.actionPath.start, popups: [] });
      let beforeLast: ScreenState | null = null;
      let lastKind: string | null = null;
      for (const step of sidecar.actionPath.steps) {
        beforeLast = engineState(this.engine);
        const replayed = await replayStep(this.engine, step);
        lastKind = replayed.kind;
        if (replayed.note !== null) notes.push(replayed.note);
      }
      const state = engineState(this.engine);
      if (state === null || !sameState(state, sidecar.expectedState)) {
        throw new Error(
          `the clicks lead to ${JSON.stringify(state)}, refcapture expected ${JSON.stringify(sidecar.expectedState)}`,
        );
      }
      const changing =
        (sidecar.settle.cycleFrames ?? 1) > 1 && sidecar.settle.changingRect != null
          ? sidecar.settle.changingRect
          : null;
      if (this.mode === 'settle')
        return await this.#settled(image, area, referenceSize, base, state, changing, notes);

      // The page as replayed; when it should have moved on by itself, Wine's stall explains it.
      const stalls = sidecar.settledDiffersFromRequested;
      let navStall: Candidate | null = null;
      const candidates: Candidate[] = [
        await this.#candidate(image, area, referenceSize, { stalled: stalls, arrivedFrom: [], changing }),
      ];
      if (stalls && sidecar.expectedSettledPage !== state.base) {
        // Or the page it moves on to, with the frames the animation leaves behind.
        const chain = [state.base, ...sidecar.autoAdvance].slice(0, -1);
        const arrivedFrom: PageInstance[] = [];
        for (const ref of chain) arrivedFrom.push(await this.engine.loadPage(ref));
        await showState(this.engine, { base: sidecar.expectedSettledPage, popups: [] });
        candidates.push(
          await this.#candidate(image, area, referenceSize, { stalled: false, arrivedFrom, changing }),
        );
      }
      if (
        lastKind === 'navHotspot' &&
        beforeLast !== null &&
        changing !== null &&
        changing.right <= NAV_BAR_WIDTH &&
        !sameState(beforeLast, state)
      ) {
        // Or the state before a last navigation click whose button animation Wine stalled (it was
        // still cycling when captured): the page change it waits for never came.
        await showState(this.engine, beforeLast);
        navStall = await this.#candidate(image, area, referenceSize, {
          stalled: false,
          arrivedFrom: [],
          changing,
        });
        candidates.push(navStall);
      }
      const best = candidates.reduce((a, b) =>
        b.diff.unexplained < a.diff.unexplained ||
        (b.diff.unexplained === a.diff.unexplained && b.diff.differing < a.diff.differing)
          ? b
          : a,
      );
      const autoAdvance =
        !stalls || best === navStall ? 'none' : best === candidates[0] ? 'stalled' : 'arrived';
      if (best === navStall) {
        notes.push(
          "Wine stalled the last navigation button's animation: the reference shows the page before that click",
        );
      }
      const { diff, masks } = best;
      const status: Status =
        diff.differing === 0 ? 'exact' : diff.unexplained === 0 ? 'explained' : 'unexplained';
      return {
        result: {
          ...base,
          rendered: best.state,
          autoAdvance,
          referenceSize,
          area,
          status,
          differing: diff.differing,
          differingPercent: (100 * diff.differing) / (area.width * area.height),
          unexplained: diff.unexplained,
          byReason: diff.byReason,
          unexplainedBoxes: boundingBoxes(diff.classes, area.width, area.height, PixelClass.unexplained),
          differingBoxes: boundingBoxes(
            diff.classes.map((cls) => (cls === PixelClass.same ? 0 : 1)),
            area.width,
            area.height,
            1,
          ),
          masks,
          notes,
        },
        images: { reference: image, ours: best.ours, diff: diffPicture(image, diff, masks) },
      };
    } catch (error) {
      return {
        result: {
          ...base,
          rendered: null,
          autoAdvance: 'none',
          referenceSize,
          area,
          status: 'error',
          differing: 0,
          differingPercent: 0,
          unexplained: 0,
          byReason: {},
          unexplainedBoxes: [],
          differingBoxes: [],
          masks: [],
          notes,
          error: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * Settle mode: play everything out from the replayed state and compare the true settled state;
   * frames of the animations passed through on the way count as leftovers.
   */
  async #settled(
    image: RgbImage,
    area: { width: number; height: number },
    referenceSize: { width: number; height: number },
    base: Pick<CaptureResult, 'id' | 'page' | 'name' | 'kind' | 'directory' | 'start' | 'steps'>,
    replayed: ScreenState,
    changing: Rect | null,
    notes: string[],
  ): Promise<CaptureComparison> {
    const passed: PageInstance[] = [];
    if (!(await this.engine.settle(10 * 60 * 1000))) notes.push('playback did not settle within 10 minutes');
    const settled = engineState(this.engine);
    if (settled !== null && settled.base !== replayed.base) {
      notes.push(`settled at page ${settled.base}`);
      passed.push(await this.engine.loadPage(replayed.base));
    }
    const { diff, masks, ours, state } = await this.#candidate(image, area, referenceSize, {
      stalled: false,
      arrivedFrom: passed,
      changing,
    });
    const status: Status =
      diff.differing === 0 ? 'exact' : diff.unexplained === 0 ? 'explained' : 'unexplained';
    return {
      result: {
        ...base,
        rendered: state,
        autoAdvance: settled !== null && settled.base !== replayed.base ? 'arrived' : 'none',
        referenceSize,
        area,
        status,
        differing: diff.differing,
        differingPercent: (100 * diff.differing) / (area.width * area.height),
        unexplained: diff.unexplained,
        byReason: diff.byReason,
        unexplainedBoxes: boundingBoxes(diff.classes, area.width, area.height, PixelClass.unexplained),
        differingBoxes: boundingBoxes(
          diff.classes.map((cls) => (cls === PixelClass.same ? 0 : 1)),
          area.width,
          area.height,
          1,
        ),
        masks,
        notes,
      },
      images: { reference: image, ours, diff: diffPicture(image, diff, masks) },
    };
  }

  /** Renders what the engine shows now and diffs it against the reference. */
  async #candidate(
    reference: RgbImage,
    area: { width: number; height: number },
    referenceSize: { width: number; height: number },
    context: { stalled: boolean; arrivedFrom: readonly PageInstance[]; changing: Rect | null },
  ): Promise<Candidate> {
    const framebuffer = createFramebuffer();
    this.engine.render(framebuffer);
    const masks = await deriveMasks(
      {
        database: this.engine.content.database,
        palette: this.palette,
        base: this.engine.basePage,
        windows: this.engine.windows,
        referenceSize,
        ...context,
      },
      this.#animations,
    );
    const ours = crop(framebuffer, referenceSize.width, referenceSize.height);
    const diff = diffImages(indexedToRgb(ours, this.palette), reference, area.width, area.height, masks);
    return { state: engineState(this.engine), ours, masks, diff };
  }
}

/** The navigation bar's width: a stalled button animation cycles inside it. */
const NAV_BAR_WIDTH = 94;

interface Candidate {
  readonly state: ScreenState | null;
  readonly ours: IndexedImage;
  readonly masks: Mask[];
  readonly diff: DiffResult;
}

/**
 * Whether a capture larger than Wine's 634×454 client is black everywhere beyond it, as when Wine
 * did not repaint the strips after the resize to 638×459.
 */
export function unpaintedStrips(image: RgbImage): boolean {
  if (image.width <= WINE_VISIBLE.width && image.height <= WINE_VISIBLE.height) return false;
  for (let y = 0; y < image.height; y++) {
    for (let x = y < WINE_VISIBLE.height ? WINE_VISIBLE.width : 0; x < image.width; x++) {
      const at = (y * image.width + x) * 3;
      if (image.rgb[at] !== 0 || image.rgb[at + 1] !== 0 || image.rgb[at + 2] !== 0) return false;
    }
  }
  return true;
}

/** The top-left `width × height` of an indexed image (pixels beyond it are index 0). */
function crop(image: IndexedImage, width: number, height: number): IndexedImage {
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < Math.min(height, image.height); y++) {
    pixels.set(
      image.pixels.subarray(y * image.width, y * image.width + Math.min(width, image.width)),
      y * width,
    );
  }
  return { width, height, pixels };
}

/** Totals over many results, by status and by reason. */
export interface Totals {
  readonly captures: number;
  readonly exact: number;
  readonly explained: number;
  readonly unexplained: number;
  readonly error: number;
  /** For each reason: captures it explains differences in, and pixels. */
  readonly byReason: Partial<Record<Reason, { readonly captures: number; readonly pixels: number }>>;
}

export function totals(results: readonly CaptureResult[]): Totals {
  const byReason: Partial<Record<Reason, { captures: number; pixels: number }>> = {};
  for (const result of results) {
    for (const [reason, pixels] of Object.entries(result.byReason) as [Reason, number][]) {
      const entry = (byReason[reason] ??= { captures: 0, pixels: 0 });
      entry.captures++;
      entry.pixels += pixels;
    }
  }
  const count = (status: Status) => results.filter((result) => result.status === status).length;
  return {
    captures: results.length,
    exact: count('exact'),
    explained: count('explained'),
    unexplained: count('unexplained'),
    error: count('error'),
    byReason,
  };
}
