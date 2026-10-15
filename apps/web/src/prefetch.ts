// Fetching the files of the pages that can come next while the user looks at the current one
// (docs/PLAN.md Phase 7). The engine says which files (`filesToPrefetch`); this decides how many
// and when: a few at a time, small enough files only, and a fresh list replaces the old one when
// the page changes.

/** What the prefetcher needs from the data source (HttpDataSource). */
export interface PrefetchSource {
  /** Fetches a file into memory; never rejects. */
  prefetch(path: string): Promise<boolean>;
  /** The file's size, or `undefined` if there is no such file. */
  sizeOf(path: string): number | undefined;
}

export interface PrefetchOptions {
  /** Files fetched at the same time. */
  readonly concurrency?: number;
  /** Larger files (long animations) are left until they are needed. */
  readonly maxFileBytes?: number;
  /** Bytes fetched at most for one list (one page change). */
  readonly roundBytes?: number;
}

export class Prefetcher {
  readonly #source: PrefetchSource;
  readonly #concurrency: number;
  readonly #maxFileBytes: number;
  readonly #roundBytes: number;
  #queue: string[] = [];
  #running = 0;
  #waiters: (() => void)[] = [];
  /**
   * Files being fetched, and those that failed: not asked for again (the engine reports a failing
   * file when it needs it). Fetched files are asked for again, and the source answers from its
   * cache unless it dropped them meanwhile.
   */
  readonly #skip = new Set<string>();

  constructor(source: PrefetchSource, options: PrefetchOptions = {}) {
    this.#source = source;
    this.#concurrency = options.concurrency ?? 2;
    this.#maxFileBytes = options.maxFileBytes ?? 1024 * 1024;
    this.#roundBytes = options.roundBytes ?? 16 * 1024 * 1024;
  }

  /** Files still queued. */
  get pending(): number {
    return this.#queue.length;
  }

  /**
   * Replaces the queue with `paths` (most useful first), skipping missing, too large and already
   * fetched files, up to the byte budget for one list. Fetches already running finish.
   */
  request(paths: readonly string[]): void {
    const queue: string[] = [];
    let bytes = 0;
    for (const path of paths) {
      const key = path.toLowerCase();
      if (this.#skip.has(key)) continue;
      const size = this.#source.sizeOf(path);
      if (size === undefined || size > this.#maxFileBytes) continue;
      if (bytes + size > this.#roundBytes) break;
      bytes += size;
      queue.push(path);
    }
    this.#queue = queue;
    this.#pump();
  }

  /** Drops everything queued. */
  clear(): void {
    this.#queue = [];
    this.#settleIfIdle();
  }

  /** Resolves when nothing is queued or running. */
  idle(): Promise<void> {
    if (this.#running === 0 && this.#queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.#waiters.push(resolve));
  }

  #pump(): void {
    while (this.#running < this.#concurrency) {
      const path = this.#queue.shift();
      if (path === undefined) break;
      this.#running++;
      const key = path.toLowerCase();
      this.#skip.add(key);
      void this.#source.prefetch(path).then((fetched) => {
        if (fetched) this.#skip.delete(key);
        this.#running--;
        this.#pump();
      });
    }
    this.#settleIfIdle();
  }

  #settleIfIdle(): void {
    if (this.#running > 0 || this.#queue.length > 0) return;
    const waiters = this.#waiters;
    this.#waiters = [];
    for (const resolve of waiters) resolve();
  }
}
