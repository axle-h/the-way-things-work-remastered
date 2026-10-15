// `pnpm --filter @twtw/desktop build`: assembles the desktop app in dist/app, ready to run with
// Electron (`pnpm desktop`) or to package (scripts/package.ts):
//   main.js       the main process, bundled with the workspace packages it uses (src/main);
//   preload.cjs   the preload bridge (src/preload.ts);
//   desktop/      the disc chooser page (src/picker);
//   web/          the web app's own build, unchanged (apps/web/dist, built first by `pnpm build`);
//   package.json  name, version and entry point.
// No disc data is involved: the app reads the user's disc at run time.
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { build } from 'vite';

const root = resolve(import.meta.dirname, '..');
const webDist = resolve(root, '../web/dist');
const appDir = join(root, 'dist', 'app');

async function main(): Promise<void> {
  if (!(await stat(join(webDist, 'index.html')).catch(() => null))) {
    throw new Error(`${webDist} has no index.html: build the web app first (pnpm --filter @twtw/web build)`);
  }
  await rm(appDir, { recursive: true, force: true });
  await mkdir(appDir, { recursive: true });

  // The main process: an ES module for Electron's Node, every dependency bundled except Electron.
  await build({
    configFile: false,
    root,
    logLevel: 'warn',
    build: {
      ssr: 'src/main/main.ts',
      outDir: appDir,
      emptyOutDir: false,
      target: 'node24',
      minify: false,
      reportCompressedSize: false,
      rolldownOptions: { external: ['electron'], output: { format: 'es', entryFileNames: 'main.js' } },
    },
    ssr: { target: 'node', noExternal: true, external: ['electron'] },
  });

  // The preload script: sandboxed preloads must be a single CommonJS file that requires only Electron.
  await build({
    configFile: false,
    root,
    logLevel: 'warn',
    build: {
      outDir: appDir,
      emptyOutDir: false,
      target: 'chrome152',
      minify: false,
      reportCompressedSize: false,
      lib: { entry: 'src/preload.ts', formats: ['cjs'], fileName: () => 'preload.cjs' },
      rolldownOptions: { external: ['electron'] },
    },
  });

  // The disc chooser, served at app://twtw/desktop/.
  await build({
    configFile: false,
    root: join(root, 'src/picker'),
    base: '/desktop/',
    logLevel: 'warn',
    build: {
      outDir: join(appDir, 'desktop'),
      emptyOutDir: true,
      target: 'es2024',
      reportCompressedSize: false,
    },
  });

  await cp(webDist, join(appDir, 'web'), { recursive: true });

  const own = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
    version: string;
    productName: string;
  };
  const manifest = {
    name: 'the-way-things-work',
    productName: own.productName,
    version: own.version,
    description: 'The Way Things Work (1994), played from your own disc image.',
    license: 'MIT',
    type: 'module',
    main: 'main.js',
  };
  await writeFile(join(appDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Built ${appDir}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
