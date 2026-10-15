// Desktop smoke tests (docs/PLAN.md Phase 10): `pnpm --filter @twtw/desktop test:e2e` drives the
// built app (dist/app, from `pnpm --filter @twtw/desktop build`) in Electron through Playwright. The
// chooser tests use synthetic files; the tests with the disc need its image ($TWTW_ISO, or the only
// .iso in vendor/) and skip without it. Electron needs a display: on Linux without one, run it under
// `xvfb-run -a` or a nested X server (DISPLAY).
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.e2e.ts',
  outputDir: 'test-results',
  // One Electron at a time: each test owns its window and user data folder.
  workers: 1,
  timeout: 120_000,
  reporter: [['list']],
  use: { trace: 'off' },
});
