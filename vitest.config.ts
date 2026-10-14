import { defineConfig } from 'vitest/config';

// `pnpm test` at the root runs every workspace project.
export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*', 'tools/data', 'tools/cleanroom', 'tools/refcapture'],
  },
});
