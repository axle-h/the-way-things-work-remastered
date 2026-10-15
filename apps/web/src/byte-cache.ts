// A size-capped, least-recently-used cache of file bytes, for the HTTP data source: files fetched
// ahead of time (prefetch.ts) and recently read wait here until the engine asks for them.

export class ByteCache {
  /** Budget in bytes for all entries. */
  readonly budget: number;
  /** Larger files are not kept. */
  readonly maxEntry: number;
  /** Least recently used first. */
  readonly #entries = new Map<string, Uint8Array>();
  #bytes = 0;

  constructor(budget: number, maxEntry = Math.floor(budget / 4)) {
    this.budget = budget;
    this.maxEntry = Math.min(maxEntry, budget);
  }

  /** Bytes held. */
  get bytes(): number {
    return this.#bytes;
  }

  get size(): number {
    return this.#entries.size;
  }

  has(key: string): boolean {
    return this.#entries.has(key);
  }

  /** The entry, now the most recently used. */
  get(key: string): Uint8Array | undefined {
    const bytes = this.#entries.get(key);
    if (bytes !== undefined) {
      this.#entries.delete(key);
      this.#entries.set(key, bytes);
    }
    return bytes;
  }

  /** Keeps `bytes` (unless too large), dropping the least recently used entries over the budget. */
  set(key: string, bytes: Uint8Array): void {
    this.delete(key);
    if (bytes.length > this.maxEntry) return;
    this.#entries.set(key, bytes);
    this.#bytes += bytes.length;
    for (const [oldest, old] of this.#entries) {
      if (this.#bytes <= this.budget) break;
      this.#entries.delete(oldest);
      this.#bytes -= old.length;
    }
  }

  delete(key: string): void {
    const bytes = this.#entries.get(key);
    if (bytes === undefined) return;
    this.#entries.delete(key);
    this.#bytes -= bytes.length;
  }
}
