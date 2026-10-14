import { DataNotFoundError, normalizeDataPath, type DataSource } from './data-source.ts';
import { FileIndex } from './file-index.ts';

/** A {@link DataSource} over files held in memory, for tests and for files the user supplies. */
export class MemoryDataSource implements DataSource {
  readonly #files = new Map<string, Uint8Array>();
  readonly #index: FileIndex;
  /** Paths read so far, as stored, in order (repeats included); tests use it to check caching. */
  readonly reads: string[] = [];

  /** `files` maps disc paths (stored case, `/` or `\` separators) to their bytes. */
  constructor(files: Iterable<readonly [string, Uint8Array]>) {
    for (const [path, bytes] of files) this.#files.set(normalizeDataPath(path), bytes);
    this.#index = new FileIndex(this.#files.keys());
  }

  read(path: string): Promise<Uint8Array> {
    const stored = this.#index.resolve(path);
    const bytes = stored === undefined ? undefined : this.#files.get(stored);
    if (stored === undefined || bytes === undefined) return Promise.reject(new DataNotFoundError(path));
    this.reads.push(stored);
    return Promise.resolve(bytes);
  }

  exists(path: string): Promise<boolean> {
    return Promise.resolve(this.#index.has(path));
  }
}
