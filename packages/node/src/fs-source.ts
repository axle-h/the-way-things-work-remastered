import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  DataNotFoundError,
  FileIndex,
  MANIFEST_NAME,
  parseManifest,
  type DataSource,
  type Manifest,
} from '@twtw/engine';
import { buildManifest } from './manifest.ts';

/**
 * A {@link DataSource} over an extracted disc in a local directory (`vendor/cd`), for tests and
 * tools, or over a mounted disc (desktop app). Names resolve ignoring case through the directory's
 * `manifest.json` (written by `pnpm data`) or, without one, through a walk of the directory.
 */
export class DirectoryDataSource implements DataSource {
  readonly root: string;
  readonly index: FileIndex;
  /** The files, from `manifest.json` or the walk. */
  readonly manifest: Manifest;

  private constructor(root: string, manifest: Manifest) {
    this.root = root;
    this.manifest = manifest;
    this.index = FileIndex.fromManifest(manifest);
  }

  static async open(root: string): Promise<DirectoryDataSource> {
    let manifest: Manifest;
    try {
      manifest = parseManifest(JSON.parse(await readFile(join(root, MANIFEST_NAME), 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      manifest = await buildManifest(root);
    }
    return new DirectoryDataSource(root, manifest);
  }

  async read(path: string): Promise<Uint8Array> {
    const stored = this.index.resolve(path);
    if (stored === undefined) throw new DataNotFoundError(path);
    const buffer = await readFile(join(this.root, ...stored.split('/')));
    return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  exists(path: string): Promise<boolean> {
    return Promise.resolve(this.index.has(path));
  }
}
