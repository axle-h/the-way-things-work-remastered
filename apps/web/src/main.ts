import {
  ClockAudioSink,
  createFramebuffer,
  Engine,
  filesToPrefetch,
  loadDiscContent,
  PlaybackMedia,
  type AudioSink,
  type Clock,
  type CursorName,
  type EngineEvent,
  type PageInstance,
  type PageRef,
} from '@twtw/engine';
import { WebAudioSink } from './audio.ts';
import { buildCursorStyles } from './cursors.ts';
import { keepAudioRunning, startAudio, waitForTap } from './gate.ts';
import { parseDebugHash } from './debug-hash.ts';
import { findHost } from './host.ts';
import { HttpDataSource } from './http-source.ts';
import { attachInput } from './input.ts';
import { Prefetcher } from './prefetch.ts';
import { Presenter } from './presenter.ts';
import { findPictureOutput, PictureOutput } from './picture-output.ts';
import { loadSettings, saveSettings, type Settings } from './settings.ts';
import { attachSettingsMenu, findSettingsMenu } from './settings-menu.ts';
import { SoftKeyboard } from './soft-keyboard.ts';
import { cursorScale, describeLayout, isPortraitPhone, type StageLayout } from './stage.ts';

// The original's main window title, fixed for every page (special-screens.md §7).
document.title = 'The Way Things Work';

const canvas = document.querySelector<HTMLCanvasElement>('#stage');
const status = document.querySelector<HTMLElement>('#status');
const gate = document.querySelector<HTMLButtonElement>('#gate');
const softKeyboardInput = document.querySelector<HTMLInputElement>('#soft-keyboard');
const rotate = document.querySelector<HTMLElement>('#rotate');
if (!canvas || !status || !gate || !softKeyboardInput || !rotate) {
  throw new Error('index.html is missing #stage, #status, #gate, #soft-keyboard or #rotate');
}

/** The browser, or the desktop app around this same build (host.ts). */
const host = findHost();
const storage = (): Storage | null => window.localStorage;
let settings: Settings = loadSettings(storage);
const presenter = new Presenter(canvas, settings.fill ? 'fill' : 'integer');
const framebuffer = createFramebuffer();

/** The browser's clock, for the zoom effect and the A–Z lamp. */
const systemClock: Clock = {
  now: () => performance.now(),
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

// ---------------------------------------------------------------------------------------------
// Things that work before the disc has loaded: the portrait screen, the settings, the overlay.

/** A phone held upright gets "turn your device sideways" instead of a tiny picture. */
function updatePortrait(): void {
  const portrait = isPortraitPhone(
    document.documentElement.clientWidth,
    document.documentElement.clientHeight,
  );
  rotate!.hidden = !portrait;
  document.body.classList.toggle('portrait-phone', portrait);
}
updatePortrait();
window.addEventListener('resize', updatePortrait);
window.addEventListener('orientationchange', updatePortrait);

/** The audio output, once the gate has started it; the volume setting applies to it. */
let sink: WebAudioSink | null = null;
let pageDescription = 'Loading…';
/** The last error, shown whatever the settings. */
let lastError: string | null = null;
let warnedShrink = false;

/**
 * The debug overlay, when turned on in the settings. A stage below native size always shows its
 * scale line, so that it is noticed (docs/architecture.md, "Scaling rules" 2).
 */
function updateStatus(): void {
  const scale = describeLayout(presenter.layout, window.devicePixelRatio || 1);
  const shrunk = presenter.layout.fit === 'shrink';
  const lines = [...(settings.debug ? [pageDescription] : []), ...(lastError === null ? [] : [lastError])];
  if (settings.debug || shrunk) lines.push(scale);
  status!.hidden = lines.length === 0;
  status!.textContent = lines.join('\n');
}

presenter.onLayout((layout: StageLayout) => {
  if (layout.fit === 'shrink' && !warnedShrink) {
    warnedShrink = true;
    console.warn(`the stage is smaller than native: ${describeLayout(layout, window.devicePixelRatio || 1)}`);
  }
  updateStatus();
});
updateStatus();

/** Copy and Print: the clipboard, the fallback picture, the print-only element. */
const output = new PictureOutput(findPictureOutput(), { writeClipboardPng: host.writeClipboardPng });

const menu = attachSettingsMenu(findSettingsMenu(), settings, (next) => {
  settings = next;
  saveSettings(storage, settings);
  presenter.setMode(settings.fill ? 'fill' : 'integer');
  if (sink !== null) sink.volume = settings.volume;
  updateStatus();
});

// The desktop app's "Change disc…": usable before the disc has loaded, should it fail to.
const changeDisc = document.querySelector<HTMLButtonElement>('#setting-disc');
if (changeDisc !== null && host.changeDisc !== undefined) {
  const change = host.changeDisc;
  changeDisc.hidden = false;
  changeDisc.addEventListener('click', () => {
    menu.close();
    change().catch(report);
  });
}

// ---------------------------------------------------------------------------------------------
// The engine

/** The dev overlay: what is on screen, the history, and anything that failed to load. */
function describe(engine: Engine): string {
  const pages = [engine.basePage, ...engine.windows.map((window) => window.page)];
  const names = pages
    .filter((page) => page !== null)
    .map((page) => `${page.page.pageType} ${page.ref} ${page.page.directory ?? ''}`);
  const problems = pages.flatMap((page) => page?.problems ?? []);
  const history = `history: ${engine.history.join(' ') || '(empty)'}`;
  return [names.join(' · '), history, ...problems.map((problem) => `⚠ ${problem}`)].join('\n');
}

/** The pages on screen, base page first. */
function shownPages(engine: Engine): PageRef[] {
  const refs = engine.windows.map((window) => window.page.ref);
  return engine.basePage === null ? refs : [engine.basePage.ref, ...refs];
}

/** Shows the page and popups named in the URL hash (a direct start), or the startup page. */
async function showHashState(engine: Engine): Promise<void> {
  const { page, popups } = parseDebugHash(location.hash);
  const { database } = engine.content;
  const refs: PageRef[] = [page ?? database.product.startupPage!, ...popups];
  // A popup named as the page goes over the startup page.
  if (database.getPage(refs[0]!).pageType !== 'base') refs.unshift(database.product.startupPage!);
  await engine.reset(refs[0]!);
  for (const ref of refs.slice(1)) await engine.openPage(ref);
}

/** The name a saved picture gets. */
const pictureName = (page: PageInstance): string => `the-way-things-work-${page.ref}.png`;

/** Copies a page's captioned picture (special-screens.md §4.5); call it from the user's gesture. */
function copyPage(engine: Engine, page: PageInstance | null, image = page && engine.copyImage(page)): void {
  if (page === null || image === null) return;
  output.copy(image, engine.palette, pictureName(page)).catch(report);
}

/** Prints a page's captioned picture through the browser's print dialog (special-screens.md §4.6). */
function printPage(engine: Engine, page: PageInstance | null, image = page && engine.copyImage(page)): void {
  if (image === null) return;
  output.print(image, engine.palette).catch(report);
}

function onEvent(engine: Engine, event: EngineEvent): void {
  switch (event.kind) {
    case 'productOption':
      // The Options popup (special-screens.md §4.5–4.7): 1 copy, 2 print, 3 printer setup. The
      // browser's print dialog is where the printer and paper are chosen, so printer setup opens
      // it for the same page; cancelling it prints nothing, as cancelling the original's changes
      // nothing. With the recorded page closed, the original does nothing, and so does this.
      if (event.page === null) break;
      if (event.option === 1) copyPage(engine, event.page, event.image ?? undefined);
      else if (event.option === 2 || event.option === 3)
        printPage(engine, event.page, event.image ?? undefined);
      break;
    case 'quit':
      break;
    case 'actionFailed':
      console.warn(`action ${event.action.kind} failed: ${event.reason}`);
      break;
    case 'error':
      report(event.error);
      break;
  }
}

/**
 * The settings menu's Copy and Print, and the browser's own printing (Ctrl+P, its menu): they act
 * on the page on top, by the Options button's rule ({@link Engine.pictureTarget}). The original has
 * no shortcuts of its own (program.md, Commands).
 */
function attachPictureCommands(engine: Engine): void {
  const copy = document.querySelector<HTMLButtonElement>('#setting-copy')!;
  const print = document.querySelector<HTMLButtonElement>('#setting-print')!;
  copy.disabled = false;
  print.disabled = false;
  copy.addEventListener('click', () => {
    menu.close();
    copyPage(engine, engine.pictureTarget);
  });
  print.addEventListener('click', () => {
    menu.close();
    printPage(engine, engine.pictureTarget);
  });
  window.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'p') {
      event.preventDefault();
      printPage(engine, engine.pictureTarget);
    }
  });
  window.addEventListener('beforeprint', () => {
    const page = engine.pictureTarget;
    if (page !== null) output.prepareForBrowserPrint(engine.copyImage(page), engine.palette);
  });
}

/**
 * Loads the database, waits behind the "tap to start" gate (sound needs a gesture; not in the
 * desktop app, which allows autoplay), then starts the engine with Web Audio playback: frames are
 * timed by the audio clock.
 */
async function start(): Promise<void> {
  const source = await HttpDataSource.open(host.dataUrl);
  const content = await loadDiscContent(source);
  let context: ReturnType<typeof startAudio>;
  if (host.autoplay) {
    gate!.hidden = true;
    context = startAudio();
  } else {
    context = await waitForTap(gate!, startAudio);
  }
  let audio: AudioSink;
  if (context === null) {
    console.warn('no Web Audio: animations play without sound');
    audio = new ClockAudioSink(systemClock);
  } else {
    keepAudioRunning(window, context);
    sink = new WebAudioSink(context);
    sink.volume = settings.volume;
    audio = sink;
  }
  // In development, a log of voice starts and frames on the audio clock, to check sync.
  const playbackLog: Record<string, unknown>[] = [];
  const logging = import.meta.env.DEV;
  const media = new PlaybackMedia({
    source,
    sink: logging ? loggingSink(audio, playbackLog) : audio,
    onError: (error, path) => console.warn(`cannot play ${path}:`, error),
    ...(logging
      ? { onFrame: (path: string, frame: number) => playbackLog.push({ path, frame, at: audio.now() }) }
      : {}),
  });
  const { presentation } = parseDebugHash(location.hash);
  const running = new Engine(source, content, {
    presentation: presentation ?? 'win31',
    clock: systemClock,
    media,
  });
  running.on((event) => onEvent(running, event));
  attachPictureCommands(running);
  if (import.meta.env.DEV) {
    // For poking at playback from the browser console, and for the device checks (e2e/).
    Object.assign(window, { twtw: { engine: running, media, sink: audio, playbackLog, presenter, source } });
  }

  // The original's cursors, scaled to match the stage on screen; the browser's arrow off the picture.
  const cursorSets = new Map<number, Record<CursorName, string>>();
  const cursors = (): Record<CursorName, string> => {
    const scale = cursorScale(presenter.layout, window.devicePixelRatio || 1);
    let set = cursorSets.get(scale);
    if (set === undefined) {
      set = buildCursorStyles(running.content, scale);
      cursorSets.set(scale, set);
    }
    return set;
  };
  let pointerInside = false;
  const softKeyboard = new SoftKeyboard(softKeyboardInput!, running);
  attachInput(
    canvas!,
    running,
    (clientX, clientY) => {
      const point = presenter.toFramebuffer(clientX, clientY);
      pointerInside = point.inside;
      return point;
    },
    {
      afterTouchRelease: () => softKeyboard.afterTap(),
      acceptKey: (event) =>
        !menu.isOpen() &&
        !output.overlayOpen &&
        !(
          event.target instanceof HTMLElement && event.target.closest('#settings, #settings-button') !== null
        ),
    },
  );

  // Fetch what the next tap may need once a page is on screen and nothing else is loading.
  const prefetcher = new Prefetcher(source);
  let prefetchedFor = '';
  let prefetchTimer: ReturnType<typeof setTimeout> | undefined;
  const schedulePrefetch = (): void => {
    const shown = shownPages(running);
    const key = shown.join(',');
    if (key === prefetchedFor || running.busy) return;
    prefetchedFor = key;
    clearTimeout(prefetchTimer);
    prefetchTimer = setTimeout(() => {
      const back = running.history.at(-1);
      prefetcher.request(filesToPrefetch(running.content.database, shown, back === undefined ? [] : [back]));
    }, PREFETCH_DELAY_MS);
  };

  // Re-render whenever the engine reports a change (input, page loads, animation frames, zoom, lamp).
  let cursor = '';
  const frame = (): void => {
    if (running.update()) {
      running.render(framebuffer);
      presenter.present(framebuffer.pixels, running.palette);
      pageDescription = describe(running);
      updateStatus();
      const shown = shownPages(running);
      document.body.dataset['pages'] = shown.join(' ');
    }
    schedulePrefetch();
    softKeyboard.update();
    const next = pointerInside ? cursors()[running.cursor] : 'default';
    if (next !== cursor) {
      cursor = next;
      canvas!.style.cursor = cursor;
    }
    requestAnimationFrame(frame);
  };
  presenter.onLayout(() => {
    // The canvas was cleared: draw the current picture again at the new size.
    presenter.present(framebuffer.pixels, running.palette);
    cursor = '';
  });
  window.addEventListener('hashchange', () => {
    showHashState(running).catch(report);
  });
  await showHashState(running);
  requestAnimationFrame(frame);
}

/** After a page change, how long to leave the network to the page itself. */
const PREFETCH_DELAY_MS = 400;

/** A sink that records each start (dev builds): when, from where, and when its sound is heard. */
function loggingSink(sink: AudioSink, log: Record<string, unknown>[]): AudioSink {
  return {
    now: () => sink.now(),
    start: (clip, offset) => {
      const voice = sink.start(clip, offset);
      log.push({ start: clip.length, offset, at: sink.now(), startTime: voice.startTime });
      return voice;
    },
  };
}

function report(problem: unknown): void {
  console.error(problem);
  lastError = `Error: ${problem instanceof Error ? problem.message : String(problem)}`;
  updateStatus();
}

start().catch((error: unknown) => {
  report(new Error(`${host.noDataMessage}: ${error instanceof Error ? error.message : String(error)}`));
  gate.textContent = 'No disc data';
});
