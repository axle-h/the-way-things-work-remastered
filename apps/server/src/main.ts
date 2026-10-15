// `pnpm serve`: the built web app plus `/data` → the extracted disc. Used locally and in the container.
//   PORT (default 8080), HOST (default 127.0.0.1), TWTW_CD, TWTW_DIST.
import { createServer } from 'node:http';
import { createRequestListener } from './app.ts';
import { dataDir, distDir } from './static.ts';

const port = Number(process.env['PORT'] ?? 8080);
const host = process.env['HOST'] ?? '127.0.0.1';
const server = createServer(createRequestListener({ dataRoot: dataDir(), distRoot: distDir() }));

server.listen(port, host, () => {
  console.log(`Serving ${distDir()} and /data → ${dataDir()} at http://${host}:${port}/`);
});

// As PID 1 in a container, Node has no default handler for SIGTERM, so without these the container
// would only stop when it is killed. Stop accepting connections, let open requests finish briefly.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    server.close(() => process.exit(0));
    server.closeIdleConnections();
    setTimeout(() => process.exit(0), 5_000).unref();
  });
}
