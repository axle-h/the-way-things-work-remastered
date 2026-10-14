// Capturing reference screens: start the original at a base page, replay clicks, wait for the
// settled state, and save the client area with a JSON sidecar.
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { PageDatabase, PageRef } from '@twtw/formats';
import { encodeRgbPng } from '@twtw/node';
import {
  formatStep,
  pathName,
  resolvePath,
  topPage,
  type ActionPath,
  type ResolvedStep,
  type ScreenState,
} from './action-path.ts';
import {
  WIN31_CLIENT,
  findMainWindow,
  ourProgramProcesses,
  prepareLaunch,
  resizeToWin31,
  startProgram,
  stopProgram,
  waitForMainWindow,
  wineVersion,
} from './app.ts';
import { SCREEN_SIZE, sleep } from './env.ts';
import { FrameStream, waitSettled, type Region, type SettledCapture } from './grab.ts';
import { refDir } from './paths.ts';
import type { SettleResult } from './settle.ts';
import { patchStartupPage } from './startup-patch.ts';
import { autoAdvanceChain, popupOpeners } from './targets.ts';
import type { XHelper, XWindow } from './x.ts';

export interface CaptureOptions {
  readonly display: string;
  /** Frames must stay identical this long (ms). */
  readonly stableMs: number;
  /** The same, for pages the database says move on by themselves after an animation (ms). */
  readonly advanceStableMs: number;
  /** Give up waiting for the settled state after this long and keep the last frame (ms). */
  readonly timeoutMs: number;
  /** Give up waiting for the main window after this long (ms). */
  readonly launchTimeoutMs: number;
  /** Resize the client area to Windows 3.1's 638×459 (see app.ts). */
  readonly resize: boolean;
  /** Capture again even when the files exist. */
  readonly force: boolean;
  /** Frames per second of the screen grab. */
  readonly fps: number;
}

export const DEFAULT_OPTIONS: Omit<CaptureOptions, 'display'> = {
  stableMs: 1500,
  advanceStableMs: 4000,
  timeoutMs: 30_000,
  launchTimeoutMs: 20_000,
  resize: true,
  force: false,
  fps: 10,
};

/** Where the pointer is parked during captures: on the root window, outside the program. */
const PARK = { x: 5, y: 5 } as const;

export const STARTUP_NAME = 'startup';

export interface Environment {
  readonly kind: 'wine';
  readonly wineVersion: string;
  readonly display: string;
  readonly screen: string;
  /** wine/patch_palette.py: palette entries 0–9 and 246–255 replaced by the Windows static colours. */
  readonly palettePatch: true;
  /** The product's startup page replaced by the start page (docs/reference-environments.md). */
  readonly startupPatch: true;
}

export interface StepRecord {
  readonly step: string;
  readonly page: PageRef;
  readonly panel: number;
  readonly object: number;
  readonly objectId: number;
  readonly objectKind: string;
  readonly rect: ResolvedStep['rect'];
  /** The point clicked, relative to the client area, and on the X screen. */
  readonly clientPoint: ResolvedStep['point'];
  readonly screenPoint: ResolvedStep['point'];
  readonly clear: boolean;
  readonly effect: ResolvedStep['effect'];
}

export interface Sidecar {
  readonly version: 1;
  /** The page this capture shows according to the database: the top popup, or the base page. */
  readonly page: PageRef;
  readonly pageType: string;
  readonly directory: string | null;
  readonly image: string;
  readonly width: number;
  readonly height: number;
  readonly kind: 'startup' | 'path';
  readonly actionPath: { readonly start: PageRef; readonly steps: readonly StepRecord[] };
  readonly expectedState: ScreenState;
  /** Pages the base page moves on to by itself (autostart animation + `finished` ChangePage). */
  readonly autoAdvance: readonly PageRef[];
  /** The page expected on screen once settled; differs from `page` when it moves on by itself. */
  readonly expectedSettledPage: PageRef;
  readonly settledDiffersFromRequested: boolean;
  readonly settle: SettleResult & { readonly stableMs: number; readonly timeoutMs: number };
  readonly clientRect: Region;
  /** The client size Wine gave before the harness resized it, or null if it was not resized. */
  readonly resizedFrom: { readonly width: number; readonly height: number } | null;
  /** Other top-level windows at capture time (popups, dialogs), in X screen coordinates. */
  readonly otherWindows: readonly XWindow[];
  readonly capturedAt: string;
  readonly timings: { readonly launchMs: number; readonly settleMs: number };
  readonly environment: Environment;
}

export interface CaptureRecord {
  readonly png: string;
  readonly sidecar: Sidecar;
}

interface Session {
  readonly start: PageRef;
  window: XWindow;
  readonly resizedFrom: { width: number; height: number } | null;
  readonly stream: FrameStream;
  readonly launchMs: number;
}

export class LaunchError extends Error {}

export function captureFile(page: PageRef, name: string): string {
  return join(refDir, String(page), `${name}.png`);
}

export function hasCapture(page: PageRef, name: string): boolean {
  const png = captureFile(page, name);
  return existsSync(png) && existsSync(png.replace(/\.png$/, '.json'));
}

export class Harness {
  readonly db: PageDatabase;
  readonly #database: Uint8Array;
  readonly #x: XHelper;
  readonly options: CaptureOptions;
  #environment: Environment | null = null;
  #session: Session | null = null;

  constructor(db: PageDatabase, database: Uint8Array, x: XHelper, options: CaptureOptions) {
    this.db = db;
    this.#database = database;
    this.#x = x;
    this.options = options;
  }

  get environment(): Environment {
    this.#environment ??= {
      kind: 'wine',
      wineVersion: wineVersion(),
      display: this.options.display,
      screen: SCREEN_SIZE,
      palettePatch: true,
      startupPatch: true,
    };
    return this.#environment;
  }

  /** Starts the original at a base page and waits for its window. */
  async #open(start: PageRef): Promise<Session> {
    await this.close();
    prepareLaunch(patchStartupPage(this.#database, start));
    const begin = performance.now();
    await this.#x.move(PARK.x, PARK.y);
    startProgram(this.options.display);
    const found = await waitForMainWindow(this.#x, this.options.launchTimeoutMs);
    if ('seen' in found) {
      const running = ourProgramProcesses().length > 0 ? 'running' : 'not running';
      await stopProgram(this.#x, this.options.display);
      const seen = found.seen.map((w) => `"${w.name}" ${w.width}×${w.height}`).join(', ') || 'none';
      throw new LaunchError(
        `the main window did not appear within ${this.options.launchTimeoutMs} ms ` +
          `(program ${running}; top-level windows: ${seen})`,
      );
    }
    let window = found.window;
    let resizedFrom: Session['resizedFrom'] = null;
    if (
      this.options.resize &&
      (window.width !== WIN31_CLIENT.width || window.height !== WIN31_CLIENT.height)
    ) {
      resizedFrom = { width: window.width, height: window.height };
      window = await resizeToWin31(this.#x, window);
    }
    const stream = new FrameStream(this.options.display, window, this.options.fps);
    const session: Session = { start, window, resizedFrom, stream, launchMs: performance.now() - begin };
    this.#session = session;
    return session;
  }

  /** Closes the program if it is running. */
  async close(): Promise<void> {
    const session = this.#session;
    this.#session = null;
    if (session !== null) await session.stream.stop();
    await stopProgram(this.#x, this.options.display);
  }

  async #settle(session: Session, stableMs: number): Promise<SettledCapture & { otherWindows: XWindow[] }> {
    await this.#x.move(PARK.x, PARK.y);
    const settled = await waitSettled(session.stream, { stableMs, timeoutMs: this.options.timeoutMs });
    const windows = await this.#x.windows();
    const main = findMainWindow(windows);
    if (main === undefined) throw new Error('the main window disappeared');
    if (
      main.x !== session.window.x ||
      main.y !== session.window.y ||
      main.width !== session.window.width ||
      main.height !== session.window.height
    ) {
      throw new Error(`the main window moved from ${rectText(session.window)} to ${rectText(main)}`);
    }
    return { ...settled, otherWindows: windows.filter((window) => window.id !== main.id) };
  }

  #write(name: string, rgb: Uint8Array, sidecar: Omit<Sidecar, 'image'>): CaptureRecord {
    const png = captureFile(sidecar.page, name);
    mkdirSync(join(refDir, String(sidecar.page)), { recursive: true });
    const full: Sidecar = { ...sidecar, image: `${name}.png` };
    writeAtomically(png, encodeRgbPng({ width: sidecar.width, height: sidecar.height, rgb }));
    writeAtomically(
      png.replace(/\.png$/, '.json'),
      new TextEncoder().encode(JSON.stringify(full, null, 2) + '\n'),
    );
    return { png, sidecar: full };
  }

  #base(
    session: Session,
    page: PageRef,
    kind: Sidecar['kind'],
    steps: readonly StepRecord[],
    state: ScreenState,
  ) {
    const info = this.db.getPage(page);
    return {
      version: 1 as const,
      page,
      pageType: info.pageType,
      directory: info.directory,
      width: session.window.width,
      height: session.window.height,
      kind,
      actionPath: { start: session.start, steps },
      expectedState: state,
      clientRect: {
        x: session.window.x,
        y: session.window.y,
        width: session.window.width,
        height: session.window.height,
      },
      resizedFrom: session.resizedFrom,
      capturedAt: new Date().toISOString(),
      environment: this.environment,
    };
  }

  /** Starts at a base page and captures its settled state as `<page>/startup.png`. */
  async capturePage(page: PageRef): Promise<CaptureRecord> {
    const session = await this.#open(page);
    return this.#captureStart(session);
  }

  async #captureStart(session: Session): Promise<CaptureRecord> {
    const page = session.start;
    const chain = autoAdvanceChain(this.db, page);
    const stableMs = chain.length > 0 ? this.options.advanceStableMs : this.options.stableMs;
    const begin = performance.now();
    const settled = await this.#settle(session, stableMs);
    const expectedSettledPage = chain.at(-1) ?? page;
    return this.#write(STARTUP_NAME, settled.rgb, {
      ...this.#base(session, page, 'startup', [], { base: page, popups: [] }),
      autoAdvance: chain,
      expectedSettledPage,
      settledDiffersFromRequested: expectedSettledPage !== page,
      settle: { ...settled.result, stableMs, timeoutMs: this.options.timeoutMs },
      otherWindows: settled.otherWindows,
      timings: { launchMs: Math.round(session.launchMs), settleMs: Math.round(performance.now() - begin) },
    });
  }

  /**
   * Replays an action path, capturing after every step (and the start page, unless captured
   * already). Each capture goes to the directory of the page on top after the step.
   */
  async capturePath(path: ActionPath, name?: string): Promise<CaptureRecord[]> {
    const session = await this.#open(path.start);
    const records: CaptureRecord[] = [];
    if (this.options.force || !hasCapture(path.start, STARTUP_NAME))
      records.push(await this.#captureStart(session));
    else await this.#settle(session, this.options.stableMs);
    const resolved = resolvePath(this.db, path, { clientSize: session.window });
    const done: StepRecord[] = [];
    for (const [index, step] of resolved.entries()) {
      done.push(this.#stepRecord(session, step));
      const begin = performance.now();
      await this.#x.click(session.window.x + step.point.x, session.window.y + step.point.y);
      const record = await this.#capturePathState(
        session,
        done,
        step,
        begin,
        name,
        index === resolved.length - 1,
      );
      records.push(record);
    }
    return records;
  }

  #stepRecord(session: Session, step: ResolvedStep): StepRecord {
    return {
      step: formatStep(step.step),
      ...step.step,
      objectId: step.objectId,
      objectKind: step.objectKind,
      rect: step.rect,
      clientPoint: step.point,
      screenPoint: { x: session.window.x + step.point.x, y: session.window.y + step.point.y },
      clear: step.clear,
      effect: step.effect,
    };
  }

  async #capturePathState(
    session: Session,
    steps: readonly StepRecord[],
    last: ResolvedStep,
    begin: number,
    name: string | undefined,
    isLast: boolean,
  ): Promise<CaptureRecord> {
    const settled = await this.#settle(session, this.options.stableMs);
    if (last.effect.kind === 'openPage' && settled.otherWindows.length === 0) {
      throw new Error(`clicking ${formatStep(last.step)} opened no popup window`);
    }
    const page = topPage(last.after);
    const fileName =
      name !== undefined && isLast
        ? name
        : pathName(
            session.start,
            steps.map(({ page, panel, object }) => ({ page, panel, object })),
          );
    return this.#write(fileName, settled.rgb, {
      ...this.#base(session, page, 'path', steps, last.after),
      autoAdvance: [],
      expectedSettledPage: page,
      settledDiffersFromRequested: false,
      settle: { ...settled.result, stableMs: this.options.stableMs, timeoutMs: this.options.timeoutMs },
      otherWindows: settled.otherWindows,
      timings: { launchMs: Math.round(session.launchMs), settleMs: Math.round(performance.now() - begin) },
    });
  }

  /**
   * Captures a base page and then each popup its own objects open, in one session: click the
   * opener, capture, close the popup (WM_DELETE_WINDOW), and check the base page is back exactly;
   * if it is not, start again from the base page. Existing captures are skipped unless forced.
   */
  async capturePageWithPopups(
    page: PageRef,
    which: 'all' | readonly PageRef[],
  ): Promise<{ records: CaptureRecord[]; errors: string[] }> {
    const records: CaptureRecord[] = [];
    const errors: string[] = [];
    const openers = popupOpeners(this.db.getPage(page)).filter(
      (o) => which === 'all' || which.includes(o.popup),
    );
    let session = await this.#open(page);
    let baseFrame: Uint8Array;
    const restart = async () => {
      session = await this.#open(page);
      baseFrame = (await this.#settle(session, this.options.stableMs)).rgb;
    };
    if (this.options.force || !hasCapture(page, STARTUP_NAME)) {
      const record = await this.#captureStart(session);
      records.push(record);
      baseFrame = (await this.#settle(session, this.options.stableMs)).rgb;
    } else {
      baseFrame = (await this.#settle(session, this.options.stableMs)).rgb;
    }
    for (const opener of openers) {
      const steps = [{ page, panel: opener.panel, object: opener.object }];
      if (!this.options.force && hasCapture(opener.popup, pathName(page, steps))) continue;
      try {
        const [step] = resolvePath(this.db, { start: page, steps }, { clientSize: session.window });
        const begin = performance.now();
        await this.#x.click(session.window.x + step!.point.x, session.window.y + step!.point.y);
        const record = await this.#capturePathState(
          session,
          [this.#stepRecord(session, step!)],
          step!,
          begin,
          undefined,
          true,
        );
        records.push(record);
        for (const window of record.sidecar.otherWindows) await this.#x.close(window.id);
        await sleep(200);
        const back = await this.#settle(session, this.options.stableMs);
        if (back.otherWindows.length > 0 || !Buffer.from(back.rgb).equals(Buffer.from(baseFrame)))
          await restart();
      } catch (error) {
        errors.push(`popup ${opener.popup}: ${error instanceof Error ? error.message : String(error)}`);
        await restart();
      }
    }
    return { records, errors };
  }
}

function rectText(window: XWindow): string {
  return `${window.width}×${window.height} at (${window.x},${window.y})`;
}

function writeAtomically(path: string, bytes: Uint8Array): void {
  writeFileSync(`${path}.tmp`, bytes);
  renameSync(`${path}.tmp`, path);
}
