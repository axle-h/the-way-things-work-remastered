import {
  ClockAudioSink,
  createFramebuffer,
  Engine,
  loadDiscContent,
  PlaybackMedia,
  SCREEN_HEIGHT,
  SCREEN_WIDTH,
  type AudioSink,
  type Clock,
  type CursorName,
  type EngineEvent,
  type IndexedImage,
  type PageRef,
} from '@twtw/engine';
import { WebAudioSink } from './audio.ts';
import { buildCursorStyles } from './cursors.ts';
import { keepAudioRunning, startAudio, waitForTap } from './gate.ts';
import { parseDebugHash } from './debug-hash.ts';
import { HttpDataSource } from './http-source.ts';
import { attachInput } from './input.ts';
import { indexedToRgba } from './rgba.ts';
import { clientToFramebuffer, nativeLayout } from './stage.ts';

// The original's main window title, fixed for every page (special-screens.md §7).
document.title = 'The Way Things Work';

const canvas = document.querySelector<HTMLCanvasElement>('#stage');
const status = document.querySelector<HTMLElement>('#status');
const gate = document.querySelector<HTMLButtonElement>('#gate');
if (!canvas || !status || !gate) throw new Error('index.html is missing #stage, #status or #gate');

canvas.width = SCREEN_WIDTH;
canvas.height = SCREEN_HEIGHT;
const context = canvas.getContext('2d');
if (!context) throw new Error('no 2D canvas context');
context.imageSmoothingEnabled = false;
context.fillStyle = '#000';
context.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

const framebuffer = createFramebuffer();
const imageData = context.createImageData(SCREEN_WIDTH, SCREEN_HEIGHT);
/** 1× for now; Phase 7 sizes the stage to the device and changes only this layout. */
const layout = nativeLayout(SCREEN_WIDTH, SCREEN_HEIGHT);

/** The browser's clock, for the zoom effect and the A–Z lamp. */
const systemClock: Clock = {
  now: () => performance.now(),
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** Draws the engine's current state on the canvas. */
function present(engine: Engine): void {
  engine.render(framebuffer);
  indexedToRgba(framebuffer.pixels, engine.palette, imageData.data);
  context!.putImageData(imageData, 0, 0);
}

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

function onEvent(event: EngineEvent, palette: Uint8Array): void {
  switch (event.kind) {
    case 'productOption':
      // Copy and print are Phase 8; until then the picture they would use is offered as a download.
      console.info(`product option ${event.option} for page ${event.page?.ref ?? 'none'}`);
      if (event.image !== null) downloadImage(event.image, palette, `twtw-${event.page?.ref ?? 'page'}.png`);
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
 * Loads the database, waits behind the "tap to start" gate (sound needs a gesture), then starts
 * the engine with Web Audio playback: frames are timed by the audio clock.
 */
async function start(): Promise<void> {
  const source = await HttpDataSource.open('/data/');
  const content = await loadDiscContent(source);
  const context = await waitForTap(gate!, startAudio);
  let sink: AudioSink;
  if (context === null) {
    console.warn('no Web Audio: animations play without sound');
    sink = new ClockAudioSink(systemClock);
  } else {
    keepAudioRunning(window, context);
    sink = new WebAudioSink(context);
  }
  // In development, a log of voice starts and frames on the audio clock, to check sync.
  const playbackLog: Record<string, unknown>[] = [];
  const logging = import.meta.env.DEV;
  const media = new PlaybackMedia({
    source,
    sink: logging ? loggingSink(sink, playbackLog) : sink,
    onError: (error, path) => console.warn(`cannot play ${path}:`, error),
    ...(logging
      ? { onFrame: (path: string, frame: number) => playbackLog.push({ path, frame, at: sink.now() }) }
      : {}),
  });
  const { presentation } = parseDebugHash(location.hash);
  const engine = new Engine(source, content, {
    presentation: presentation ?? 'win31',
    clock: systemClock,
    media,
  });
  engine.on((event) => onEvent(event, engine.palette));
  if (import.meta.env.DEV) {
    // For poking at playback from the browser console during development.
    Object.assign(window, { twtw: { engine, media, sink, playbackLog } });
  }
  const cursors: Record<CursorName, string> = buildCursorStyles(engine.content, layout.scale);
  attachInput(canvas!, engine, (clientX, clientY) =>
    clientToFramebuffer(layout, canvas!.getBoundingClientRect(), clientX, clientY),
  );

  // Re-render whenever the engine reports a change (input, page loads, animation frames, zoom, lamp).
  let cursor: CursorName | null = null;
  const frame = (): void => {
    if (engine.update()) {
      present(engine);
      status!.textContent = describe(engine);
    }
    if (engine.cursor !== cursor) {
      cursor = engine.cursor;
      canvas!.style.cursor = cursors[cursor];
    }
    requestAnimationFrame(frame);
  };
  window.addEventListener('hashchange', () => {
    showHashState(engine).catch(report);
  });
  await showHashState(engine);
  requestAnimationFrame(frame);
}

/** Saves an indexed picture as a PNG file (a debug stand-in for Phase 8's copy and print). */
function downloadImage(image: IndexedImage, palette: Uint8Array, name: string): void {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d');
  if (context === null) return;
  const data = context.createImageData(image.width, image.height);
  indexedToRgba(image.pixels, palette, data.data);
  context.putImageData(data, 0, 0);
  canvas.toBlob((blob) => {
    if (blob === null) return;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
  }, 'image/png');
}

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

function report(error: unknown): void {
  console.error(error);
  status!.textContent = `Error: ${error instanceof Error ? error.message : String(error)}`;
}

start().catch((error: unknown) => {
  console.error(error);
  status.textContent = `No disc data (run "pnpm data"): ${error instanceof Error ? error.message : String(error)}`;
});
