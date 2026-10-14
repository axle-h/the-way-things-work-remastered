// `pnpm data`: extract the disc image to vendor/cd if needed, then write vendor/cd/manifest.json.
// See README.md in this directory.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { MANIFEST_NAME } from '@twtw/engine';
import { buildManifest, formatManifest } from './manifest.ts';

const repoRoot = resolve(import.meta.dirname, '../../..');
const vendorDir = join(repoRoot, 'vendor');
const cdDir = resolve(process.env['TWTW_CD'] ?? join(vendorDir, 'cd'));

async function findIso(): Promise<string> {
  const explicit = process.env['TWTW_ISO'];
  if (explicit !== undefined) return resolve(explicit);
  const names = existsSync(vendorDir) ? await readdir(vendorDir) : [];
  const isos = names.filter((name) => name.toLowerCase().endsWith('.iso'));
  if (isos.length !== 1) {
    const found = isos.length === 0 ? 'none found' : `found ${isos.join(', ')}`;
    throw new Error(`Put exactly one disc image (.iso) in ${vendorDir}, or set TWTW_ISO (${found}).`);
  }
  return join(vendorDir, isos[0]!);
}

async function extract(iso: string): Promise<void> {
  const partial = `${cdDir}.partial`;
  await rm(partial, { recursive: true, force: true });
  console.log(`Extracting ${iso}\n        to ${cdDir}`);
  const result = spawnSync('7z', ['x', '-y', '-bso0', '-bsp0', `-o${partial}`, iso], { stdio: 'inherit' });
  if (result.error) throw new Error(`Could not run 7z: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`7z failed with exit code ${result.status}`);
  await rename(partial, cdDir);
}

async function main(): Promise<void> {
  if (existsSync(cdDir)) {
    console.log(`Using the extracted disc in ${cdDir}`);
  } else {
    await extract(await findIso());
  }

  const manifest = await buildManifest(cdDir);
  if (manifest.files.length === 0) throw new Error(`No files found in ${cdDir}`);
  const text = formatManifest(manifest);
  const manifestPath = join(cdDir, MANIFEST_NAME);
  const previous = existsSync(manifestPath) ? await readFile(manifestPath, 'utf8') : undefined;
  const totalBytes = manifest.files.reduce((sum, file) => sum + file.size, 0);
  const summary = `${manifest.files.length} files, ${(totalBytes / 2 ** 20).toFixed(1)} MiB`;
  if (previous === text) {
    console.log(`${manifestPath} is up to date (${summary})`);
  } else {
    await writeFile(`${manifestPath}.tmp`, text);
    await rename(`${manifestPath}.tmp`, manifestPath);
    console.log(`Wrote ${manifestPath} (${summary})`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
