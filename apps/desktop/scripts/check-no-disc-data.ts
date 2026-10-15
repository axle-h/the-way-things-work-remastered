// `pnpm --filter @twtw/desktop check:artefacts [paths…]`: fails if a packaged desktop app could hold
// disc data. Each path is a package directory or an archive (.zip, .tar.gz); the default is everything
// in dist/release. Archives are unpacked to a temporary directory, every file is checked, and so is
// every file inside each app.asar, by the rules in disc-scan.ts. The disc is DK's material: it is never
// in git, CI or a release, and the app reads the user's own copy at run time.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdtemp, open, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { extractFile, listPackage, statFile } from '@electron/asar';
import { HEAD_BYTES, MAX_ASAR_BYTES, problemsOf, type ScannedFile } from './disc-scan.ts';

const root = resolve(import.meta.dirname, '..');

interface Report {
  files: number;
  bytes: number;
  problems: string[];
}

async function main(): Promise<void> {
  let targets = process.argv.slice(2).map((path) => resolve(path));
  if (targets.length === 0) {
    const release = join(root, 'dist', 'release');
    targets = (await readdir(release)).map((name) => join(release, name));
  }
  if (targets.length === 0) throw new Error('nothing to check');
  let failed = false;
  for (const target of targets) {
    const report: Report = { files: 0, bytes: 0, problems: [] };
    if ((await lstat(target)).isDirectory()) {
      await scanDirectory(target, target, report);
    } else {
      const unpacked = await mkdtemp(join(tmpdir(), 'twtw-artefact-'));
      try {
        unpack(target, unpacked);
        await scanDirectory(unpacked, unpacked, report);
      } finally {
        await rm(unpacked, { recursive: true, force: true });
      }
    }
    console.log(`${target}: ${report.files} files, ${(report.bytes / 2 ** 20).toFixed(1)} MiB`);
    for (const problem of report.problems) console.error(`  ✗ ${problem}`);
    if (report.problems.length > 0) failed = true;
  }
  if (failed) {
    console.error('The artefacts may contain disc data (docs/CLEAN_ROOM.md). See apps/desktop/README.md.');
    process.exitCode = 1;
  } else {
    console.log('No disc data found.');
  }
}

function unpack(archive: string, into: string): void {
  // GNU tar (Linux) does not read zip files; bsdtar (macOS, Windows) reads both.
  const zipOnLinux = archive.endsWith('.zip') && process.platform === 'linux';
  const [program, args] = zipOnLinux
    ? ['unzip', ['-q', archive, '-d', into]]
    : ['tar', ['-xf', archive, '-C', into]];
  const result = spawnSync(program, args, { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${program} could not unpack ${archive}`);
}

async function scanDirectory(base: string, directory: string, report: Report): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const name = relative(base, path).split(sep).join('/');
    if (entry.isSymbolicLink()) continue; // macOS frameworks link to their own files
    if (entry.isDirectory()) {
      await scanDirectory(base, path, report);
    } else if (entry.isFile()) {
      const size = (await lstat(path)).size;
      check(
        { path: name, size, head: await readHead(path), sha256: await hashFile(path), inAsar: false },
        report,
      );
      if (name.endsWith('.asar')) scanAsar(path, name, report);
    }
  }
}

function scanAsar(archive: string, name: string, report: Report): void {
  let total = 0;
  for (const member of listPackage(archive, { isPack: false })) {
    // asar lists and looks up members with the platform's separator (`\` on Windows).
    const native = member.replace(/^[\\/]/, '');
    const inner = native.split(sep).join('/');
    const stat = statFile(archive, native, false) as { files?: unknown; link?: unknown; unpacked?: boolean };
    if (stat.files !== undefined || stat.link !== undefined) continue;
    // Unpacked members live beside the archive, in app.asar.unpacked, and are scanned there.
    const bytes = stat.unpacked === true ? new Uint8Array(0) : extractFile(archive, native);
    total += bytes.length;
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    check(
      {
        path: `${name}/${inner}`,
        size: bytes.length,
        head: bytes.subarray(0, HEAD_BYTES),
        sha256,
        inAsar: true,
      },
      report,
    );
  }
  if (total > MAX_ASAR_BYTES)
    report.problems.push(`${name}: ${total} bytes of files, over ${MAX_ASAR_BYTES}`);
}

function check(file: ScannedFile, report: Report): void {
  report.files++;
  report.bytes += file.size;
  for (const problem of problemsOf(file)) report.problems.push(`${file.path}: ${problem}`);
}

async function readHead(path: string): Promise<Uint8Array> {
  const handle = await open(path, 'r');
  try {
    const buffer = new Uint8Array(HEAD_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, HEAD_BYTES, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function hashFile(path: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolvePromise(hash.digest('hex')));
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
