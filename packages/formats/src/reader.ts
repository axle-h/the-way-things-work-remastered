/**
 * A bounds-checked cursor over a `Uint8Array`, shared by every decoder in this package.
 *
 * The page database is big-endian; DIB, PICS, WAV, NE and ISO 9660 are little-endian (ISO 9660
 * also stores many numbers in both orders). A reader has a default byte order used by `u16`,
 * `i16`, `u32` and `i32`; the `…le` and `…be` variants read one value in an explicit order.
 *
 * Every read checks bounds first and throws a {@link FormatError} naming the source and the
 * absolute offset, so a truncated or misparsed file fails loudly instead of yielding garbage.
 */

export type ByteOrder = 'le' | 'be';

/** A malformed or truncated input. `offset` is absolute within the source, when known. */
export class FormatError extends Error {
  readonly offset: number | undefined;

  constructor(message: string, offset?: number) {
    super(offset === undefined ? message : `${message} (at offset ${formatOffset(offset)})`);
    this.name = 'FormatError';
    this.offset = offset;
  }
}

/** Formats an offset for error messages: decimal and hex, e.g. `4660 (0x1234)`. */
export function formatOffset(offset: number): string {
  return `${offset} (0x${offset.toString(16)})`;
}

export interface ByteReaderOptions {
  /** Default byte order for `u16`, `i16`, `u32` and `i32`. */
  readonly order: ByteOrder;
  /** Name of the source, used in error messages (e.g. `TWTW.PNG`). */
  readonly name?: string;
  /**
   * Absolute offset of `bytes[0]` within the source, so that errors from a reader over part of a
   * file report file offsets. Defaults to 0.
   */
  readonly origin?: number;
}

export class ByteReader {
  readonly bytes: Uint8Array;
  readonly order: ByteOrder;
  readonly name: string;
  /** Absolute offset of `bytes[0]` within the source. */
  readonly origin: number;
  readonly #view: DataView;
  #position = 0;

  constructor(bytes: Uint8Array, options: ByteReaderOptions) {
    this.bytes = bytes;
    this.order = options.order;
    this.name = options.name ?? 'input';
    this.origin = options.origin ?? 0;
    this.#view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  /** Total length of the readable bytes. */
  get length(): number {
    return this.bytes.length;
  }

  /** Current position, relative to the start of this reader's bytes. */
  get position(): number {
    return this.#position;
  }

  /** Bytes left between the position and the end. */
  get remaining(): number {
    return this.bytes.length - this.#position;
  }

  /** Whether the position is at the end. */
  get atEnd(): boolean {
    return this.#position === this.bytes.length;
  }

  /** Moves to an offset relative to the start of this reader (0 … length inclusive). */
  seek(position: number): this {
    if (!Number.isInteger(position) || position < 0 || position > this.bytes.length) {
      throw this.error(`cannot seek to ${position}; length is ${this.bytes.length}`, this.origin);
    }
    this.#position = position;
    return this;
  }

  /** Advances by `count` bytes. */
  skip(count: number): this {
    this.#take(count);
    return this;
  }

  u8(): number {
    return this.#view.getUint8(this.#take(1));
  }

  i8(): number {
    return this.#view.getInt8(this.#take(1));
  }

  u16(): number {
    return this.order === 'le' ? this.u16le() : this.u16be();
  }

  i16(): number {
    return this.order === 'le' ? this.i16le() : this.i16be();
  }

  u32(): number {
    return this.order === 'le' ? this.u32le() : this.u32be();
  }

  i32(): number {
    return this.order === 'le' ? this.i32le() : this.i32be();
  }

  u16le(): number {
    return this.#view.getUint16(this.#take(2), true);
  }

  i16le(): number {
    return this.#view.getInt16(this.#take(2), true);
  }

  u32le(): number {
    return this.#view.getUint32(this.#take(4), true);
  }

  i32le(): number {
    return this.#view.getInt32(this.#take(4), true);
  }

  u16be(): number {
    return this.#view.getUint16(this.#take(2), false);
  }

  i16be(): number {
    return this.#view.getInt16(this.#take(2), false);
  }

  u32be(): number {
    return this.#view.getUint32(this.#take(4), false);
  }

  i32be(): number {
    return this.#view.getInt32(this.#take(4), false);
  }

  /** The next `count` bytes as a view (not a copy) into the underlying buffer. */
  bytesView(count: number): Uint8Array {
    const start = this.#take(count);
    return this.bytes.subarray(start, start + count);
  }

  /** The next `count` bytes as a copy. */
  bytesCopy(count: number): Uint8Array {
    return this.bytesView(count).slice();
  }

  /** The next `count` bytes as a string of one character per byte (for tags such as `RIFF`). */
  ascii(count: number): string {
    let text = '';
    for (const byte of this.bytesView(count)) text += String.fromCharCode(byte);
    return text;
  }

  /**
   * A new reader over the next `count` bytes, with the same byte order and name, advancing this
   * reader past them. Errors from the new reader report absolute offsets.
   */
  take(count: number): ByteReader {
    const start = this.#take(count);
    return new ByteReader(this.bytes.subarray(start, start + count), {
      order: this.order,
      name: this.name,
      origin: this.origin + start,
    });
  }

  /** A new reader over `[start, start + count)` of this reader's bytes; this reader does not move. */
  slice(start: number, count: number = this.bytes.length - start): ByteReader {
    if (!Number.isInteger(start) || !Number.isInteger(count) || start < 0 || count < 0) {
      throw this.error(`invalid slice ${start}+${count}`, this.origin);
    }
    if (start + count > this.bytes.length) {
      throw this.error(
        `slice of ${count} bytes at ${start} runs past the end (length ${this.bytes.length})`,
        this.origin + start,
      );
    }
    return new ByteReader(this.bytes.subarray(start, start + count), {
      order: this.order,
      name: this.name,
      origin: this.origin + start,
    });
  }

  /** A {@link FormatError} prefixed with the source name. Defaults to the current absolute offset. */
  error(message: string, offset: number = this.origin + this.#position): FormatError {
    return new FormatError(`${this.name}: ${message}`, offset);
  }

  /** Checks that `count` bytes are available, advances, and returns the start position. */
  #take(count: number): number {
    const start = this.#position;
    if (!Number.isInteger(count) || count < 0) {
      throw this.error(`invalid byte count ${count}`);
    }
    if (count > this.bytes.length - start) {
      throw this.error(
        `cannot read ${count} byte${count === 1 ? '' : 's'}; only ${this.bytes.length - start} left`,
      );
    }
    this.#position = start + count;
    return start;
  }
}
