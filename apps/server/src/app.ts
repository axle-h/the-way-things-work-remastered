// The server's request routing, separate from `main.ts` so it can be tested on an ephemeral port.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createAppHandler, createDataHandler } from './static.ts';

/**
 * Keeps every crawler out. The deployment is public but unlisted: its hostname is not published,
 * and nothing it serves should end up in a search index.
 */
export const ROBOTS_TXT = 'User-agent: *\nDisallow: /\n';

export interface ServerOptions {
  /** The extracted disc, served under `/data`. */
  dataRoot: string;
  /** The built web app, served at `/`. */
  distRoot: string;
}

/**
 * Routes a request: `/healthz`, `/robots.txt`, `/data/*` → the disc, and everything else → the web
 * app. Every response carries `X-Robots-Tag: noindex`.
 */
export function createRequestListener(
  options: ServerOptions,
): (req: IncomingMessage, res: ServerResponse) => void {
  const serveData = createDataHandler(options.dataRoot);
  const serveApp = createAppHandler(options.distRoot);

  return (req, res) => {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    const url = req.url ?? '/';
    const path = url.split(/[?#]/, 1)[0];
    if (path === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('ok\n');
      return;
    }
    if (path === '/robots.txt') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(req.method === 'HEAD' ? undefined : ROBOTS_TXT);
      return;
    }
    const isData = url === '/data' || url.startsWith('/data/') || url.startsWith('/data?');
    if (isData) req.url = url.slice('/data'.length) || '/';
    const handled = isData ? serveData(req, res) : serveApp(req, res);
    handled.catch((error: unknown) => {
      console.error(error);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  };
}
