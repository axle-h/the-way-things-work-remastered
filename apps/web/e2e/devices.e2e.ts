// Device checks (docs/architecture.md, "Validation" 7): at desktop, tablet and phone viewports and device pixel
// ratios, the stage picks the expected integer scale, its backing store matches the device
// pixels, a phone held upright gets the "turn sideways" screen, and a tap on a hotspot reaches
// the page it leads to. They need the extracted disc and skip without it.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { hasDisc } from './disc.ts';

/** A base page with plenty of hotspots: the Airplane. */
const AIRPLANE = 1538;

interface Device {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  readonly touch: boolean;
  /** Expected scale and fit, or `portrait` for the "turn sideways" screen. */
  readonly expect: { readonly scale: number; readonly fit: 'integer' | 'shrink' } | 'portrait';
}

const DEVICES: readonly Device[] = [
  {
    name: 'desktop 1080p',
    width: 1920,
    height: 1080,
    dpr: 1,
    touch: false,
    expect: { scale: 2, fit: 'integer' },
  },
  {
    name: 'laptop 1366×768',
    width: 1366,
    height: 768,
    dpr: 1,
    touch: false,
    expect: { scale: 1, fit: 'integer' },
  },
  {
    name: 'desktop 2×',
    width: 1440,
    height: 900,
    dpr: 2,
    touch: false,
    expect: { scale: 3, fit: 'integer' },
  },
  {
    name: 'tablet landscape',
    width: 1024,
    height: 768,
    dpr: 2,
    touch: true,
    expect: { scale: 3, fit: 'integer' },
  },
  {
    name: 'tablet portrait',
    width: 768,
    height: 1024,
    dpr: 2,
    touch: true,
    expect: { scale: 2, fit: 'integer' },
  },
  {
    name: 'phone landscape',
    width: 844,
    height: 390,
    dpr: 3,
    touch: true,
    expect: { scale: 2, fit: 'integer' },
  },
  {
    name: 'small phone landscape',
    width: 568,
    height: 320,
    dpr: 2,
    touch: true,
    expect: { scale: 1, fit: 'integer' },
  },
  { name: 'phone portrait', width: 390, height: 844, dpr: 3, touch: true, expect: 'portrait' },
  {
    name: 'small window',
    width: 600,
    height: 400,
    dpr: 1,
    touch: false,
    expect: { scale: 400 / 459, fit: 'shrink' },
  },
];

/** Set `TWTW_SCREENSHOTS` to a directory to save a screenshot of each device's page. */
const SCREENSHOTS = process.env['TWTW_SCREENSHOTS'];

async function screenshot(page: Page, name: string): Promise<void> {
  if (SCREENSHOTS === undefined) return;
  mkdirSync(SCREENSHOTS, { recursive: true });
  await page.screenshot({ path: join(SCREENSHOTS, `${name.replace(/[^a-z0-9]+/gi, '-')}.png`) });
}

/** The stage canvas's state as the presenter publishes it. */
async function stage(page: Page) {
  return page.locator('#stage').evaluate((canvas: HTMLCanvasElement) => {
    const box = canvas.getBoundingClientRect();
    const [offsetX, offsetY, width, height] = (canvas.dataset['layout'] ?? '').split(' ').map(Number);
    return {
      backing: [canvas.width, canvas.height],
      css: [box.width, box.height],
      box: { left: box.left, top: box.top },
      dpr: window.devicePixelRatio,
      scale: Number(canvas.dataset['scale']),
      fit: canvas.dataset['fit'],
      layout: { offsetX: offsetX!, offsetY: offsetY!, width: width!, height: height! },
    };
  });
}

/** A framebuffer point in client coordinates, through the published layout (the inverse mapping). */
async function toClient(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const state = await stage(page);
  return {
    x: state.box.left + (state.layout.offsetX + ((x + 0.5) * state.layout.width) / 638) / state.dpr,
    y: state.box.top + (state.layout.offsetY + ((y + 0.5) * state.layout.height) / 459) / state.dpr,
  };
}

/** Passes the "tap to start" gate and shows `ref`. */
async function startAt(page: Page, ref: number, touch: boolean, popup?: number): Promise<void> {
  await page.goto(`/#page=${ref}${popup === undefined ? '' : `,popup=${popup}`}`);
  const gate = page.locator('#gate');
  await expect(gate).toBeEnabled({ timeout: 30_000 });
  if (touch) await gate.tap();
  else await gate.click();
  const pages = popup === undefined ? String(ref) : `${ref} ${popup}`;
  await expect(page.locator('body')).toHaveAttribute('data-pages', pages, { timeout: 30_000 });
}

/**
 * A Hotspot of the base page whose click opens or changes to another page, with a point inside
 * it that hit-tests to it, in page coordinates (through the dev build's `window.twtw`).
 */
async function findHotspot(page: Page) {
  return page.evaluate(() => {
    interface Placed {
      object: {
        kind: string;
        handlers?: { event: number; actions: { kind: string; page?: number | null }[] }[];
      };
      rect: { left: number; top: number; right: number; bottom: number } | null;
    }
    interface EngineView {
      basePage: { panels: { x: number; y: number; objects: Placed[] }[] };
      hitTest(x: number, y: number): { object: Placed | null } | null;
    }
    const { engine } = (window as unknown as { twtw: { engine: EngineView } }).twtw;
    for (const panel of engine.basePage.panels) {
      for (const placed of panel.objects) {
        if (placed.object.kind !== 'hotspot' || placed.rect === null) continue;
        const clicks = (placed.object.handlers ?? []).filter((handler) => handler.event === 4);
        const action = clicks
          .flatMap((handler) => handler.actions)
          .find((candidate) => candidate.kind === 'openPage' || candidate.kind === 'changePage');
        if (action?.page === null || action?.page === undefined) continue;
        const { left, top, right, bottom } = placed.rect;
        const x = panel.x + Math.floor((left + right) / 2);
        const y = panel.y + Math.floor((top + bottom) / 2);
        // The release is tested one pixel lower (behaviour.md §1.5): both must hit the hotspot.
        if (engine.hitTest(x, y)?.object !== placed || engine.hitTest(x, y + 1)?.object !== placed) continue;
        return { x, y, kind: action.kind, target: action.page };
      }
    }
    return null;
  });
}

for (const device of DEVICES) {
  test.describe(device.name, () => {
    test.skip(!hasDisc, 'no extracted disc (vendor/cd or $TWTW_CD): run "pnpm data"');
    test.use({
      viewport: { width: device.width, height: device.height },
      deviceScaleFactor: device.dpr,
      hasTouch: device.touch,
      isMobile: device.touch,
    });

    test('sizes the stage in device pixels at the expected scale', async ({ page }) => {
      await page.goto('/');
      const rotate = page.locator('#rotate');
      if (device.expect === 'portrait') {
        await expect(rotate).toBeVisible();
        await expect(rotate).toContainText('Turn your device sideways');
        await screenshot(page, device.name);
        return;
      }
      await expect(rotate).toBeHidden();
      await expect(page.locator('#stage')).toHaveAttribute('data-fit', device.expect.fit);
      const state = await stage(page);
      // The backing store is the canvas's box in device pixels: nothing for the browser to resample.
      expect(state.dpr).toBe(device.dpr);
      expect(state.css).toEqual([device.width, device.height]);
      expect(state.backing).toEqual([device.width * device.dpr, device.height * device.dpr]);
      expect(state.scale).toBeCloseTo(device.expect.scale, 6);
      if (device.expect.fit === 'integer') {
        expect([state.layout.width, state.layout.height]).toEqual([638 * state.scale, 459 * state.scale]);
      }
      // Centred.
      expect(Math.abs(state.backing[0]! - state.layout.width - 2 * state.layout.offsetX)).toBeLessThanOrEqual(
        1,
      );
      expect(
        Math.abs(state.backing[1]! - state.layout.height - 2 * state.layout.offsetY),
      ).toBeLessThanOrEqual(1);
    });

    if (device.expect === 'portrait') return;

    test('reaches the page a hotspot leads to with a tap or click', async ({ page }) => {
      await startAt(page, AIRPLANE, device.touch);
      const hotspot = await findHotspot(page);
      expect(hotspot, 'a hotspot that opens or changes page').not.toBeNull();
      const { x, y, target } = hotspot!;
      const { x: clientX, y: clientY } = await toClient(page, x, y);
      const pages = page.locator('body');
      // A first tap may only stop a sound the page started by itself; then a second one acts.
      for (let attempt = 0; attempt < 3; attempt++) {
        if (device.touch) await page.touchscreen.tap(clientX, clientY);
        else await page.mouse.click(clientX, clientY);
        const reached = await expect(pages)
          .toHaveAttribute('data-pages', new RegExp(`(^| )${target}( |$)`), { timeout: 5_000 })
          .then(() => true)
          .catch(() => false);
        if (reached) break;
      }
      await expect(pages).toHaveAttribute('data-pages', new RegExp(`(^| )${target}( |$)`));
      await screenshot(page, `${device.name} after tap`);
    });
  });
}

test.describe('settings', () => {
  test.skip(!hasDisc, 'no extracted disc (vendor/cd or $TWTW_CD): run "pnpm data"');
  test.use({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });

  test('switch to fill mode and remember it', async ({ page }) => {
    await startAt(page, AIRPLANE, false);
    await page.locator('#settings-button').click();
    const menu = page.locator('#settings');
    await expect(menu).toBeVisible();
    await screenshot(page, 'settings open');
    await page.locator('#setting-fill').check();
    await expect(page.locator('#stage')).toHaveAttribute('data-fit', 'fill');
    expect((await stage(page)).layout.height).toBe(1080);
    await page.locator('#settings-done').click();
    await expect(menu).toBeHidden();
    await page.reload();
    await expect(page.locator('#stage')).toHaveAttribute('data-fit', 'fill');
  });
});

test.describe('the Index on a touch screen', () => {
  test.skip(!hasDisc, 'no extracted disc (vendor/cd or $TWTW_CD): run "pnpm data"');
  test.use({ viewport: { width: 1024, height: 768 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });

  /** The Index page (special-screens.md §1.1) and its edit box's centre in page coordinates (§1.2). */
  const INDEX = 211350;
  const EDIT_BOX = { x: 209 + 154, y: 142 + 8 };

  test('a tap on the edit box brings up the soft keyboard, whose text goes to the edit box', async ({
    page,
  }) => {
    await startAt(page, AIRPLANE, true, INDEX);
    const field = page.locator('#soft-keyboard');
    const edit = await toClient(page, EDIT_BOX.x, EDIT_BOX.y);
    await page.touchscreen.tap(edit.x, edit.y);
    await expect(field).toBeFocused();
    // What a soft keyboard does: text input without key events.
    await field.evaluate((input: HTMLInputElement) => {
      input.value = 'gear';
      input.setSelectionRange(4, 4);
      input.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: 'r' }));
    });
    const editText = () =>
      page.evaluate(
        () =>
          (window as unknown as { twtw: { engine: { indexScreen: { editText: string } | null } } }).twtw
            .engine.indexScreen?.editText,
      );
    expect(await editText()).toBe('gear');
    // Typed keys from a hardware keyboard reach the engine once, not twice.
    await page.keyboard.type('s');
    expect(await editText()).toBe('gears');
    await expect(field).toHaveValue('gears');
    // Esc closes the Index, and the keyboard goes away.
    await page.keyboard.press('Escape');
    await expect(page.locator('body')).toHaveAttribute('data-pages', String(AIRPLANE));
    await expect(field).not.toBeFocused();
  });
});

// Copy and Print (special-screens.md §4). The Options button is navigation
// bar object 8, (5,417)–(90,435) in the bar at page (0,0); the Options popup's Copy, Print and
// Printer setup hotspots are at these points of its picture (special-screens.md §4.1).
const OPTIONS_BUTTON = { x: 47, y: 426 };
const OPTIONS_POPUP = 278816;
const OPTION_POINTS = { copy: { x: 120, y: 73 }, print: { x: 119, y: 103 }, setup: { x: 118, y: 133 } };
/** An Airplane popup, 287×330 (copied as 287×370). */
const AIRPLANE_POPUP = 2534;

/** Clicks a page point (with retries while a click only stops a sound) until `pages` shows. */
async function clickUntil(page: Page, x: number, y: number, pages: RegExp): Promise<void> {
  const body = page.locator('body');
  for (let attempt = 0; attempt < 3; attempt++) {
    const point = await toClient(page, x, y);
    await page.mouse.click(point.x, point.y);
    const reached = await expect(body)
      .toHaveAttribute('data-pages', pages, { timeout: 8_000 })
      .then(() => true)
      .catch(() => false);
    if (reached) return;
  }
  await expect(body).toHaveAttribute('data-pages', pages);
}

/** Clicks one of the options of the Options popup on top. */
async function clickOption(page: Page, option: keyof typeof OPTION_POINTS): Promise<void> {
  const picture = await page.evaluate(() => {
    const { engine } = (
      window as unknown as { twtw: { engine: { windows: { x: number; y: number; caption: number }[] } } }
    ).twtw;
    const top = engine.windows.at(-1)!;
    return { x: top.x, y: top.y + top.caption };
  });
  const point = await toClient(
    page,
    picture.x + OPTION_POINTS[option].x,
    picture.y + OPTION_POINTS[option].y,
  );
  await page.mouse.click(point.x, point.y);
}

/** Opens the Options popup and clicks one of its options. */
async function chooseOption(page: Page, option: keyof typeof OPTION_POINTS): Promise<void> {
  await clickUntil(page, OPTIONS_BUTTON.x, OPTIONS_BUTTON.y, new RegExp(` ${OPTIONS_POPUP}$`));
  await clickOption(page, option);
}

/** The size of the PNG on the clipboard. */
async function clipboardImageSize(page: Page): Promise<number[]> {
  return page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    const item = items.find((candidate) => candidate.types.includes('image/png'));
    if (item === undefined) throw new Error(`no PNG on the clipboard: ${items.map((i) => i.types).join()}`);
    const bitmap = await createImageBitmap(await item.getType('image/png'));
    return [bitmap.width, bitmap.height];
  });
}

/** Replaces window.print, which would block, with a counter. */
async function stubPrint(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const counted = window as unknown as { printed: number };
    counted.printed = 0;
    window.print = () => {
      counted.printed++;
    };
  });
}

const printCount = (page: Page) => page.evaluate(() => (window as unknown as { printed: number }).printed);

test.describe('copy', () => {
  test.skip(!hasDisc, 'no extracted disc (vendor/cd or $TWTW_CD): run "pnpm data"');
  test.use({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });

  test.beforeEach(async ({ context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  });

  test('Options → Copy puts the base page’s captioned picture on the clipboard at 2×', async ({ page }) => {
    await startAt(page, AIRPLANE, false);
    await chooseOption(page, 'copy');
    await expect(page.locator('#toast')).toHaveText('Picture copied');
    expect(await clipboardImageSize(page)).toEqual([638 * 2, (459 + 40) * 2]);
    await expect(page.locator('#picture-overlay')).toBeHidden();
  });

  test('Options → Copy copies the popup that was on top', async ({ page }) => {
    await startAt(page, AIRPLANE, false, AIRPLANE_POPUP);
    await chooseOption(page, 'copy');
    await expect(page.locator('#toast')).toHaveText('Picture copied');
    expect(await clipboardImageSize(page)).toEqual([287 * 2, (330 + 40) * 2]);
  });

  test('the settings menu copies the page on top', async ({ page }) => {
    await startAt(page, AIRPLANE, false, AIRPLANE_POPUP);
    await page.locator('#settings-button').click();
    await page.locator('#setting-copy').click();
    await expect(page.locator('#settings')).toBeHidden();
    await expect(page.locator('#toast')).toHaveText('Picture copied');
    expect(await clipboardImageSize(page)).toEqual([287 * 2, (330 + 40) * 2]);
  });

  test('without a clipboard, shows the picture to copy by hand or save', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'clipboard', { get: () => undefined });
    });
    await startAt(page, AIRPLANE, false);
    await page.locator('#settings-button').click();
    await page.locator('#setting-copy').click();
    const overlay = page.locator('#picture-overlay');
    await expect(overlay).toBeVisible();
    const image = page.locator('#picture-overlay-image');
    await expect(image).toHaveJSProperty('complete', true);
    expect(await image.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight])).toEqual([
      1276, 998,
    ]);
    const save = page.locator('#picture-save');
    await expect(save).toHaveAttribute('download', `the-way-things-work-${AIRPLANE}.png`);
    await expect(save).toHaveAttribute('href', /^blob:/);
    await screenshot(page, 'copy fallback');
    // Keys go to the overlay, not to the engine; Esc closes it.
    await page.keyboard.press('Escape');
    await expect(overlay).toBeHidden();
  });
});

test.describe('print', () => {
  test.skip(!hasDisc, 'no extracted disc (vendor/cd or $TWTW_CD): run "pnpm data"');
  test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });

  /** Saves the printout as a PDF for `paper`, and returns its number of pages. */
  async function pdf(page: Page, name: string, paper: 'A4' | 'Letter'): Promise<number> {
    const bytes = await page.pdf({ format: paper, preferCSSPageSize: true, printBackground: true });
    if (SCREENSHOTS !== undefined) {
      mkdirSync(SCREENSHOTS, { recursive: true });
      writeFileSync(join(SCREENSHOTS, `print-${name}-${paper}.pdf`), bytes);
    }
    return bytes.toString('latin1').match(/\/Type\s*\/Page\b/g)?.length ?? 0;
  }

  test('Options → Print lays out the base page’s 4× picture alone, centred, in landscape', async ({
    page,
  }) => {
    await stubPrint(page);
    await startAt(page, AIRPLANE, false);
    await chooseOption(page, 'print');
    await expect.poll(() => printCount(page)).toBe(1);
    const picture = page.locator('#print-picture');
    expect(await picture.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight])).toEqual([
      2552, 1996,
    ]);
    await expect(page.locator('#print')).toBeHidden();
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('#print')).toBeVisible();
    for (const hidden of ['#stage-box', '#settings-button', '#status', '#toast']) {
      await expect(page.locator(hidden)).toBeHidden();
    }
    await expect(page.locator('#print')).toHaveAttribute('data-orientation', 'landscape');
    await expect(page.locator('#print-page')).toHaveJSProperty(
      'textContent',
      '@page { size: landscape; margin: 10mm; }',
    );
    // The picture's size: a full screen with its band fits the area (here the viewport).
    const box = (await picture.boundingBox())!;
    const scale = Math.min(1280 / 640, 800 / 520);
    expect(box.width).toBeCloseTo(638 * scale, 0);
    expect(box.height).toBeCloseTo(499 * scale, 0);
    // Centred.
    expect(box.x).toBeCloseTo((1280 - box.width) / 2, 0);
    expect(box.y).toBeCloseTo((800 - box.height) / 2, 0);
    for (const paper of ['A4', 'Letter'] as const) expect(await pdf(page, 'base', paper)).toBe(1);
  });

  test('Options → Print of a popup, and Printer setup, open the print dialog in portrait', async ({
    page,
  }) => {
    await stubPrint(page);
    await startAt(page, AIRPLANE, false, AIRPLANE_POPUP);
    await chooseOption(page, 'print');
    await expect.poll(() => printCount(page)).toBe(1);
    const picture = page.locator('#print-picture');
    expect(await picture.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight])).toEqual([
      287 * 4,
      370 * 4,
    ]);
    await expect(page.locator('#print')).toHaveAttribute('data-orientation', 'portrait');
    await page.emulateMedia({ media: 'print' });
    // The same scale as a full screen: W/640 of a full screen's width.
    const box = (await picture.boundingBox())!;
    expect(box.width).toBeCloseTo(287 * Math.min(1280 / 640, 800 / 520), 0);
    for (const paper of ['A4', 'Letter'] as const) expect(await pdf(page, 'popup', paper)).toBe(1);
    await page.emulateMedia({ media: 'screen' });
    // Printer setup: the browser's print dialog is where printer and paper are chosen.
    await clickOption(page, 'setup');
    await expect.poll(() => printCount(page)).toBe(2);
  });

  test('the settings menu and Ctrl+P print the page on top', async ({ page }) => {
    await stubPrint(page);
    await startAt(page, AIRPLANE, false);
    await page.locator('#settings-button').click();
    await page.locator('#setting-print').click();
    await expect.poll(() => printCount(page)).toBe(1);
    await expect(page.locator('#print')).toHaveAttribute('data-orientation', 'landscape');
    await page.keyboard.press('Control+p');
    await expect.poll(() => printCount(page)).toBe(2);
  });
});
