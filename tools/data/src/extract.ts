import { mkdir, open, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import type { IsoEntry, IsoImage } from '@twtw/formats';

/** Files are copied in pieces of this size, so that large files are never held in memory whole. */
const CHUNK_SIZE = 1 << 20;

export interface ExtractSummary {
  readonly files: number;
  readonly directories: number;
  readonly bytes: number;
}

/**
 * Copies every file and directory of a disc image into `target` (which must exist), keeping the
 * disc's names (without `;1`) and setting modification times from the directory records.
 */
export async function extractIso(iso: IsoImage, target: string): Promise<ExtractSummary> {
  const directories: { path: string; entry: IsoEntry }[] = [];
  let files = 0;
  let bytes = 0;
  for await (const entry of iso.walk()) {
    const path = join(target, ...entry.path.split('/'));
    if (entry.isDirectory) {
      await mkdir(path);
      directories.push({ path, entry });
    } else {
      await extractFile(iso, entry, path);
      files++;
      bytes += entry.size;
    }
  }
  // Writing into a directory changes its time, so directories are dated once everything is in place.
  for (const { path, entry } of directories) await setTime(path, entry);
  return { files, directories: directories.length, bytes };
}

async function extractFile(iso: IsoImage, entry: IsoEntry, path: string): Promise<void> {
  const handle = await open(path, 'wx');
  try {
    for (let offset = 0; offset < entry.size; offset += CHUNK_SIZE) {
      const chunk = await iso.readFileRange(entry, offset, Math.min(CHUNK_SIZE, entry.size - offset));
      for (let done = 0; done < chunk.length;) {
        done += (await handle.write(chunk, done)).bytesWritten;
      }
    }
  } finally {
    await handle.close();
  }
  await setTime(path, entry);
}

async function setTime(path: string, entry: IsoEntry): Promise<void> {
  if (entry.modified !== undefined) await utimes(path, entry.modified, entry.modified);
}
