import { DataNotFoundError, FileIndex, MANIFEST_NAME, parseManifest, type DataSource } from '@twtw/engine';

/**
 * The web app's {@link DataSource}: the extracted disc served over HTTP under a base URL
 * (`/data/`). It fetches `manifest.json` once, resolves names ignoring case through it, and then
 * requests each file by its name as stored on the disc.
 */
export class HttpDataSource implements DataSource {
  readonly baseUrl: string;
  readonly index: FileIndex;
  readonly #fetch: typeof fetch;

  private constructor(baseUrl: string, index: FileIndex, fetchFn: typeof fetch) {
    this.baseUrl = baseUrl;
    this.index = index;
    // Called as a plain function: browsers reject `fetch` called on another object ("Illegal invocation").
    this.#fetch = (input, init) => fetchFn(input, init);
  }

  /** `baseUrl` ends with `/`. `fetchFn` is replaceable for tests. */
  static async open(baseUrl = '/data/', fetchFn: typeof fetch = fetch): Promise<HttpDataSource> {
    const response = await fetchFn(`${baseUrl}${MANIFEST_NAME}`);
    if (!response.ok) throw new Error(`${baseUrl}${MANIFEST_NAME}: HTTP ${response.status}`);
    const manifest = parseManifest(await response.json());
    return new HttpDataSource(baseUrl, FileIndex.fromManifest(manifest), fetchFn);
  }

  async read(path: string): Promise<Uint8Array> {
    const stored = this.index.resolve(path);
    if (stored === undefined) throw new DataNotFoundError(path);
    const url = this.baseUrl + stored.split('/').map(encodeURIComponent).join('/');
    const response = await this.#fetch(url);
    if (response.status === 404) throw new DataNotFoundError(path);
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }

  exists(path: string): Promise<boolean> {
    return Promise.resolve(this.index.has(path));
  }
}
