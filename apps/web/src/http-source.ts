import { DataNotFoundError, FileIndex, MANIFEST_NAME, parseManifest, type DataSource } from '@twtw/engine';
import { ByteCache } from './byte-cache.ts';

/** A request's network priority (`RequestInit.priority`). */
type FetchPriority = 'low' | 'auto';

/** Default budget for file bytes kept in memory (prefetched and recently read). */
export const DEFAULT_CACHE_BYTES = 64 * 1024 * 1024;

export interface HttpDataSourceOptions {
  /** Replaces `fetch`, for tests. */
  readonly fetch?: typeof fetch;
  /** Budget in bytes for the in-memory cache; 0 turns it off. */
  readonly cacheBytes?: number;
}

/**
 * The web app's {@link DataSource}: the extracted disc served over HTTP under a base URL
 * (`/data/`). It fetches `manifest.json` once, resolves names ignoring case through it, and then
 * requests each file by its name as stored on the disc. Files fetched ahead of time with
 * {@link prefetch}, and recently read ones, are kept in a size-capped in-memory cache.
 */
export class HttpDataSource implements DataSource {
  readonly baseUrl: string;
  readonly index: FileIndex;
  readonly cache: ByteCache;
  readonly #fetch: typeof fetch;
  /** File sizes from the manifest, by stored path. */
  readonly #sizes: ReadonlyMap<string, number>;
  /** Requests in flight, by stored path, so that a read joins a prefetch of the same file. */
  readonly #loading = new Map<string, Promise<Uint8Array>>();

  private constructor(
    baseUrl: string,
    index: FileIndex,
    sizes: ReadonlyMap<string, number>,
    fetchFn: typeof fetch,
    cacheBytes: number,
  ) {
    this.baseUrl = baseUrl;
    this.index = index;
    this.#sizes = sizes;
    this.cache = new ByteCache(cacheBytes);
    // Called as a plain function: browsers reject `fetch` called on another object ("Illegal invocation").
    this.#fetch = (input, init) => fetchFn(input, init);
  }

  /** `baseUrl` ends with `/`. */
  static async open(baseUrl = '/data/', options: HttpDataSourceOptions = {}): Promise<HttpDataSource> {
    const fetchFn = options.fetch ?? fetch;
    const response = await fetchFn(`${baseUrl}${MANIFEST_NAME}`);
    if (!response.ok) throw new Error(`${baseUrl}${MANIFEST_NAME}: HTTP ${response.status}`);
    const manifest = parseManifest(await response.json());
    const index = FileIndex.fromManifest(manifest);
    const sizes = new Map(manifest.files.map((file) => [index.resolve(file.path)!, file.size]));
    return new HttpDataSource(baseUrl, index, sizes, fetchFn, options.cacheBytes ?? DEFAULT_CACHE_BYTES);
  }

  read(path: string): Promise<Uint8Array> {
    const stored = this.index.resolve(path);
    if (stored === undefined) return Promise.reject(new DataNotFoundError(path));
    const cached = this.cache.get(stored);
    if (cached !== undefined) return Promise.resolve(cached);
    return this.#load(stored, path, 'auto');
  }

  exists(path: string): Promise<boolean> {
    return Promise.resolve(this.index.has(path));
  }

  /** The file's size from the manifest, or `undefined` if there is no such file. */
  sizeOf(path: string): number | undefined {
    const stored = this.index.resolve(path);
    return stored === undefined ? undefined : this.#sizes.get(stored);
  }

  /**
   * Fetches a file ahead of time, at low network priority, into the cache. Never rejects; resolves
   * `false` if the file is missing or could not be fetched.
   */
  async prefetch(path: string): Promise<boolean> {
    const stored = this.index.resolve(path);
    if (stored === undefined) return false;
    if (this.cache.has(stored)) return true;
    try {
      await this.#load(stored, path, 'low');
      return true;
    } catch {
      return false;
    }
  }

  #load(stored: string, path: string, priority: FetchPriority): Promise<Uint8Array> {
    let loading = this.#loading.get(stored);
    if (loading === undefined) {
      loading = this.#request(stored, path, priority).finally(() => this.#loading.delete(stored));
      this.#loading.set(stored, loading);
    }
    return loading;
  }

  async #request(stored: string, path: string, priority: FetchPriority): Promise<Uint8Array> {
    const url = this.baseUrl + stored.split('/').map(encodeURIComponent).join('/');
    // Fetch Priority: prefetches give way to what the page needs now (ignored where unsupported).
    const init: RequestInit & { priority?: FetchPriority } = { priority };
    const response = await this.#fetch(url, init);
    if (response.status === 404) throw new DataNotFoundError(path);
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    this.cache.set(stored, bytes);
    return bytes;
  }
}
