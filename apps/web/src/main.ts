import {
  createFramebuffer,
  Engine,
  SCREEN_HEIGHT,
  SCREEN_WIDTH,
  type Clock,
  type CursorName,
  type EngineEvent,
  type PageRef,
} from '@twtw/engine';
import { buildCursorStyles } from './cursors.ts';
import { parseDebugHash } from './debug-hash.ts';
import { HttpDataSource } from './http-source.ts';
import { attachInput } from './input.ts';
import { indexedToRgba } from './rgba.ts';
import { clientToFramebuffer, nativeLayout } from './stage.ts';

const canvas = document.querySelector<HTMLCanvasElement>('#stage');
const status = document.querySelector<HTMLElement>('#status');
if (!canvas || !status) throw new Error('index.html is missing #stage or #status');

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

function onEvent(event: EngineEvent): void {
  switch (event.kind) {
    case 'productOption':
      // Copy and print are Phase 8.
      console.info(`product option ${event.option} for page ${event.page?.ref ?? 'none'}`);
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

async function start(): Promise<void> {
  const source = await HttpDataSource.open('/data/');
  const { presentation } = parseDebugHash(location.hash);
  const engine = await Engine.load(source, {
    startPage: null,
    presentation: presentation ?? 'win31',
    clock: systemClock,
  });
  engine.on(onEvent);
  const cursors: Record<CursorName, string> = buildCursorStyles(engine.content, layout.scale);
  attachInput(canvas!, engine, (clientX, clientY) =>
    clientToFramebuffer(layout, canvas!.getBoundingClientRect(), clientX, clientY),
  );

  // Re-render whenever the engine reports a change (input, page loads, zoom, lamp).
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

function report(error: unknown): void {
  console.error(error);
  status!.textContent = `Error: ${error instanceof Error ? error.message : String(error)}`;
}

start().catch((error: unknown) => {
  console.error(error);
  status.textContent = `No disc data (run "pnpm data"): ${error instanceof Error ? error.message : String(error)}`;
});
