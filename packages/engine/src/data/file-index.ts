import type { Manifest } from '../manifest.ts';
import { normalizeDataPath } from './data-source.ts';

/**
 * A case-insensitive index of the files on the disc: it maps any spelling of a path to the path as
 * stored on the disc. Data sources that know the full file list (the HTTP source through the
 * manifest, a directory walk, an ISO directory tree) use it to resolve names without probing.
 */
export class FileIndex {
  readonly #byKey = new Map<string, string>();

  /** `paths` are disc paths in their stored case, with `/` separators. */
  constructor(paths: Iterable<string>) {
    for (const path of paths) {
      const stored = normalizeDataPath(path);
      const key = stored.toLowerCase();
      const existing = this.#byKey.get(key);
      if (existing !== undefined && existing !== stored) {
        throw new Error(`two files differ only in case: ${existing} and ${stored}`);
      }
      this.#byKey.set(key, stored);
    }
  }

  static fromManifest(manifest: Manifest): FileIndex {
    return new FileIndex(manifest.files.map((file) => file.path));
  }

  /** Number of files. */
  get size(): number {
    return this.#byKey.size;
  }

  /** The path as stored on the disc, or `undefined` if there is no such file. */
  resolve(path: string): string | undefined {
    return this.#byKey.get(normalizeDataPath(path).toLowerCase());
  }

  has(path: string): boolean {
    return this.resolve(path) !== undefined;
  }

  /** Every path, as stored. */
  paths(): IterableIterator<string> {
    return this.#byKey.values();
  }
}
