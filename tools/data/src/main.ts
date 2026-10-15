// `pnpm data`: extract the disc image to vendor/cd if needed, then write vendor/cd/manifest.json.
// See README.md in this directory.
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MANIFEST_NAME } from '@twtw/engine';
import { openIso } from '@twtw/formats';
import { buildManifest, openFileSource } from '@twtw/node';
import { extractIso } from './extract.ts';
import { formatManifest } from './manifest.ts';
import { cdDir, locateIso } from './paths.ts';

/** Extracts the disc image into a temporary directory, renamed to cdDir once complete. */
async function extract(isoPath: string): Promise<void> {
  const partial = `${cdDir}.partial`;
  await rm(partial, { recursive: true, force: true });
  await mkdir(partial, { recursive: true });
  const source = await openFileSource(isoPath);
  try {
    const iso = await openIso(source);
    console.log(`Extracting ${iso.volumeLabel} from ${isoPath}\n        to ${cdDir}`);
    const { files, directories } = await extractIso(iso, partial);
    console.log(`Extracted ${files} files in ${directories} directories`);
  } finally {
    await source.close();
  }
  await rename(partial, cdDir);
}

async function main(): Promise<void> {
  if (existsSync(cdDir)) {
    console.log(`Using the extracted disc in ${cdDir}`);
  } else {
    const iso = locateIso();
    if ('error' in iso) throw new Error(iso.error);
    await extract(iso.path);
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
