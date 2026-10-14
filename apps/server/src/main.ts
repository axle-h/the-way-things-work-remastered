// `pnpm serve`: the built web app plus `/data` → the extracted disc. Used locally and in the container.
//   PORT (default 8080), HOST (default 127.0.0.1), TWTW_CD, TWTW_DIST.
import { createServer } from 'node:http';
import { createAppHandler, createDataHandler, dataDir, distDir } from './static.ts';

const port = Number(process.env['PORT'] ?? 8080);
const host = process.env['HOST'] ?? '127.0.0.1';
const serveData = createDataHandler(dataDir());
const serveApp = createAppHandler(distDir());

const server = createServer((req, res) => {
  const url = req.url ?? '/';
  if (url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('ok\n');
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
});

server.listen(port, host, () => {
  console.log(`Serving ${distDir()} and /data → ${dataDir()} at http://${host}:${port}/`);
});
