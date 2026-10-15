/**
 * Corpus test: renders every base page, popup and index page of the disc with the engine and
 * checks that each loads every picture it names and renders without error. Only counts are
 * asserted; nothing from the disc is stored in the repository.
 */
import { collectReachable, type Page } from '@twtw/formats';
import {
  CLIENT_HEIGHT,
  CLIENT_WIDTH,
  createFramebuffer,
  Engine,
  stalledAutostartMedia,
  windowSize,
} from '@twtw/engine';
import { beforeAll, expect, it } from 'vitest';
import { DirectoryDataSource } from '../src/index.ts';
import { describeIfAvailable, discRoot, missingDiscFile } from './disc.ts';

describeIfAvailable('rendering every page (disc)', missingDiscFile('DKCODE/TWTW.PNG'), () => {
  let engine: Engine;
  let pages: Page[];

  beforeAll(async () => {
    // Pages that move on when their animation ends stay put: each is rendered as it opens.
    engine = await Engine.load(await DirectoryDataSource.open(discRoot), { media: stalledAutostartMedia() });
    pages = [...collectReachable(engine.content.database).pages.values()];
  });

  it('renders all 397 base pages', async () => {
    const framebuffer = createFramebuffer();
    const base = pages.filter((page) => page.pageType === 'base');
    expect(base).toHaveLength(397);
    const problems: string[] = [];
    for (const page of base) {
      await engine.reset(page.ref);
      const instance = engine.basePage!;
      problems.push(...instance.problems.map((problem) => `${page.ref}: ${problem}`));
      engine.render(framebuffer);
      // Base templates cover the whole client area with panels (rendering.md §1).
      expect(instance.width, `page ${page.ref}`).toBe(CLIENT_WIDTH);
      expect(instance.height, `page ${page.ref}`).toBe(CLIENT_HEIGHT);
    }
    expect(problems).toEqual([]);
  }, 60_000);

  it('renders all 1,259 popups and the index page over a base page', async () => {
    const framebuffer = createFramebuffer();
    await engine.reset(engine.content.database.product.startupPage!);
    const windows = pages.filter((page) => page.pageType === 'popup' || page.pageType === 'index');
    expect(windows).toHaveLength(1260);
    const problems: string[] = [];
    let pastRight = 0;
    let maxRight = 0;
    let shadowPastBottom = 0;
    let overNavBar = 0;
    for (const page of windows) {
      expect(await engine.openPage(page.ref), `page ${page.ref}`).toBe(true);
      const window = engine.windows.at(-1)!;
      const instance = window.page;
      problems.push(...instance.problems.map((problem) => `${page.ref}: ${problem}`));
      engine.render(framebuffer);
      const { width, height } = windowSize(window);
      expect(instance.width * instance.height, `page ${page.ref}`).toBeGreaterThan(0);
      if (page.pageType === 'popup') {
        // Window geometry as listed in rendering.md §7.6 (Windows 3.1 positions).
        if (window.x + width > CLIENT_WIDTH) pastRight++;
        maxRight = Math.max(maxRight, window.x + width);
        if (
          window.y + height > CLIENT_HEIGHT &&
          window.y + window.caption + instance.height <= CLIENT_HEIGHT
        ) {
          shadowPastBottom++;
        }
        if (window.x < 94) overNavBar++;
      }
      await engine.closePage(page.ref);
    }
    expect(problems).toEqual([]);
    expect({ pastRight, maxRight, shadowPastBottom, overNavBar }).toEqual({
      pastRight: 77,
      maxRight: 696,
      shadowPastBottom: 11,
      overNavBar: 67,
    });
  }, 60_000);
});
