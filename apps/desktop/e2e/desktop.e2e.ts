// Desktop smoke tests: the first run shows the disc chooser, which turns down
// files that are not the disc; with the disc image, the app plays the title, reaches a page through a
// hotspot, copies to the system clipboard, remembers the disc and changes it from the settings. The
// system file dialog is replaced, in the main process, by one that answers with a given path.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { buildIso } from '@twtw/formats/testing';
import { findHotspot } from './hotspot.ts';
import { appDir, findIso } from './paths.ts';

/** A base page with plenty of hotspots: the Airplane. */
const AIRPLANE = 1538;
const iso = findIso();

/** Set `TWTW_SCREENSHOTS` to a directory to save screenshots (they show disc content: keep them out of git). */
const SCREENSHOTS = process.env['TWTW_SCREENSHOTS'];

async function screenshot(page: Page, name: string): Promise<void> {
  if (SCREENSHOTS === undefined) return;
  mkdirSync(SCREENSHOTS, { recursive: true });
  await page.screenshot({ path: join(SCREENSHOTS, `desktop-${name}.png`) });
}

let scratch: string;
test.beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'twtw-desktop-'));
});
test.afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

async function launch(userData: string): Promise<{ app: ElectronApplication; page: Page }> {
  // On Linux without a Wayland display (xvfb-run, a nested X server), Electron must be told to use X11.
  const x11 = process.platform === 'linux' && !process.env['WAYLAND_DISPLAY'] ? ['--ozone-platform=x11'] : [];
  const app = await electron.launch({
    args: [appDir, `--user-data-dir=${userData}`, ...x11],
    // Keeps GTK's dialogs and portals off the desktop session of whoever runs the tests.
    env: { ...process.env, DBUS_SESSION_BUS_ADDRESS: 'disabled:' },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return { app, page };
}

/** The next file dialog answers `path`. */
async function answerDialogWith(app: ElectronApplication, path: string): Promise<void> {
  await app.evaluate(({ dialog }, picked) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [picked] })) as never;
  }, path);
}

async function choose(
  app: ElectronApplication,
  page: Page,
  button: '#choose-iso' | '#choose-folder',
  path: string,
) {
  await answerDialogWith(app, path);
  await page.locator(button).click();
}

test.describe('first run', () => {
  test('shows the disc chooser and turns down what is not the disc', async () => {
    const userData = join(scratch, 'user');
    const { app, page } = await launch(userData);
    try {
      await expect(page.locator('#choose-iso')).toBeVisible();
      await expect(page.locator('#choose-folder')).toBeVisible();
      await expect(page.locator('#back')).toBeHidden();
      await screenshot(page, 'chooser');

      const problem = page.locator('#problem');
      const text = join(scratch, 'notes.iso');
      writeFileSync(text, 'not a disc image');
      await choose(app, page, '#choose-iso', text);
      await expect(problem).toContainText('not a CD image');

      const otherDisc = join(scratch, 'other.iso');
      writeFileSync(otherDisc, buildIso({ volumeLabel: 'HOLIDAYS', root: [] }).bytes);
      await choose(app, page, '#choose-iso', otherDisc);
      await expect(problem).toContainText('not The Way Things Work: it has the label “HOLIDAYS”');

      // The right label, but not the disc's page database.
      const lookalike = join(scratch, 'lookalike.iso');
      const database = { name: 'TWTW.PNG', data: Uint8Array.of(1, 2, 3) };
      writeFileSync(
        lookalike,
        buildIso({ volumeLabel: 'DKMMTWTW', root: [{ name: 'DKCODE', children: [database] }] }).bytes,
      );
      await choose(app, page, '#choose-iso', lookalike);
      await expect(problem).toContainText('not the 1994 edition');
      await screenshot(page, 'chooser-rejected');

      const folder = join(scratch, 'folder');
      mkdirSync(folder);
      await choose(app, page, '#choose-folder', folder);
      await expect(problem).toContainText('has no DKCODE/TWTW.PNG');

      // Nothing was remembered, and the window still shows the chooser.
      expect(page.url()).toBe('app://twtw/desktop/index.html');

      // Nothing remote: no fetch, no new window, no navigation away.
      const fetched = await page.evaluate(() =>
        fetch('https://example.com/').then(
          () => 'fetched',
          () => 'refused',
        ),
      );
      expect(fetched).toBe('refused');
      expect(await page.evaluate(() => window.open('https://example.com/') === null)).toBe(true);
      await page.evaluate(() => {
        location.href = 'https://example.com/';
      });
      await page.waitForTimeout(500);
      expect(page.url()).toBe('app://twtw/desktop/index.html');
      expect(app.windows()).toHaveLength(1);
      // Node and Electron are out of the page's reach; only the bridge is there.
      expect(
        await page.evaluate(() => [typeof (globalThis as { require?: unknown }).require, typeof process]),
      ).toEqual(['undefined', 'undefined']);
      expect(
        await page.evaluate(() => Object.keys((window as { twtwDesktop?: object }).twtwDesktop ?? {})),
      ).toEqual(['platform', 'copyPng', 'changeDisc', 'discStatus', 'chooseDisc', 'openApp']);
    } finally {
      await app.close();
    }
  });

  test('says so when the remembered disc has gone', async () => {
    const userData = join(scratch, 'user');
    mkdirSync(userData, { recursive: true });
    const gone = join(scratch, 'gone.iso');
    writeFileSync(join(userData, 'config.json'), JSON.stringify({ disc: { kind: 'iso', path: gone } }));
    const { app, page } = await launch(userData);
    try {
      await expect(page.locator('#problem')).toContainText('The disc chosen before cannot be used');
      await expect(page.locator('#current')).toContainText(gone);
      await expect(page.locator('#back')).toBeHidden();
    } finally {
      await app.close();
    }
  });
});

test.describe('with the disc image', () => {
  test.skip(iso === null, 'no disc image ($TWTW_ISO, or one .iso in vendor/)');

  test('plays it, reaches a page, copies, remembers it and changes it', async () => {
    const userData = join(scratch, 'user');
    let { app, page } = await launch(userData);
    try {
      await choose(app, page, '#choose-iso', iso!);
      // The app starts at once, without "tap to start": the title page, with its sound.
      await page.waitForURL('app://twtw/');
      const body = page.locator('body');
      await expect(body).toHaveAttribute('data-pages', /^\d+$/, { timeout: 30_000 });
      await expect(page.locator('#gate')).toBeHidden();
      await page.waitForTimeout(1500);
      await screenshot(page, 'title');

      // A page, and a hotspot on it that leads to another.
      await page.evaluate((ref) => {
        location.hash = `#page=${ref}`;
      }, AIRPLANE);
      await expect(body).toHaveAttribute('data-pages', String(AIRPLANE), { timeout: 30_000 });
      const hotspot = await findHotspot(iso!, AIRPLANE);
      expect(hotspot, 'a hotspot that opens or changes page').not.toBeNull();
      const point = await page.locator('#stage').evaluate((canvas: HTMLCanvasElement, at) => {
        const box = canvas.getBoundingClientRect();
        const [offsetX = 0, offsetY = 0, width = 0, height = 0] = (canvas.dataset['layout'] ?? '')
          .split(' ')
          .map(Number);
        const dpr = window.devicePixelRatio;
        return {
          x: box.left + (offsetX + ((at.x + 0.5) * width) / 638) / dpr,
          y: box.top + (offsetY + ((at.y + 0.5) * height) / 459) / dpr,
        };
      }, hotspot!);
      const reached = new RegExp(`(^| )${hotspot!.target}( |$)`);
      // A first click may only stop a sound the page started by itself; then a second one acts.
      for (let attempt = 0; attempt < 3; attempt++) {
        await page.mouse.click(point.x, point.y);
        const done = await expect(body)
          .toHaveAttribute('data-pages', reached, { timeout: 5_000 })
          .then(() => true)
          .catch(() => false);
        if (done) break;
      }
      await expect(body).toHaveAttribute('data-pages', reached);
      await screenshot(page, 'after-click');

      // Copy puts the 2× captioned picture on the system clipboard.
      await app.evaluate(({ clipboard }) => clipboard.clear());
      await page.locator('#settings-button').click();
      await page.locator('#setting-copy').click();
      await expect(page.locator('#toast')).toHaveText('Picture copied');
      const size = await app.evaluate(async ({ clipboard, nativeImage }) => {
        const [item] = await clipboard.read();
        const blob = await item?.getType('image/png');
        if (!(blob instanceof Blob)) return { width: 0, height: 0 };
        return nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer())).getSize();
      });
      expect(size.width % 2).toBe(0);
      expect(size.width).toBeGreaterThan(0);
      expect(size.height).toBeGreaterThan(40 * 2);

      // Remembered: the next start goes straight to the app.
      await app.close();
      ({ app, page } = await launch(userData));
      await expect(page.locator('body')).toHaveAttribute('data-pages', /^\d+$/, { timeout: 30_000 });
      expect(page.url()).toBe('app://twtw/');

      // Settings → Change disc… shows the chooser with the disc in use, and Back returns.
      await page.locator('#settings-button').click();
      await expect(page.locator('#setting-disc')).toBeVisible();
      await page.locator('#setting-disc').click();
      await page.waitForURL('app://twtw/desktop/index.html');
      await expect(page.locator('#current')).toContainText(iso!);
      await expect(page.locator('#problem')).toBeHidden();
      await screenshot(page, 'change-disc');
      await page.locator('#back').click();
      await page.waitForURL('app://twtw/');
      await expect(page.locator('body')).toHaveAttribute('data-pages', /^\d+$/, { timeout: 30_000 });
    } finally {
      await app.close();
    }
  });
});
