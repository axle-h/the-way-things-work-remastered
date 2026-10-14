/**
 * Builds synthetic RIFF WAVE files for tests, following the public RIFF/WAVE layout.
 */
import { ByteWriter } from '../writer.ts';

export interface WaveChunkSpec {
  readonly id: string;
  readonly data: ArrayLike<number>;
}

/** A RIFF WAVE file with the given chunks, in order, each padded to an even length. */
export function buildRiffWave(chunks: readonly WaveChunkSpec[]): Uint8Array {
  const w = new ByteWriter('le');
  ascii(w, 'RIFF').u32(0);
  ascii(w, 'WAVE');
  for (const chunk of chunks) {
    ascii(w, chunk.id).u32(chunk.data.length).bytes(chunk.data);
    if (chunk.data.length % 2 === 1) w.u8(0);
  }
  return w.patchU32(4, w.length - 8).toBytes();
}

export interface FmtSpec {
  readonly formatTag: number;
  readonly channels: number;
  readonly samplesPerSecond: number;
  readonly averageBytesPerSecond: number;
  readonly blockAlign: number;
  readonly bitsPerSample: number;
  /** Extension bytes after `cbSize`; omitted for a 16-byte WAVEFORMAT. */
  readonly extension?: ArrayLike<number>;
}

/** The body of a `fmt ` chunk. */
export function fmtChunk(spec: FmtSpec): Uint8Array {
  const w = new ByteWriter('le')
    .u16(spec.formatTag)
    .u16(spec.channels)
    .u32(spec.samplesPerSecond)
    .u32(spec.averageBytesPerSecond)
    .u16(spec.blockAlign)
    .u16(spec.bitsPerSample);
  if (spec.extension !== undefined) w.u16(spec.extension.length).bytes(spec.extension);
  return w.toBytes();
}

/** The standard MS-ADPCM coefficient pairs (scaled by 256), from the public format description. */
export const STANDARD_MS_ADPCM_COEFFICIENTS: readonly (readonly [number, number])[] = [
  [256, 0],
  [512, -256],
  [0, 0],
  [192, 64],
  [240, 0],
  [460, -208],
  [392, -232],
];

/** The MS-ADPCM `fmt ` extension: samples per block, coefficient count, coefficient pairs. */
export function msAdpcmExtension(
  samplesPerBlock: number,
  coefficients: readonly (readonly [number, number])[] = STANDARD_MS_ADPCM_COEFFICIENTS,
): Uint8Array {
  const w = new ByteWriter('le').u16(samplesPerBlock).u16(coefficients.length);
  for (const [a, b] of coefficients) w.i16(a).i16(b);
  return w.toBytes();
}

function ascii(w: ByteWriter, text: string): ByteWriter {
  for (const c of text) w.u8(c.charCodeAt(0));
  return w;
}
