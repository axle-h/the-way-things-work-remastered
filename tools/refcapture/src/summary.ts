// vendor/ref/index.json: what has been captured, what failed and why, built from the sidecars.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PageDatabase, PageRef } from '@twtw/formats';
import { STARTUP_NAME, type Environment, type Sidecar } from './capture.ts';
import { refDir } from './paths.ts';
import { decodePng } from './png.ts';
import { basePages } from './targets.ts';

export interface Failure {
  readonly error: string;
  readonly at: string;
  readonly attempts: number;
}

export interface CrawlRun {
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly attempted: number;
  readonly captured: number;
  readonly skipped: number;
  readonly failed: number;
  /** Mean wall time per attempted base page (launch, settle, popups, close), in ms. */
  readonly meanPageMs: number;
  readonly popups: string;
}

export interface CaptureSummary {
  readonly image: string;
  readonly kind: Sidecar['kind'];
  readonly width: number;
  readonly height: number;
  readonly settled: boolean;
  readonly timedOut: boolean;
  readonly msUntilStable: number;
  readonly expectedSettledPage: PageRef;
  readonly settledDiffersFromRequested: boolean;
  /**
   * For a page that should move on by itself: whether the capture equals the startup capture of
   * the page it should settle on (null when that page has no capture). False means the animation
   * stopped before its end (see docs/reference-environments.md, "Animations under Wine").
   */
  readonly reachedExpectedSettledPage: boolean | null;
  readonly cycleFrames: number;
  readonly otherWindows: number;
  readonly steps: readonly string[];
  readonly capturedAt: string;
}

export interface Index {
  readonly version: 1;
  readonly generatedAt: string;
  readonly environment: Environment | null;
  readonly counts: {
    readonly basePages: number;
    readonly basePagesCaptured: number;
    readonly popupPagesCaptured: number;
    readonly captures: number;
    readonly timedOut: number;
    readonly settledElsewhere: number;
    /** Pages that should move on by themselves but did not reach the expected page. */
    readonly stalledAutoAdvance: number;
    /** Captures whose settled screen still cycles (e.g. a blinking light). */
    readonly cycling: number;
    readonly withOtherWindows: number;
    readonly failures: number;
  };
  readonly pages: Readonly<
    Record<
      string,
      {
        readonly pageType: string;
        readonly directory: string | null;
        readonly captures: readonly CaptureSummary[];
      }
    >
  >;
  /** Base pages without a startup capture whose last attempt failed. */
  readonly failures: Readonly<Record<string, Failure>>;
  readonly lastCrawl: CrawlRun | null;
}

const indexPath = () => join(refDir, 'index.json');

export function readIndex(): Index | null {
  if (!existsSync(indexPath())) return null;
  try {
    return JSON.parse(readFileSync(indexPath(), 'utf8')) as Index;
  } catch {
    return null;
  }
}

function readSidecars(): Sidecar[] {
  if (!existsSync(refDir)) return [];
  const sidecars: Sidecar[] = [];
  for (const entry of readdirSync(refDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
    for (const file of readdirSync(join(refDir, entry.name))) {
      if (!file.endsWith('.json')) continue;
      try {
        sidecars.push(JSON.parse(readFileSync(join(refDir, entry.name, file), 'utf8')) as Sidecar);
      } catch {
        // a half-written sidecar; it is rewritten on the next capture
      }
    }
  }
  return sidecars;
}

/** Whether a startup capture equals the startup capture of the page it should settle on. */
function sameImage(sidecar: Sidecar): boolean | null {
  const expected = join(refDir, String(sidecar.expectedSettledPage), `${STARTUP_NAME}.png`);
  const actual = join(refDir, String(sidecar.page), sidecar.image);
  if (!existsSync(expected) || !existsSync(actual)) return null;
  const a = decodePng(readFileSync(actual));
  const b = decodePng(readFileSync(expected));
  return a.width === b.width && a.height === b.height && Buffer.from(a.rgb).equals(Buffer.from(b.rgb));
}

/** Rebuilds the index from the sidecars on disk, merging in failures and the last crawl run. */
export function writeIndex(
  db: PageDatabase,
  failures: ReadonlyMap<PageRef, Failure>,
  lastCrawl?: CrawlRun,
): Index {
  const previous = readIndex();
  const sidecars = readSidecars().sort((a, b) => a.page - b.page || a.image.localeCompare(b.image));
  const pages: Record<string, { pageType: string; directory: string | null; captures: CaptureSummary[] }> =
    {};
  for (const sidecar of sidecars) {
    const entry = (pages[sidecar.page] ??= {
      pageType: sidecar.pageType,
      directory: sidecar.directory,
      captures: [],
    });
    entry.captures.push({
      image: sidecar.image,
      kind: sidecar.kind,
      width: sidecar.width,
      height: sidecar.height,
      settled: sidecar.settle.settled,
      timedOut: sidecar.settle.timedOut,
      msUntilStable: sidecar.settle.msUntilStable,
      expectedSettledPage: sidecar.expectedSettledPage,
      settledDiffersFromRequested: sidecar.settledDiffersFromRequested,
      reachedExpectedSettledPage: sidecar.settledDiffersFromRequested ? sameImage(sidecar) : null,
      cycleFrames: sidecar.settle.cycleFrames ?? 1,
      otherWindows: sidecar.otherWindows.length,
      steps: sidecar.actionPath.steps.map((step) => step.step),
      capturedAt: sidecar.capturedAt,
    });
  }
  const startupCaptured = (ref: PageRef) =>
    pages[ref]?.captures.some((capture) => capture.image === `${STARTUP_NAME}.png`) ?? false;
  const mergedFailures: Record<string, Failure> = {};
  for (const [ref, failure] of Object.entries(previous?.failures ?? {})) {
    if (!startupCaptured(Number(ref))) mergedFailures[ref] = failure;
  }
  for (const [ref, failure] of failures) {
    if (!startupCaptured(ref)) mergedFailures[ref] = failure;
  }
  const bases = basePages(db);
  const all = sidecars;
  const index: Index = {
    version: 1,
    generatedAt: new Date().toISOString(),
    environment: all.at(-1)?.environment ?? previous?.environment ?? null,
    counts: {
      basePages: bases.length,
      basePagesCaptured: bases.filter((page) => startupCaptured(page.ref)).length,
      popupPagesCaptured: Object.values(pages).filter((page) => page.pageType === 'popup').length,
      captures: all.length,
      timedOut: all.filter((sidecar) => sidecar.settle.timedOut).length,
      settledElsewhere: all.filter((sidecar) => sidecar.settledDiffersFromRequested).length,
      stalledAutoAdvance: Object.values(pages)
        .flatMap((page) => page.captures)
        .filter((capture) => capture.reachedExpectedSettledPage === false).length,
      cycling: all.filter((sidecar) => (sidecar.settle.cycleFrames ?? 1) > 1).length,
      withOtherWindows: all.filter((sidecar) => sidecar.kind === 'startup' && sidecar.otherWindows.length > 0)
        .length,
      failures: Object.keys(mergedFailures).length,
    },
    pages,
    failures: mergedFailures,
    lastCrawl: lastCrawl ?? previous?.lastCrawl ?? null,
  };
  mkdirSync(refDir, { recursive: true });
  writeFileSync(`${indexPath()}.tmp`, JSON.stringify(index, null, 2) + '\n');
  renameSync(`${indexPath()}.tmp`, indexPath());
  return index;
}
