// `pnpm --filter @twtw/desktop package [--arch x64|arm64]`: packages dist/app (scripts/build.ts) for
// this computer's platform with @electron/packager, unsigned, and archives it in dist/release:
//   linux    the-way-things-work-<version>-linux-<arch>.tar.gz
//   windows  the-way-things-work-<version>-windows-<arch>.zip
//   macOS    the-way-things-work-<version>-macos-<arch>.zip (ad-hoc signed, as Apple silicon requires)
// The app goes into an asar archive, and Electron's fuses turn off what the app does not use (running
// as plain Node, NODE_OPTIONS, the inspector, loading code from outside the asar).
// `--platform` packages for another platform, without the macOS signature; CI builds each natively.
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { flipFuses, FuseV1Options, FuseVersion } from '@electron/fuses';
import { packager } from '@electron/packager';
import { icnsFromPngs, icoFromPngs } from './icons.ts';

const root = resolve(import.meta.dirname, '..');
const appDir = join(root, 'dist', 'app');
const outDir = join(root, 'dist', 'package');
const releaseDir = join(root, 'dist', 'release');
const iconDir = join(root, 'dist', 'icons');
const webIcons = join(appDir, 'web', 'icons');

const NAME = 'The Way Things Work';
const EXECUTABLE = 'the-way-things-work';
const PLATFORM_LABEL: Record<string, string> = { linux: 'linux', win32: 'windows', darwin: 'macos' };

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((arg) => arg !== '--'),
    options: {
      arch: { type: 'string', default: process.arch },
      platform: { type: 'string', default: process.platform },
    },
  });
  const platform = values.platform;
  const arch = values.arch;
  if (platform !== 'linux' && platform !== 'win32' && platform !== 'darwin') {
    throw new Error(`unsupported platform ${platform}`);
  }
  if (arch !== 'x64' && arch !== 'arm64') throw new Error(`unsupported arch ${arch}`);

  const { version } = JSON.parse(await readFile(join(appDir, 'package.json'), 'utf8')) as { version: string };
  const require = createRequire(import.meta.url);
  const electronVersion = (require('electron/package.json') as { version: string }).version;

  // Icons for Windows and macOS, from the web app's own (apps/web/public/icons).
  await mkdir(iconDir, { recursive: true });
  const [png192, png512] = await Promise.all([
    readFile(join(webIcons, 'icon-192.png')),
    readFile(join(webIcons, 'icon-512.png')),
  ]);
  await writeFile(join(iconDir, 'icon.ico'), icoFromPngs([png192]));
  await writeFile(join(iconDir, 'icon.icns'), icnsFromPngs([{ type: 'ic09', png: png512 }]));

  await rm(outDir, { recursive: true, force: true });
  const [packaged] = await packager({
    dir: appDir,
    out: outDir,
    name: NAME,
    executableName: platform === 'darwin' ? NAME : EXECUTABLE,
    appVersion: version,
    buildVersion: version,
    appCopyright:
      'MIT licence. The Way Things Work content is © 1994 Dorling Kindersley; bring your own disc.',
    appBundleId: 'io.github.axle-h.the-way-things-work',
    appCategoryType: 'public.app-category.education',
    win32metadata: { CompanyName: NAME, ProductName: NAME, FileDescription: NAME },
    icon: join(iconDir, 'icon'),
    platform,
    arch,
    electronVersion,
    asar: true,
    // dist/app has no node_modules: everything is bundled.
    prune: false,
    junk: true,
    overwrite: true,
    quiet: true,
  });
  if (packaged === undefined) throw new Error('packager produced nothing');

  const executable =
    platform === 'darwin'
      ? join(packaged, `${NAME}.app`)
      : join(packaged, platform === 'win32' ? `${EXECUTABLE}.exe` : EXECUTABLE);
  const signable = platform === 'darwin' && process.platform === 'darwin';
  if (platform === 'darwin' && !signable) console.warn('not on macOS: the app is not ad-hoc signed');
  await flipFuses(executable, {
    version: FuseVersion.V1,
    // Re-signs the bundle ad hoc after the change: Apple silicon runs only signed code.
    resetAdHocDarwinSignature: signable,
    strictlyRequireAllFuses: true,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    // Left off: not verified on Windows and macOS yet, and unsupported on Linux.
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
    [FuseV1Options.WasmTrapHandlers]: true,
  });

  // packager makes the folder private (0700); a download should unpack readable, as any app.
  if (process.platform !== 'win32') await chmod(packaged, 0o755);
  await mkdir(releaseDir, { recursive: true });
  const stem = `${EXECUTABLE}-${version}-${PLATFORM_LABEL[platform]}-${arch}`;
  const archive = join(releaseDir, platform === 'linux' ? `${stem}.tar.gz` : `${stem}.zip`);
  await rm(archive, { force: true });
  archiveDirectory(packaged, archive, platform);
  console.log(`Packaged ${packaged}\nArchive  ${archive}`);
}

/** Archives `directory` (as its own top-level folder) with the system's tools. */
function archiveDirectory(directory: string, archive: string, platform: string): void {
  const parent = dirname(directory);
  const name = basename(directory);
  let command: [string, string[]];
  if (archive.endsWith('.tar.gz')) {
    command = ['tar', ['-czf', archive, '-C', parent, name]];
  } else if (platform === 'darwin' && process.platform === 'darwin') {
    // ditto keeps the bundle's symbolic links, resource forks and signature intact.
    command = ['ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', directory, archive]];
  } else if (process.platform === 'win32') {
    command = ['tar', ['-a', '-cf', archive, '-C', parent, name]];
  } else {
    command = ['zip', ['-q', '-r', '-y', archive, name]];
  }
  const [program, args] = command;
  const result = spawnSync(program, args, { cwd: parent, stdio: 'inherit' });
  if (result.status !== 0)
    throw new Error(`${program} failed (${result.error?.message ?? `status ${result.status}`})`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
