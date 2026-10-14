import { createDataHandler, dataDir } from '@twtw/server';
import { defineConfig, type Connect, type Plugin } from 'vite';

/** Serves `/data/*` from the extracted disc (`vendor/cd` or `$TWTW_CD`), as `pnpm serve` does. */
function discData(): Plugin {
  const middleware = (): Connect.NextHandleFunction => {
    const handle = createDataHandler(dataDir());
    return (req, res, next) => {
      handle(req, res).catch(next);
    };
  };
  return {
    name: 'twtw-disc-data',
    configureServer(server) {
      server.middlewares.use('/data', middleware());
    },
    configurePreviewServer(server) {
      server.middlewares.use('/data', middleware());
    },
  };
}

export default defineConfig({
  plugins: [discData()],
  build: { target: 'es2024' },
});
