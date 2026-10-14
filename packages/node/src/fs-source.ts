import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { DataNotFoundError, FileIndex, MANIFEST_NAME, parseManifest, type DataSource } from '@twtw/engine';

/**
 * A {@link DataSource} over an extracted disc in a local directory (`vendor/cd`), for tests and
 * tools. Names resolve ignoring case through the directory's `manifest.json` (written by
 * `pnpm data`) or, without one, through a walk of the directory.
 */
export class DirectoryDataSource implements DataSource {
  readonly root: string;
  readonly index: FileIndex;

  private constructor(root: string, index: FileIndex) {
    this.root = root;
    this.index = index;
  }

  static async open(root: string): Promise<DirectoryDataSource> {
    let paths: Iterable<string>;
    try {
      const manifest = parseManifest(JSON.parse(await readFile(join(root, MANIFEST_NAME), 'utf8')));
      paths = manifest.files.map((file) => file.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      paths = await listFiles(root);
    }
    return new DirectoryDataSource(root, new FileIndex(paths));
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

/** Every regular file under root as a `/`-separated relative path (hidden entries skipped). */
async function listFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const paths: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const parts = relative(root, join(entry.parentPath, entry.name)).split(sep);
    if (parts.some((part) => part.startsWith('.')) || parts.join('/') === MANIFEST_NAME) continue;
    paths.push(parts.join('/'));
  }
  return paths;
}
