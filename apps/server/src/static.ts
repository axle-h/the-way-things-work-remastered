// Dependency-free static file serving, shared by the server (`pnpm serve`) and the Vite dev server.
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '../../..');

/** The extracted disc: `$TWTW_CD`, or `vendor/cd` in the repository. */
export function dataDir(): string {
  return resolve(process.env['TWTW_CD'] ?? join(repoRoot, 'vendor/cd'));
}

/** The built web app: `$TWTW_DIST`, or `apps/web/dist` in the repository. */
export function distDir(): string {
  return resolve(process.env['TWTW_DIST'] ?? join(repoRoot, 'apps/web/dist'));
}

const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
};

/**
 * Splits a URL path into safe path segments, or returns undefined if it is malformed or tries to
 * leave the root (`..`, `.`, empty segments, backslashes, NUL).
 */
export function urlPathSegments(url: string): string[] | undefined {
  const pathname = url.split(/[?#]/, 1)[0] ?? '';
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  const segments = decoded.replace(/^\/+/, '').split('/');
  if (segments.length === 1 && segments[0] === '') return [];
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') return undefined;
    if (segment.includes('\\') || segment.includes('\0')) return undefined;
  }
  return segments;
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/**
 * Resolves path segments under root to an existing file. The exact path is tried first; with
 * `ignoreCase`, each segment is then matched against the directory listing ignoring case, because
 * page database names are mixed case while disc files are upper case.
 */
export async function resolveFile(
  root: string,
  segments: readonly string[],
  ignoreCase: boolean,
): Promise<string | undefined> {
  if (segments.length === 0) return undefined;
  const exact = join(root, ...segments);
  if (await isFile(exact)) return exact;
  if (!ignoreCase) return undefined;
  let dir = root;
  for (const segment of segments) {
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return undefined;
    }
    const wanted = segment.toLowerCase();
    const match = names.find((name) => name.toLowerCase() === wanted);
    if (match === undefined) return undefined;
    dir = join(dir, match);
  }
  return (await isFile(dir)) ? dir : undefined;
}

async function sendFile(req: IncomingMessage, res: ServerResponse, path: string, type: string) {
  const { size } = await stat(path);
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': size });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  const stream = createReadStream(path);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

function sendStatus(res: ServerResponse, status: number, message: string) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(`${message}\n`);
}

export type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

/**
 * Serves the extracted disc. `req.url` is the path below the data root (the `/data` prefix already
 * removed). Disc files are served as opaque bytes, whatever their extension: `TWTW.PNG` is not a PNG.
 */
export function createDataHandler(root: string): Handler {
  return async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendStatus(res, 405, 'Method not allowed');
    const segments = urlPathSegments(req.url ?? '/');
    if (segments === undefined) return sendStatus(res, 400, 'Bad request');
    const path = await resolveFile(root, segments, true);
    if (path === undefined) return sendStatus(res, 404, 'Not found');
    const type =
      extname(path).toLowerCase() === '.json' ? contentTypes['.json']! : 'application/octet-stream';
    await sendFile(req, res, path, type);
  };
}

/** Serves the built web app, falling back to `index.html` for paths without an extension. */
export function createAppHandler(root: string): Handler {
  return async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendStatus(res, 405, 'Method not allowed');
    const segments = urlPathSegments(req.url ?? '/');
    if (segments === undefined) return sendStatus(res, 400, 'Bad request');
    let path = await resolveFile(root, segments, false);
    const last = segments.at(-1) ?? '';
    if (path === undefined && extname(last) === '') path = await resolveFile(root, ['index.html'], false);
    if (path === undefined) return sendStatus(res, 404, 'Not found');
    const type = contentTypes[extname(path).toLowerCase()] ?? 'application/octet-stream';
    await sendFile(req, res, path, type);
  };
}
