// Device checks (docs/architecture.md, "Validation" 7): `pnpm test:devices`. Runs the dev server, which serves the
// extracted disc under /data, on a high port, and drives Chromium at desktop, tablet and phone
// viewports. Without the disc the tests skip.
import { defineConfig } from '@playwright/test';
import { discDir, hasDisc } from './e2e/disc.ts';

const port = Number(process.env['TWTW_E2E_PORT'] ?? 47391);

export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.e2e.ts',
  outputDir: 'test-results',
  fullyParallel: true,
  workers: 4,
  timeout: 60_000,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${port}/`,
    browserName: 'chromium',
    trace: 'off',
  },
  // Without the disc there is nothing to serve; the tests skip.
  ...(hasDisc
    ? {
        webServer: {
          command: `pnpm exec vite --host 127.0.0.1 --port ${port} --strictPort`,
          url: `http://127.0.0.1:${port}/`,
          reuseExistingServer: false,
          timeout: 60_000,
          env: { TWTW_CD: discDir },
        },
      }
    : {}),
});
