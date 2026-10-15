// The `app:` protocol the window loads everything from (no Electron imports, so it is unit-tested).
// One origin, `app://twtw`, serves three things:
//   /data/manifest.json, /data/<path>   the user's disc, read in place (main.ts);
//   /desktop/<file>                      the disc chooser page (src/picker, built into `desktop/`);
//   anything else                        the web app's own build (`web/`), `/` being index.html.
// The web app thus finds its disc at `/data/`, exactly as in a browser.

export const APP_SCHEME = 'app';
export const APP_HOST = 'twtw';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
/** The web app. */
export const APP_URL = `${APP_ORIGIN}/`;
/** The disc chooser. */
export const PICKER_URL = `${APP_ORIGIN}/desktop/index.html`;

export type Route =
  | { readonly kind: 'manifest' }
  | { readonly kind: 'data'; readonly path: string }
  | { readonly kind: 'picker'; readonly segments: readonly string[] }
  | { readonly kind: 'web'; readonly segments: readonly string[] }
  | { readonly kind: 'invalid' };

/**
 * Where a request goes. Anything not on our origin, and any path that would leave its directory
 * (`..`, `.`, empty segments, backslashes, NUL, bad escapes), is `invalid`.
 */
export function routeRequest(url: string): Route {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { kind: 'invalid' };
  }
  if (parsed.protocol !== `${APP_SCHEME}:` || parsed.host !== APP_HOST) return { kind: 'invalid' };
  const segments = pathSegments(parsed.pathname);
  if (segments === undefined) return { kind: 'invalid' };
  const [first, ...rest] = segments;
  if (first === 'data') {
    if (rest.length === 0) return { kind: 'invalid' };
    if (rest.length === 1 && rest[0] === 'manifest.json') return { kind: 'manifest' };
    return { kind: 'data', path: rest.join('/') };
  }
  if (first === 'desktop') return { kind: 'picker', segments: rest.length === 0 ? ['index.html'] : rest };
  return { kind: 'web', segments: segments.length === 0 ? ['index.html'] : segments };
}

/** Decoded, safe path segments of a URL path, or `undefined`. `/` is no segments. */
function pathSegments(pathname: string): string[] | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  const trimmed = decoded.replace(/^\/+/, '').replace(/\/$/, '');
  if (trimmed === '') return [];
  const segments = trimmed.split('/');
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') return undefined;
    if (segment.includes('\\') || segment.includes('\0')) return undefined;
  }
  return segments;
}

/** Whether a URL is one of our pages (navigation to anything else is refused). */
export function isAppUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === `${APP_SCHEME}:` && parsed.host === APP_HOST;
  } catch {
    return false;
  }
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  webmanifest: 'application/manifest+json',
  svg: 'image/svg+xml',
  png: 'image/png',
  ico: 'image/x-icon',
  txt: 'text/plain; charset=utf-8',
};

/** The Content-Type of one of our own files, by extension. */
export function contentTypeFor(name: string): string {
  const dot = name.lastIndexOf('.');
  const extension = dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
  return CONTENT_TYPES[extension] ?? 'application/octet-stream';
}

/**
 * The Content-Security-Policy of every page: nothing but our own origin. Inline styles are allowed
 * because the web app writes its print page rule into a `<style>` element (picture-output.ts);
 * pictures may be `data:` and `blob:` URLs (the cursors, Copy's fallback and the printed picture).
 * No inline or evaluated script, no plugins, no frames, no forms, nothing remote.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join('; ');

/** Headers sent with every response. */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Referrer-Policy': 'no-referrer',
};
