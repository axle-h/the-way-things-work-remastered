/**
 * PICS image unpacking and compositing. See docs/formats/pics.md, "Image packing".
 */
import type { Rect } from '../pagedb/model.ts';
import { FormatError } from '../reader.ts';
import { picsStride, type PicsChunk } from './parse.ts';

/** An unpacked PICS image: palette indices, top-down rows of `stride` bytes (`width` used). */
export interface PicsImage {
  readonly rect: Rect;
  readonly width: number;
  readonly height: number;
  /** `width` rounded up to even. */
  readonly stride: number;
  /** `stride × height` palette indices. */
  readonly indices: Uint8Array;
}

/** An 8-bit indexed picture to draw into: top-down rows of `width` bytes. */
export interface IndexedTarget {
  readonly width: number;
  readonly height: number;
  readonly indices: Uint8Array;
}

export interface UnpackedRuns {
  readonly output: Uint8Array;
  /** Packed bytes read; unpacking stops as soon as the output is full. */
  readonly consumed: number;
}

/**
 * Expands the PICS run-length code into `size` bytes. A control byte with the top bit set copies
 * the next `c & 0x7F` bytes literally; otherwise the next byte is repeated `c` times. Unpacking
 * stops when `size` bytes are produced. Running out of input, or an operation that would overrun
 * `size`, is a {@link FormatError} (`origin` is the absolute offset of `packed`, for messages).
 */
export function unpackPicsRuns(packed: Uint8Array, size: number, origin = 0): UnpackedRuns {
  const output = new Uint8Array(size);
  let read = 0;
  let written = 0;
  while (written < size) {
    if (read >= packed.length) {
      throw new FormatError(`packed image ends after ${written} of ${size} bytes`, origin + read);
    }
    const control = packed[read++] as number;
    const count = control & 0x7f;
    if (written + count > size) {
      throw new FormatError(`run of ${count} overruns the ${size}-byte image`, origin + read - 1);
    }
    if (control & 0x80) {
      if (read + count > packed.length) {
        throw new FormatError(`literal of ${count} bytes runs past the packed image`, origin + read - 1);
      }
      output.set(packed.subarray(read, read + count), written);
      read += count;
    } else {
      if (read >= packed.length) throw new FormatError('run without a value byte', origin + read - 1);
      output.fill(packed[read++] as number, written, written + count);
    }
    written += count;
  }
  return { output, consumed: read };
}

/**
 * Unpacks a chunk's image, or returns `null` when the chunk has none (unpacked size 0). Packed
 * bytes left over once the image is complete are ignored: 11 images on the disc end with a
 * superfluous one-byte literal (see docs/formats/pics.md).
 */
export function unpackPicsImage(chunk: PicsChunk): PicsImage | null {
  if (chunk.unpackedSize === 0) return null;
  const origin = chunk.offset + chunk.byteLength - chunk.packed.length;
  const { output } = unpackPicsRuns(chunk.packed, chunk.unpackedSize, origin);
  const width = chunk.rect.right - chunk.rect.left;
  const height = chunk.rect.bottom - chunk.rect.top;
  return { rect: chunk.rect, width, height, stride: picsStride(width), indices: output };
}

/**
 * Draws an image opaquely into `target` at its rectangle, clipped to the target. Row padding is
 * not drawn.
 */
export function compositePicsImage(target: IndexedTarget, image: PicsImage): void {
  const { left, top } = image.rect;
  const x0 = Math.max(0, left);
  const x1 = Math.min(target.width, left + image.width);
  const y0 = Math.max(0, top);
  const y1 = Math.min(target.height, top + image.height);
  if (x0 >= x1) return;
  for (let y = y0; y < y1; y++) {
    const from = (y - top) * image.stride + (x0 - left);
    target.indices.set(image.indices.subarray(from, from + (x1 - x0)), y * target.width + x0);
  }
}
