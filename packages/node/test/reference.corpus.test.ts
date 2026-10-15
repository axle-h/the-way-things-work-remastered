/**
 * Corpus test against reference captures of the original under Wine (docs/reference-environments.md;
 * Wine's palette patch makes its colours those of the master palette). Captures live in
 * `vendor/ref` (or `$TWTW_REF`), one directory per page ref, each capture a PNG of the main
 * window's client area with a JSON sidecar. Skips without the disc or the captures.
 *
 * A capture is compared over its whole 638×459 when its sidecar's `wineClient` says Wine's client
 * covered it; older captures, made while Wine's client was 634×454 (program.md, Window), only over
 * that part (reference-environments.md, "Client area size").
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectReachable, parsePageDatabase, type Page, type PageRef } from '@twtw/formats';
import {
  createFramebuffer,
  DATABASE_PATH,
  Engine,
  stalledAutostartMedia,
  type PageWindow,
} from '@twtw/engine';
import { beforeAll, expect, it } from 'vitest';
import { decodePng, DirectoryDataSource, indexedToRgb, type RgbImage } from '../src/index.ts';
import { describeIfAvailable, discRoot, missingDiscFile, refRoot } from './disc.ts';

/** Wine's client size before refcapture resized it. */
const WINE_UNRESIZED = { width: 634, height: 454 } as const;
/** Wine's caption-strip colours, which the palette cannot show (rendering.md §7.3). */
const WINE_CAPTION_COLOURS = new Set(['9e9e9e', '3296fa']);

interface Sidecar {
  readonly kind: string;
  readonly image: string;
  readonly expectedSettledPage: PageRef;
  readonly expectedState: { readonly base: PageRef; readonly popups: readonly PageRef[] };
  readonly settle: { readonly settled: boolean };
  readonly environment: { readonly kind: string; readonly palettePatch: boolean };
  /** The program's client size under Wine; missing in captures made before the resize worked. */
  readonly wineClient?: { readonly width: number; readonly height: number } | null;
  /** Popups whose picture Wine lost, so they show white (reference-environments.md). */
  readonly whitePopups?: readonly number[];
}

interface Capture {
  readonly sidecar: Sidecar;
  readonly image: RgbImage;
}

/** The direct-start capture of a base page (tools/refcapture). */
const STARTUP = 'startup.json';

/**
 * A settled Wine capture (palette patch on) that shows `base` with exactly `popups` open, none of
 * them a popup whose picture Wine lost. A base page alone is taken only from its direct start
 * (`startup.json`), so that a path capture, such as one with a navigation button drawn pressed,
 * is never picked for it.
 */
function findCapture(base: PageRef, popups: readonly PageRef[] = []): Capture | undefined {
  const top = popups.at(-1) ?? base;
  const dir = join(refRoot, String(top));
  if (!existsSync(dir)) return undefined;
  const names = readdirSync(dir).filter((file) => file.endsWith('.json'));
  const ordered = popups.length === 0 ? names.filter((name) => name === STARTUP) : names.sort();
  for (const name of ordered) {
    const sidecar = JSON.parse(readFileSync(join(dir, name), 'utf8')) as Sidecar;
    const { expectedState: state } = sidecar;
    if (
      sidecar.environment.kind === 'wine' &&
      sidecar.environment.palettePatch &&
      sidecar.settle.settled &&
      (sidecar.whitePopups ?? []).length === 0 &&
      sidecar.expectedSettledPage === top &&
      state.base === base &&
      state.popups.length === popups.length &&
      state.popups.every((ref, i) => ref === popups[i])
    ) {
      return { sidecar, image: decodePng(readFileSync(join(dir, sidecar.image))) };
    }
  }
  return undefined;
}

interface Mismatch {
  readonly x: number;
  readonly y: number;
  readonly ours: string;
  readonly theirs: string;
}

/** Pixels that differ in the part of the capture the program painted. */
function compare(ours: RgbImage, capture: Capture): Mismatch[] {
  const theirs = capture.image;
  const client = capture.sidecar.wineClient;
  const painted =
    client != null && client.width >= theirs.width && client.height >= theirs.height
      ? theirs
      : WINE_UNRESIZED;
  const mismatches: Mismatch[] = [];
  const hex = (rgb: Uint8Array, at: number): string =>
    [...rgb.subarray(at, at + 3)].map((value) => value.toString(16).padStart(2, '0')).join('');
  for (let y = 0; y < Math.min(painted.height, theirs.height); y++) {
    for (let x = 0; x < Math.min(painted.width, theirs.width); x++) {
      const a = hex(ours.rgb, (y * ours.width + x) * 3);
      const b = hex(theirs.rgb, (y * theirs.width + x) * 3);
      if (a !== b) mismatches.push({ x, y, ours: a, theirs: b });
    }
  }
  return mismatches;
}

function summarise(mismatches: readonly Mismatch[]): string {
  const sample = mismatches
    .slice(0, 10)
    .map(({ x, y, ours, theirs }) => `(${x},${y}) ours ${ours} Wine ${theirs}`);
  return `${mismatches.length} pixels differ${sample.length > 0 ? `: ${sample.join('; ')}` : ''}`;
}

const missing =
  missingDiscFile(DATABASE_PATH) ??
  (existsSync(refRoot) ? null : `no reference captures at ${refRoot} (set TWTW_REF to vendor/ref)`);

describeIfAvailable('matching Wine reference captures (disc)', missing, () => {
  let source: DirectoryDataSource;
  let basePages: Page[];
  /** The base pages in a media directory that have a settled capture. */
  const captured = (directory: string): Page[] =>
    basePages.filter(
      (page) => page.directory?.toUpperCase() === directory && findCapture(page.ref) !== undefined,
    );

  beforeAll(async () => {
    source = await DirectoryDataSource.open(discRoot);
    const db = parsePageDatabase(await source.read(DATABASE_PATH));
    basePages = [...collectReachable(db).pages.values()].filter((page) => page.pageType === 'base');
  });

  async function render(base: PageRef, popups: readonly PageRef[], presentation: 'win31' | 'wine') {
    const engine = await Engine.load(source, {
      startPage: base,
      presentation,
      media: stalledAutostartMedia(),
    });
    for (const ref of popups) await engine.openPage(ref);
    const framebuffer = createFramebuffer();
    engine.render(framebuffer);
    return { engine, image: indexedToRgb(framebuffer, engine.palette) };
  }

  it.each([
    ['the Workshop', '\\WORKSHOP\\'],
    ['the Airplane article', '\\ARTICLE1\\AIRP\\'],
  ])('renders %s exactly as Wine shows it', async (_name, directory) => {
    const pages = captured(directory);
    if (pages.length === 0) console.warn(`no settled Wine capture of a page in ${directory}; not compared`);
    for (const page of pages) {
      const { image } = await render(page.ref, [], 'win31');
      const mismatches = compare(image, findCapture(page.ref)!);
      expect(mismatches, `page ${page.ref}: ${summarise(mismatches)}`).toHaveLength(0);
    }
  });

  it('renders a popup over the Airplane article as Wine shows it, apart from the caption colours', async () => {
    const captured = readdirSync(refRoot).map(Number).filter(Number.isInteger);
    const pair = basePages
      .filter((page) => page.directory?.toUpperCase() === '\\ARTICLE1\\AIRP\\')
      .flatMap((page) => captured.map((popup) => [page.ref, popup] as const))
      .find(([base, popup]) => findCapture(base, [popup]) !== undefined);
    if (pair === undefined) {
      console.warn(
        `no settled Wine capture of a popup over the Airplane article under ${refRoot}; not compared`,
      );
      return;
    }
    const [base, popup] = pair;
    const capture = findCapture(base, [popup])!;
    const { engine, image } = await render(base, [popup], 'wine');
    const window: PageWindow = engine.windows[0]!;
    const inCaption = ({ x, y, theirs }: Mismatch): boolean =>
      WINE_CAPTION_COLOURS.has(theirs) &&
      y >= window.y &&
      y < window.y + window.caption &&
      x >= window.x &&
      x < window.x + window.page.width;
    const mismatches = compare(image, capture);
    const unexpected = mismatches.filter((mismatch) => !inCaption(mismatch));
    expect(unexpected, summarise(unexpected)).toHaveLength(0);
    // Every caption pixel in Wine's own colours differs, since the palette cannot show them.
    expect(mismatches.length).toBeGreaterThan(0);
  });
});
