/**
 * Builds synthetic PICS animations for tests (the repository holds no disc bytes). It writes the
 * layout in docs/formats/pics.md: the inverse of the parser.
 */
import { ByteWriter } from '../writer.ts';
import type { Rect } from '../pagedb/model.ts';

export interface PicsChunkSpec {
  readonly sound?: ArrayLike<number>;
  /** Defaults to a zero rectangle (chunks without an image carry arbitrary values on the disc). */
  readonly rect?: Rect;
  /** Unpacked image size; defaults to 0 (no image). */
  readonly unpackedSize?: number;
  /** Packed image bytes, e.g. from {@link packPicsRuns}. */
  readonly packed?: ArrayLike<number>;
  readonly type?: number;
  readonly filler?: string;
}

export interface PicsSpec {
  readonly preRollFactorA: number;
  readonly preRollFactorB: number;
  /** The pre-roll chunks first, then the frame chunks. */
  readonly chunks: readonly PicsChunkSpec[];
  /** Defaults to the number of chunks after the pre-roll. */
  readonly frameCount?: number;
  /** Defaults to 22,050 (8-bit mono PCM). */
  readonly samplesPerSecond?: number;
}

export function buildPics(spec: PicsSpec): Uint8Array {
  const rate = spec.samplesPerSecond ?? 22050;
  const preRoll = spec.preRollFactorA * spec.preRollFactorB;
  const w = new ByteWriter('le')
    .u16(1)
    .u32(spec.frameCount ?? spec.chunks.length - preRoll)
    .u16(spec.preRollFactorA)
    .u16(spec.preRollFactorB)
    .u32(16)
    // WAVEFORMAT: PCM, mono, rate, bytes/s, block align 1, 8 bits.
    .u16(1)
    .u16(1)
    .u32(rate)
    .u32(rate)
    .u16(1)
    .u16(8);
  for (const chunk of spec.chunks) {
    const sound = chunk.sound ?? [];
    const packed = chunk.packed ?? [];
    const rect = chunk.rect ?? { left: 0, top: 0, right: 0, bottom: 0 };
    w.u16(chunk.type ?? 1)
      .u32(sound.length)
      .i16(rect.left)
      .i16(rect.top)
      .i16(rect.right)
      .i16(rect.bottom)
      .u32(chunk.unpackedSize ?? 0)
      .u32(packed.length);
    for (const c of chunk.filler ?? 'funky!') w.u8(c.charCodeAt(0));
    w.bytes(sound).bytes(packed);
  }
  return w.toBytes();
}

/**
 * A simple PICS run-length packer: runs of 3 or more equal bytes become repeats, everything else
 * literals (at most 127 bytes per operation).
 */
export function packPicsRuns(data: ArrayLike<number>): number[] {
  const out: number[] = [];
  let literal: number[] = [];
  const flush = (): void => {
    if (literal.length > 0) out.push(0x80 | literal.length, ...literal);
    literal = [];
  };
  let i = 0;
  while (i < data.length) {
    let run = 1;
    while (i + run < data.length && run < 127 && data[i + run] === data[i]) run++;
    if (run >= 3) {
      flush();
      out.push(run, data[i] as number);
      i += run;
    } else {
      literal.push(data[i] as number);
      if (literal.length === 127) flush();
      i++;
    }
  }
  flush();
  return out;
}
