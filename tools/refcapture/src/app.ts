// The original program under Wine: a launch copy with a patched page database, started on the
// nested display, found in the X window tree, and closed again.
import { spawn, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { sleep } from './env.ts';
import { cdDir, launchDir, patchedExe, runDir, winePrefix } from './paths.ts';
import type { Size, XHelper, XWindow } from './x.ts';

export const WINDOW_TITLE = 'The Way Things Work';

/** The client area under Windows 3.1 (docs/formats/program.md, Window). */
export const WIN31_CLIENT = { width: 638, height: 459 } as const;

const launchExe = join(launchDir, 'TWTW.EXE');
/** How Wine names the launch copy (drive Z: is the Unix root). */
const launchExeWindows = 'Z:' + launchExe.replaceAll('/', '\\');

export function wineEnv(display: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, DISPLAY: display, WINEPREFIX: winePrefix };
  env['WINEDEBUG'] ??= '-all';
  delete env['WAYLAND_DISPLAY'];
  return env;
}

/** Checks the one-off set-up that wine/run.sh makes. */
export function checkWineSetup(): void {
  const missing = [
    [patchedExe, 'the palette-patched program'],
    [join(winePrefix, 'drive_c', 'windows', 'twtw.ini'), 'the Wine prefix with TWTW.INI'],
    [join(cdDir, '.windows-label'), 'the CD volume label file'],
  ].filter(([path]) => !existsSync(path!));
  if (missing.length > 0) {
    throw new Error(
      `Wine is not set up (${missing.map(([, what]) => what).join(', ')} missing). ` +
        'Run DISPLAY=:5 WAYLAND_DISPLAY= wine/run.sh once and close the program.',
    );
  }
}

export function wineVersion(): string {
  const result = spawnSync('wine', ['--version'], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : 'unknown';
}

/** Writes the launch copy: the patched program and the given page database next to it. */
export function prepareLaunch(database: Uint8Array): void {
  mkdirSync(launchDir, { recursive: true });
  if (!existsSync(launchExe) || statSync(launchExe).size !== statSync(patchedExe).size) {
    copyFileSync(patchedExe, launchExe);
  }
  writeFileSync(join(launchDir, 'TWTW.PNG'), database);
}

interface ProcessInfo {
  readonly pid: number;
  readonly cmdline: string;
  readonly env: string;
}

function processes(): ProcessInfo[] {
  const found: ProcessInfo[] = [];
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const cmdline = readFileSync(`/proc/${name}/cmdline`, 'latin1').replaceAll('\0', ' ');
      const env = readFileSync(`/proc/${name}/environ`, 'latin1');
      found.push({ pid: Number(name), cmdline, env });
    } catch {
      // gone, or not ours
    }
  }
  return found;
}

/** The winevdm processes running our launch copy: the only Wine processes the harness kills. */
export function ourProgramProcesses(): number[] {
  const exe = launchExeWindows.toLowerCase();
  return processes()
    .filter((p) => /winevdm\.exe/i.test(p.cmdline) && p.cmdline.toLowerCase().includes(exe))
    .map((p) => p.pid);
}

/**
 * Wine processes of our prefix whose display is not ours. If the wineserver came up on another
 * display, the program centres itself for that screen and lands off-screen.
 */
export function prefixOnOtherDisplay(display: string): number[] {
  return processes()
    .filter(
      (p) => p.env.includes(`\0WINEPREFIX=${winePrefix}\0`) || p.env.startsWith(`WINEPREFIX=${winePrefix}\0`),
    )
    .filter((p) => /explorer\.exe/i.test(p.cmdline))
    .filter((p) => !p.env.split('\0').includes(`DISPLAY=${display}`))
    .map((p) => p.pid);
}

/** Starts the launch copy under Wine on `display`, detached, logging to vendor/refcapture/wine.log. */
export function startProgram(display: string): void {
  const others = prefixOnOtherDisplay(display);
  if (others.length > 0) {
    throw new Error(
      `Wine processes of ${winePrefix} run on another display (PIDs ${others.join(', ')}). ` +
        'Close them, or run `WINEPREFIX=… wineserver -k`, then try again.',
    );
  }
  mkdirSync(runDir, { recursive: true });
  const log = openSync(join(runDir, 'wine.log'), 'a');
  const child = spawn('wine', [launchExeWindows], {
    env: wineEnv(display),
    detached: true,
    stdio: ['ignore', log, log],
  });
  child.unref();
}

export function findMainWindow(windows: readonly XWindow[]): XWindow | undefined {
  return windows.find((window) => window.name === WINDOW_TITLE);
}

/**
 * Waits for the main window to appear and stop moving (the program centres it after loading the
 * database). On timeout, returns the top-level windows seen last instead, for the error message.
 */
export async function waitForMainWindow(
  x: XHelper,
  timeoutMs: number,
): Promise<{ window: XWindow } | { seen: XWindow[] }> {
  const deadline = Date.now() + timeoutMs;
  let previous: XWindow | undefined;
  let sameSince = 0;
  let windows: XWindow[] = [];
  while (Date.now() < deadline) {
    windows = await x.windows();
    const window = findMainWindow(windows);
    if (window !== undefined && previous !== undefined && sameRect(window, previous)) {
      if (Date.now() - sameSince >= 300) return { window };
    } else {
      sameSince = Date.now();
    }
    previous = window;
    await sleep(100);
  }
  return { seen: windows };
}

/**
 * Resizes the main window's X window to the Windows 3.1 client size and returns the window with
 * the client size Wine itself then reports.
 *
 * Wine 11 applies a ConfigureNotify it did not request only once a window manager has answered
 * the WM_STATE it asked for when mapping the window. There is no window manager on the nested
 * server, so the harness first sets WM_STATE to NormalState itself; without that, the X window
 * grows but the program's client stays 634×454 and the new strips stay black. Wine sets the
 * WM_NORMAL_HINTS minimum and maximum of a fixed-size window to its client size, which tells us
 * whether the program's client really grew (docs/reference-environments.md, "Client area size").
 */
export async function resizeToWin31(
  x: XHelper,
  window: XWindow,
): Promise<{ window: XWindow; wineClient: Size | null }> {
  await x.normal(window.id);
  await sleep(100);
  await x.resize(window.id, WIN31_CLIENT.width, WIN31_CLIENT.height);
  let current: XWindow | undefined = window;
  let wineClient: Size | null = null;
  for (let i = 0; i < 30; i++) {
    await sleep(100);
    current = findMainWindow(await x.windows());
    if (current === undefined) continue;
    wineClient = (await x.sizeHints(current.id)).max;
    if (isWin31Size(current) && wineClient !== null && isWin31Size(wineClient)) break;
  }
  return { window: current ?? window, wineClient };
}

function isWin31Size(size: Size): boolean {
  return size.width === WIN31_CLIENT.width && size.height === WIN31_CLIENT.height;
}

/** Closes the program: WM_DELETE_WINDOW first, then SIGKILL, then `wineserver -k` for our prefix. */
export async function stopProgram(x: XHelper | null, display: string): Promise<'closed' | 'killed' | 'none'> {
  if (ourProgramProcesses().length === 0) return 'none';
  if (x !== null) {
    try {
      const window = findMainWindow(await x.windows());
      if (window !== undefined) await x.close(window.id);
    } catch {
      // fall through to killing
    }
    for (let i = 0; i < 30 && ourProgramProcesses().length > 0; i++) await sleep(100);
    if (ourProgramProcesses().length === 0) return 'closed';
  }
  for (const pid of ourProgramProcesses()) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
  for (let i = 0; i < 30 && ourProgramProcesses().length > 0; i++) await sleep(100);
  if (ourProgramProcesses().length > 0) killWineServer(display);
  return 'killed';
}

/** Stops every process of our Wine prefix (the prefix is the harness's; see the README). */
export function killWineServer(display: string): void {
  spawnSync('wineserver', ['-k'], { env: wineEnv(display), stdio: 'ignore' });
}

function sameRect(a: XWindow, b: XWindow): boolean {
  return a.id === b.id && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}
