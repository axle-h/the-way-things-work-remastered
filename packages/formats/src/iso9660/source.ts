/**
 * Random access to a disc image. The ISO reader only ever asks for the bytes it needs, so an image
 * can be read from a file handle (desktop app, data prep) without loading it whole.
 */
export interface BlockSource {
  /** Total size of the image in bytes. */
  readonly size: number;
  /**
   * Resolves to exactly `length` bytes starting at `offset`. Callers never ask for bytes past
   * `size`. The reader hands the returned array to its callers, so it should not be reused.
   */
  read(offset: number, length: number): Promise<Uint8Array>;
}

/** A {@link BlockSource} over bytes already in memory (tests, small images). */
export function bytesSource(bytes: Uint8Array): BlockSource {
  return {
    size: bytes.length,
    read(offset, length) {
      if (offset < 0 || length < 0 || offset + length > bytes.length) {
        return Promise.reject(
          new RangeError(`read of ${length} bytes at ${offset} is outside 0…${bytes.length}`),
        );
      }
      return Promise.resolve(bytes.slice(offset, offset + length));
    },
  };
}
