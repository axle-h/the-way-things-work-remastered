// The nested X server (Xwayland, rootful) that the original runs on, and the harness's venv.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runDir, venvDir, venvPython } from './paths.ts';
import { XHelper } from './x.ts';

export const DEFAULT_DISPLAY = ':5';
export const SCREEN_SIZE = '1024x768';

const pidFile = join(runDir, 'xwayland.pid');

export function displayNumber(display: string): number {
  const match = /^:(\d+)$/.exec(display);
  if (match === null) throw new Error(`display must look like :5, not ${display}`);
  return Number(match[1]);
}

function socketPath(display: string): string {
  return `/tmp/.X11-unix/X${displayNumber(display)}`;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPid(): number | null {
  if (!existsSync(pidFile)) return null;
  const pid = Number(readFileSync(pidFile, 'utf8').trim());
  return Number.isInteger(pid) && pid > 0 && alive(pid) ? pid : null;
}

export interface XServerStatus {
  readonly display: string;
  /** Our Xwayland's PID, if we started the server that is running. */
  readonly pid: number | null;
  readonly running: boolean;
}

export function xServerStatus(display: string): XServerStatus {
  const pid = readPid();
  return { display, pid, running: existsSync(socketPath(display)) };
}

/** Creates vendor/venv with python-xlib if it is missing. */
export function ensureVenv(): void {
  const check = () =>
    existsSync(venvPython) &&
    spawnSync(venvPython, ['-I', '-c', 'import Xlib'], { stdio: 'ignore' }).status === 0;
  if (check()) return;
  console.log(`Creating ${venvDir} with python-xlib`);
  const steps: [string, string[]][] = [
    ['python3', ['-I', '-m', 'venv', venvDir]],
    [venvPython, ['-I', '-m', 'pip', 'install', '--quiet', 'python-xlib']],
  ];
  for (const [command, args] of steps) {
    const result = spawnSync(command, args, { stdio: 'inherit' });
    if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed`);
  }
  if (!check()) throw new Error(`python-xlib is not importable from ${venvPython}`);
}

/**
 * Starts a rootful Xwayland on `display` unless an X server is already listening there. Returns
 * true when this call started it (so the caller may stop it again).
 */
export async function startXServer(display: string): Promise<boolean> {
  ensureVenv();
  if (existsSync(socketPath(display))) return false;
  mkdirSync(runDir, { recursive: true });
  const log = openSync(join(runDir, 'xwayland.log'), 'a');
  const child = spawn('Xwayland', [display, '-geometry', SCREEN_SIZE, '-noreset'], {
    detached: true,
    stdio: ['ignore', log, log],
  });
  child.unref();
  if (child.pid === undefined) throw new Error('could not start Xwayland');
  writeFileSync(pidFile, `${child.pid}\n`);
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (existsSync(socketPath(display))) {
      const x = new XHelper(display);
      try {
        await x.screen();
        return true;
      } catch {
        // not accepting connections yet
      } finally {
        x.dispose();
      }
    }
    if (!alive(child.pid)) break;
    await sleep(200);
  }
  throw new Error(`Xwayland did not come up on ${display}; see ${join(runDir, 'xwayland.log')}`);
}

/** Stops the Xwayland this harness started (and only that one). */
export async function stopXServer(): Promise<boolean> {
  const pid = readPid();
  rmSync(pidFile, { force: true });
  if (pid === null) return false;
  process.kill(pid, 'SIGTERM');
  for (let i = 0; i < 25 && alive(pid); i++) await sleep(200);
  if (alive(pid)) process.kill(pid, 'SIGKILL');
  return true;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
