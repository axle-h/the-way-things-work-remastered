/**
 * A growable byte writer, the mirror of {@link ByteReader}. Decoders do not need it; tests use it
 * to build synthetic inputs (the repository holds no disc bytes, see docs/CLEAN_ROOM.md).
 */
import type { ByteOrder } from './reader.ts';

export class ByteWriter {
  readonly order: ByteOrder;
  #buffer = new Uint8Array(256);
  #view = new DataView(this.#buffer.buffer);
  #length = 0;

  constructor(order: ByteOrder) {
    this.order = order;
  }

  /** Number of bytes written so far. */
  get length(): number {
    return this.#length;
  }

  u8(value: number): this {
    const at = this.#reserve(1);
    this.#view.setUint8(at, value);
    return this;
  }

  i8(value: number): this {
    const at = this.#reserve(1);
    this.#view.setInt8(at, value);
    return this;
  }

  u16(value: number): this {
    const at = this.#reserve(2);
    this.#view.setUint16(at, value, this.order === 'le');
    return this;
  }

  i16(value: number): this {
    const at = this.#reserve(2);
    this.#view.setInt16(at, value, this.order === 'le');
    return this;
  }

  u32(value: number): this {
    const at = this.#reserve(4);
    this.#view.setUint32(at, value, this.order === 'le');
    return this;
  }

  i32(value: number): this {
    const at = this.#reserve(4);
    this.#view.setInt32(at, value, this.order === 'le');
    return this;
  }

  bytes(bytes: ArrayLike<number>): this {
    const start = this.#reserve(bytes.length);
    this.#buffer.set(bytes, start);
    return this;
  }

  /** Overwrites a `u32` at an earlier position (for back-patching offsets and lengths). */
  patchU32(position: number, value: number): this {
    if (position + 4 > this.#length) throw new RangeError(`patch at ${position} is past the end`);
    this.#view.setUint32(position, value, this.order === 'le');
    return this;
  }

  /** A copy of the bytes written so far. */
  toBytes(): Uint8Array {
    return this.#buffer.slice(0, this.#length);
  }

  #reserve(count: number): number {
    const start = this.#length;
    const needed = start + count;
    if (needed > this.#buffer.length) {
      const grown = new Uint8Array(Math.max(needed, this.#buffer.length * 2));
      grown.set(this.#buffer.subarray(0, start));
      this.#buffer = grown;
      this.#view = new DataView(grown.buffer);
    }
    this.#length = needed;
    return start;
  }
}
