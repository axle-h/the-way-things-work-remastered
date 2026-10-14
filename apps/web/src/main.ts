import { createFramebuffer, Engine, SCREEN_HEIGHT, SCREEN_WIDTH, type PageRef } from '@twtw/engine';
import { parseDebugHash } from './debug-hash.ts';
import { HttpDataSource } from './http-source.ts';
import { indexedToRgba } from './rgba.ts';

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

/** Draws the engine's current state on the canvas at 1× (scaling comes in Phase 7). */
function present(engine: Engine): void {
  engine.render(framebuffer);
  indexedToRgba(framebuffer.pixels, engine.palette, imageData.data);
  context!.putImageData(imageData, 0, 0);
}

/** The dev overlay: what is on screen, and anything that failed to load. */
function describe(engine: Engine): string {
  const pages = [engine.basePage, ...engine.windows.map((window) => window.page)];
  const names = pages
    .filter((page) => page !== null)
    .map((page) => `${page.page.pageType} ${page.ref} ${page.page.directory ?? ''}`);
  const problems = pages.flatMap((page) => page?.problems ?? []);
  return [names.join(' · '), ...problems.map((problem) => `⚠ ${problem}`)].join('\n');
}

/** Shows the page and popups named in the URL hash, or the startup page. */
async function showHashState(engine: Engine): Promise<void> {
  const { page, popups } = parseDebugHash(location.hash);
  const { database } = engine.content;
  const refs: PageRef[] = [page ?? database.product.startupPage!, ...popups];
  // A popup named as the page goes over the startup page.
  if (database.getPage(refs[0]!).pageType !== 'base') refs.unshift(database.product.startupPage!);
  while (engine.windows.length > 0) engine.closePopup();
  await engine.changePage(refs[0]!);
  for (const ref of refs.slice(1)) await engine.openPopup(ref);
  present(engine);
  status!.textContent = describe(engine);
}

async function start(): Promise<void> {
  const source = await HttpDataSource.open('/data/');
  const { presentation } = parseDebugHash(location.hash);
  const engine = await Engine.load(source, { startPage: null, presentation: presentation ?? 'win31' });
  const show = (): void => {
    showHashState(engine).catch(report);
  };
  window.addEventListener('hashchange', show);
  await showHashState(engine);
}

function report(error: unknown): void {
  console.error(error);
  status!.textContent = `Error: ${error instanceof Error ? error.message : String(error)}`;
}

start().catch((error: unknown) => {
  console.error(error);
  status.textContent = `No disc data (run "pnpm data"): ${error instanceof Error ? error.message : String(error)}`;
});
