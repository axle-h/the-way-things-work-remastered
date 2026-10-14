/**
 * Microsoft ADPCM decoder, written from the public algorithm description (Microsoft Multimedia
 * Standards Update, "ADPCM"). See docs/formats/wav.md.
 *
 * The data is a sequence of blocks of `blockAlign` bytes; the last one may be shorter. Each block
 * starts with a header holding, for each channel in turn, field by field: the predictor index
 * (`u8`), the initial step size "delta" (`i16`), then the newer seed sample (`i16`) and the older
 * seed sample (`i16`). The older seed is output first. The remaining bytes hold 4-bit codes, high
 * nibble first, alternating between channels. Each code predicts the next sample from the two
 * previous ones with the block's coefficient pair, adds the signed code times delta, and scales
 * delta by the adaptation table.
 */
import { FormatError } from '../reader.ts';

export interface MsAdpcmFormat {
  readonly channels: number;
  readonly blockAlign: number;
  /** Samples per channel in a full block, including the two seed samples. */
  readonly samplesPerBlock: number;
  /** Predictor coefficient pairs, scaled by 256. */
  readonly coefficients: readonly (readonly [number, number])[];
}

/** Step size multipliers (scaled by 256), indexed by the unsigned 4-bit code. */
const ADAPTATION = [230, 230, 230, 230, 307, 409, 512, 614, 768, 614, 512, 409, 307, 230, 230, 230];
const MIN_DELTA = 16;
const MAX_DELTA = 0x7fffffff;

/** Bytes of block header per channel. */
const HEADER_BYTES_PER_CHANNEL = 7;

/**
 * Samples per channel held by `byteLength` bytes of one block: the two seeds plus one per nibble,
 * capped at `samplesPerBlock`. A short last block holds fewer.
 */
export function msAdpcmBlockSamples(byteLength: number, format: MsAdpcmFormat): number {
  const nibbleBytes = byteLength - HEADER_BYTES_PER_CHANNEL * format.channels;
  if (nibbleBytes < 0) return 0;
  return Math.min(format.samplesPerBlock, 2 + Math.floor((nibbleBytes * 2) / format.channels));
}

/** Samples per channel that {@link decodeMsAdpcm} returns for `byteLength` bytes of data. */
export function msAdpcmSampleCount(byteLength: number, format: MsAdpcmFormat): number {
  const fullBlocks = Math.floor(byteLength / format.blockAlign);
  const rest = byteLength % format.blockAlign;
  return fullBlocks * format.samplesPerBlock + (rest === 0 ? 0 : msAdpcmBlockSamples(rest, format));
}

/**
 * Decodes MS-ADPCM data to signed 16-bit samples, one array per channel. A trailing fragment too
 * short for a block header is a {@link FormatError}.
 */
export function decodeMsAdpcm(data: Uint8Array, format: MsAdpcmFormat): Int16Array[] {
  const { channels, blockAlign } = format;
  const headerSize = HEADER_BYTES_PER_CHANNEL * channels;
  if (channels < 1 || blockAlign < headerSize) {
    throw new FormatError(`MS-ADPCM block of ${blockAlign} bytes is too small for ${channels} channel(s)`);
  }
  const rest = data.length % blockAlign;
  if (rest !== 0 && rest < headerSize) {
    throw new FormatError(
      `MS-ADPCM data ends with a ${rest}-byte fragment, shorter than a block header`,
      data.length - rest,
    );
  }
  const total = msAdpcmSampleCount(data.length, format);
  const out = Array.from({ length: channels }, () => new Int16Array(total));
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  // Per-channel decoder state, reset by every block header.
  const coefficient1 = new Float64Array(channels);
  const coefficient2 = new Float64Array(channels);
  const delta = new Float64Array(channels);
  const newer = new Float64Array(channels);
  const older = new Float64Array(channels);

  let written = 0;
  for (let start = 0; start < data.length; start += blockAlign) {
    const blockLength = Math.min(blockAlign, data.length - start);
    const samples = msAdpcmBlockSamples(blockLength, format);
    for (let c = 0; c < channels; c++) {
      const predictor = data[start + c] as number;
      const pair = format.coefficients[predictor];
      if (pair === undefined) {
        throw new FormatError(
          `MS-ADPCM predictor ${predictor} is outside the ${format.coefficients.length} coefficient pairs`,
          start + c,
        );
      }
      coefficient1[c] = pair[0];
      coefficient2[c] = pair[1];
      delta[c] = view.getInt16(start + channels + 2 * c, true);
      newer[c] = view.getInt16(start + 3 * channels + 2 * c, true);
      older[c] = view.getInt16(start + 5 * channels + 2 * c, true);
      const target = out[c] as Int16Array;
      target[written] = older[c] as number;
      target[written + 1] = newer[c] as number;
    }

    // Codes alternate between channels; with one channel every nibble belongs to it.
    const codes = (samples - 2) * channels;
    for (let n = 0; n < codes; n++) {
      const byte = data[start + headerSize + (n >> 1)] as number;
      const code = n % 2 === 0 ? byte >> 4 : byte & 0x0f;
      const c = n % channels;
      const signed = code >= 8 ? code - 16 : code;
      const step = delta[c] as number;
      const prediction = Math.trunc(
        ((newer[c] as number) * (coefficient1[c] as number) +
          (older[c] as number) * (coefficient2[c] as number)) /
          256,
      );
      const sample = Math.max(-32768, Math.min(32767, prediction + signed * step));
      older[c] = newer[c] as number;
      newer[c] = sample;
      // Capped like a 32-bit integer, so that pathological input cannot overflow to infinity.
      delta[c] = Math.min(
        MAX_DELTA,
        Math.max(MIN_DELTA, Math.floor(((ADAPTATION[code] as number) * step) / 256)),
      );
      (out[c] as Int16Array)[written + 2 + Math.floor(n / channels)] = sample;
    }
    written += samples;
  }
  return out;
}
