// The desktop app's main process (docs/PLAN.md Phase 10): one window showing the web app's own build
// over the `app:` protocol (routes.ts), with the user's disc served at `/data/` from their disc image
// or CD, read in place (disc.ts). The first run, and Settings → Change disc…, show the disc chooser
// page instead. See apps/desktop/README.md for the security model.
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  app,
  BrowserWindow,
  clipboard,
  ClipboardItem,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  protocol,
  screen,
  session,
  type IpcMainInvokeEvent,
  type OpenDialogOptions,
  type WebContents,
} from 'electron';
import { DataNotFoundError } from '@twtw/engine';
import type { ChooseDiscResult, DiscKind, DiscStatus } from '@twtw/web/desktop-bridge';
import { Channel } from '../channels.ts';
import { loadConfig, saveConfig, type DesktopConfig } from './config.ts';
import { DiscRejected, openDisc, type OpenDisc } from './disc.ts';
import {
  APP_SCHEME,
  APP_URL,
  contentTypeFor,
  isAppUrl,
  PICKER_URL,
  routeRequest,
  SECURITY_HEADERS,
} from './routes.ts';

/** The packaged app's folder: main.js, preload.cjs, web/ (the web build) and desktop/ (the chooser). */
const appDir = dirname(fileURLToPath(import.meta.url));
const TITLE = 'The Way Things Work';
/** The original's client area (apps/web/src/stage.ts), shown at a whole scale. */
const STAGE = { width: 638, height: 459 } as const;
/** Largest picture the clipboard takes from the page (a 2× copy is about 0.3 MB). */
const MAX_PNG_BYTES = 32 * 1024 * 1024;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// Before `ready`: `app:` is a standard, secure scheme (a secure context, fetch, storage), and every
// renderer is sandboxed.
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true },
  },
]);
app.enableSandbox();
app.setName(TITLE);

let window: BrowserWindow | null = null;
let disc: OpenDisc | null = null;
let config: DesktopConfig = { disc: null };
/** Why the configured disc could not be opened at start, for the chooser page. */
let discProblem: string | null = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (window === null) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });
  app.on('web-contents-created', (_event, contents) => lockDown(contents));
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => {
    void disc?.close();
  });
  app
    .whenReady()
    .then(start)
    .catch((error: unknown) => {
      dialog.showErrorBox(TITLE, `The app could not start: ${String(error)}`);
      app.quit();
    });
}

async function start(): Promise<void> {
  Menu.setApplicationMenu(process.platform === 'darwin' ? macMenu() : null);
  secureSession();
  protocol.handle(APP_SCHEME, (request) => respond(request));
  registerIpc();

  config = await loadConfig(app.getPath('userData'));
  if (config.disc !== null) {
    try {
      disc = await openDisc(config.disc.kind, config.disc.path);
    } catch (error) {
      discProblem = reasonOf(error);
    }
  }
  window = createWindow();
  await window.loadURL(disc === null ? PICKER_URL : APP_URL);
}

function createWindow(): BrowserWindow {
  const { width, height } = initialContentSize();
  const created = new BrowserWindow({
    title: TITLE,
    width,
    height,
    useContentSize: true,
    minWidth: 320,
    minHeight: 240,
    backgroundColor: '#000000',
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon: join(appDir, 'web', 'icons', 'icon-512.png') } : {}),
    webPreferences: {
      preload: join(appDir, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      navigateOnDragDrop: false,
      spellcheck: false,
      // The original starts its title, with sound, at once; there is no "tap to start" here.
      autoplayPolicy: 'no-user-gesture-required',
      devTools: !app.isPackaged,
    },
  });
  created.once('ready-to-show', () => created.show());
  // The pages set their own title; keep the app's name.
  created.on('page-title-updated', (event) => event.preventDefault());
  created.on('closed', () => {
    window = null;
  });
  return created;
}

/** The stage at the largest whole scale that fits most of the screen (2× on a 1080p screen). */
function initialContentSize(): { width: number; height: number } {
  const area = screen.getPrimaryDisplay().workAreaSize;
  const scale = Math.max(
    1,
    Math.floor(Math.min((area.width * 0.95) / STAGE.width, (area.height * 0.9) / STAGE.height)),
  );
  return { width: STAGE.width * scale, height: STAGE.height * scale };
}

// -------------------------------------------------------------------------------------------------
// The app: protocol

async function respond(request: Request): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return plain(405, 'method not allowed');
  const route = routeRequest(request.url);
  try {
    switch (route.kind) {
      case 'manifest':
        if (disc === null) return plain(404, 'no disc');
        return bytes(JSON.stringify(disc.manifest), 'application/json; charset=utf-8');
      case 'data':
        if (disc === null) return plain(404, 'no disc');
        return bytes(await disc.read(route.path), 'application/octet-stream');
      case 'picker':
        return await ownFile(join(appDir, 'desktop'), route.segments);
      case 'web':
        return await ownFile(join(appDir, 'web'), route.segments);
      case 'invalid':
        return plain(400, 'bad request');
    }
  } catch (error) {
    if (error instanceof DataNotFoundError) return plain(404, 'not found');
    console.error(`${request.url}:`, error);
    return plain(500, 'cannot read');
  }
}

/** A file of the app's own build (inside app.asar when packaged). */
async function ownFile(root: string, segments: readonly string[]): Promise<Response> {
  let body: Uint8Array;
  try {
    body = await readFile(join(root, ...segments));
  } catch {
    return plain(404, 'not found');
  }
  return bytes(body, contentTypeFor(segments.at(-1) ?? ''));
}

function bytes(body: Uint8Array | string, type: string): Response {
  // The bytes as read (fresh, ArrayBuffer-backed buffers), without a copy.
  return new Response(body as Uint8Array<ArrayBuffer> | string, {
    status: 200,
    headers: { ...SECURITY_HEADERS, 'Content-Type': type },
  });
}

function plain(status: number, text: string): Response {
  return new Response(text, {
    status,
    headers: { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

// -------------------------------------------------------------------------------------------------
// Security: no navigation away, no new windows, no remote requests, no permissions but fullscreen

function lockDown(contents: WebContents): void {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault();
  });
  contents.on('will-redirect', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault();
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
}

function secureSession(): void {
  const current = session.defaultSession;
  // Full screen (Settings → Full screen) is the one thing a page may ask for.
  current.setPermissionRequestHandler((_contents, permission, callback) =>
    callback(permission === 'fullscreen'),
  );
  current.setPermissionCheckHandler((_contents, permission) => permission === 'fullscreen');
  // Nothing leaves the computer: every request that is not our own protocol is cancelled.
  current.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    callback({ cancel: !isLocalUrl(details.url) });
  });
  current.setSpellCheckerEnabled(false);
}

function isLocalUrl(url: string): boolean {
  return isAppUrl(url) || url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('devtools:');
}

// -------------------------------------------------------------------------------------------------
// The bridge (preload.ts): every message must come from one of our pages in our window

function registerIpc(): void {
  handle(Channel.copyPng, (_event, png: unknown) => copyPng(png));
  handle(Channel.changeDisc, async () => {
    await window?.loadURL(PICKER_URL);
  });
  handle(Channel.discStatus, (): DiscStatus => ({
    path: disc?.path ?? config.disc?.path ?? null,
    kind: disc?.kind ?? config.disc?.kind ?? null,
    problem: disc === null ? discProblem : null,
  }));
  handle(Channel.chooseDisc, (event, kind: unknown) => chooseDisc(event, kind));
  handle(Channel.openApp, async () => {
    if (disc !== null) await window?.loadURL(APP_URL);
  });
}

function handle<T>(channel: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => T): void {
  ipcMain.handle(channel, (event, ...args) => {
    const frame = event.senderFrame;
    if (window === null || event.sender !== window.webContents || frame === null || !isAppUrl(frame.url)) {
      throw new Error(`${channel}: refused`);
    }
    return listener(event, ...args);
  });
}

/**
 * Copy (picture-output.ts): the page's PNG onto the system clipboard. Electron 44 replaced
 * `clipboard.writeImage` with the W3C-style `clipboard.write` of ClipboardItems; the PNG is decoded
 * first, so that only a real picture reaches the clipboard.
 */
async function copyPng(png: unknown): Promise<void> {
  if (
    !(png instanceof Uint8Array) ||
    png.length > MAX_PNG_BYTES ||
    !PNG_SIGNATURE.every((b, i) => png[i] === b)
  ) {
    throw new Error('copy: not a PNG');
  }
  const bytes = new Uint8Array(png);
  if (nativeImage.createFromBuffer(Buffer.from(bytes.buffer)).isEmpty()) {
    throw new Error('copy: the PNG could not be decoded');
  }
  await clipboard.write([new ClipboardItem({ 'image/png': new Blob([bytes], { type: 'image/png' }) })]);
}

async function chooseDisc(event: IpcMainInvokeEvent, kind: unknown): Promise<ChooseDiscResult> {
  if (kind !== 'iso' && kind !== 'directory') throw new Error('chooseDisc: bad kind');
  const parent = BrowserWindow.fromWebContents(event.sender);
  const options: OpenDialogOptions =
    kind === 'iso'
      ? {
          title: 'Choose your disc image of The Way Things Work',
          properties: ['openFile'],
          filters: [
            { name: 'Disc images (.iso)', extensions: ['iso', 'ISO'] },
            { name: 'All files', extensions: ['*'] },
          ],
        }
      : { title: 'Choose The Way Things Work CD (its drive or top folder)', properties: ['openDirectory'] };
  const picked =
    parent === null ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(parent, options);
  const path = picked.filePaths[0];
  if (picked.canceled || path === undefined) return { outcome: 'cancelled' };
  return useDisc(kind, path);
}

/** Opens and checks a disc; if good, it replaces the current one, is remembered, and the app shows. */
async function useDisc(kind: DiscKind, path: string): Promise<ChooseDiscResult> {
  let opened: OpenDisc;
  try {
    opened = await openDisc(kind, path);
  } catch (error) {
    return { outcome: 'rejected', path, reason: reasonOf(error) };
  }
  const previous = disc;
  disc = opened;
  discProblem = null;
  await previous?.close();
  config = { ...config, disc: { kind, path } };
  await saveConfig(app.getPath('userData'), config);
  // After the reply has gone back to the chooser page.
  setImmediate(() => void window?.loadURL(APP_URL));
  return { outcome: 'opened' };
}

function reasonOf(error: unknown): string {
  if (error instanceof DiscRejected) return error.message;
  return `It cannot be read: ${error instanceof Error ? error.message : String(error)}`;
}

/** macOS keeps a menu bar: the app menu (About, Hide, Quit), Edit for the Index's typing, Window. */
function macMenu(): Menu {
  return Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]);
}
