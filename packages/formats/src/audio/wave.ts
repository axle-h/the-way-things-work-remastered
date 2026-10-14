/**
 * RIFF WAVE files (`*.WAV`), from the public RIFF/WAVE and WAVEFORMATEX documentation. See
 * docs/formats/wav.md. All integers are little-endian.
 */
import { ByteReader, FormatError } from '../reader.ts';
import { decodeMsAdpcm, type MsAdpcmFormat } from './msadpcm.ts';
import { decodePcm, int16ToFloat32 } from './pcm.ts';

/** `wFormatTag` values used here. */
export const WAVE_FORMAT_PCM = 1;
export const WAVE_FORMAT_MS_ADPCM = 2;

/** A WAVEFORMAT / WAVEFORMATEX structure. Also the sound format of PICS animations. */
export interface WaveFormat {
  /** `wFormatTag`: 1 = PCM, 2 = Microsoft ADPCM. */
  readonly formatTag: number;
  readonly channels: number;
  readonly samplesPerSecond: number;
  readonly averageBytesPerSecond: number;
  readonly blockAlign: number;
  readonly bitsPerSample: number;
  /**
   * The format-specific extension after `cbSize` (a view), or `null` for a 16-byte WAVEFORMAT
   * without `cbSize`.
   */
  readonly extension: Uint8Array | null;
}

/** One chunk of a RIFF file. `data` is a view of its body (without the pad byte). */
export interface RiffChunk {
  readonly id: string;
  /** Absolute offset of the chunk header. */
  readonly offset: number;
  readonly size: number;
  readonly data: Uint8Array;
}

export interface WaveFile {
  /** The RIFF size field: bytes after the first 8. */
  readonly riffSize: number;
  /** Every chunk inside the RIFF form, in order, including unknown ones. */
  readonly chunks: readonly RiffChunk[];
  readonly format: WaveFormat;
  /** The MS-ADPCM parameters from the `fmt ` extension, when `formatTag` is 2. */
  readonly adpcm: MsAdpcmFormat | null;
  /** Number of samples per channel from the `fact` chunk, or `null` without one. */
  readonly factSampleCount: number | null;
  /** The `data` chunk body (a view). */
  readonly data: Uint8Array;
  /** Bytes in the input after the RIFF form (0 on the disc). */
  readonly trailingBytes: number;
}

export interface DecodedAudio {
  readonly sampleRate: number;
  /** One array per channel, −1 … 1. */
  readonly channels: readonly Float32Array[];
  /** Samples per channel. */
  readonly length: number;
}

/**
 * Reads a WAVEFORMAT(EX) of `size` bytes. `size` 16 is a plain WAVEFORMAT; 18 or more has
 * `cbSize` followed by that many extension bytes.
 */
export function readWaveFormat(reader: ByteReader, size: number): WaveFormat {
  if (size < 16) throw reader.error(`sound format of ${size} bytes is shorter than WAVEFORMAT (16)`);
  const body = reader.take(size);
  const formatTag = body.u16le();
  const channels = body.u16le();
  const samplesPerSecond = body.u32le();
  const averageBytesPerSecond = body.u32le();
  const blockAlign = body.u16le();
  const bitsPerSample = body.u16le();
  let extension: Uint8Array | null = null;
  if (size >= 18) {
    const extensionSize = body.u16le();
    if (extensionSize > body.remaining) {
      throw body.error(`format extension of ${extensionSize} bytes exceeds the format block`);
    }
    extension = body.bytesView(extensionSize);
  }
  return {
    formatTag,
    channels,
    samplesPerSecond,
    averageBytesPerSecond,
    blockAlign,
    bitsPerSample,
    extension,
  };
}

/** Parses a RIFF WAVE file. The sample data is not decoded; see {@link decodeWave}. */
export function parseWave(bytes: Uint8Array, name = 'WAV'): WaveFile {
  const reader = new ByteReader(bytes, { order: 'le', name });
  if (reader.ascii(4) !== 'RIFF') throw reader.error('not a RIFF file', 0);
  const riffSize = reader.u32le();
  if (riffSize < 4 || riffSize > reader.remaining) {
    throw reader.error(`RIFF size ${riffSize} does not fit the ${bytes.length}-byte input`, 4);
  }
  const form = reader.take(riffSize);
  if (form.ascii(4) !== 'WAVE') throw reader.error('RIFF form is not WAVE', 8);

  const chunks: RiffChunk[] = [];
  while (form.remaining > 0) {
    if (form.remaining < 8) throw form.error(`${form.remaining} stray bytes where a chunk header should be`);
    const offset = form.origin + form.position;
    const id = form.ascii(4);
    const size = form.u32le();
    if (size > form.remaining) {
      throw form.error(`chunk '${id}' of ${size} bytes runs past the end of the RIFF form`, offset);
    }
    chunks.push({ id, offset, size, data: form.bytesView(size) });
    // Chunks are word-aligned; tolerate a missing pad byte after the last one.
    if (size % 2 === 1 && form.remaining > 0) form.skip(1);
  }

  const fmt = chunks.find((chunk) => chunk.id === 'fmt ');
  if (fmt === undefined) throw new FormatError(`${name}: no 'fmt ' chunk`);
  const data = chunks.find((chunk) => chunk.id === 'data');
  if (data === undefined) throw new FormatError(`${name}: no 'data' chunk`);
  const format = readWaveFormat(
    new ByteReader(fmt.data, { order: 'le', name, origin: fmt.offset + 8 }),
    fmt.size,
  );
  const fact = chunks.find((chunk) => chunk.id === 'fact');
  let factSampleCount: number | null = null;
  if (fact !== undefined) {
    factSampleCount = new ByteReader(fact.data, { order: 'le', name, origin: fact.offset + 8 }).u32le();
  }

  if (format.channels < 1) throw new FormatError(`${name}: invalid channel count ${format.channels}`);
  let adpcm: MsAdpcmFormat | null = null;
  if (format.formatTag === WAVE_FORMAT_MS_ADPCM) {
    adpcm = readMsAdpcmExtension(format, name, fmt.offset + 8 + 18);
  } else if (format.formatTag !== WAVE_FORMAT_PCM) {
    throw new FormatError(`${name}: unsupported format tag ${format.formatTag}`, fmt.offset + 8);
  }

  return {
    riffSize,
    chunks,
    format,
    adpcm,
    factSampleCount,
    data: data.data,
    trailingBytes: reader.remaining,
  };
}

/**
 * The MS-ADPCM `fmt ` extension: `u16` samples per block, `u16` number of coefficient pairs, then
 * that many pairs of `i16` (coefficient 1, coefficient 2), scaled by 256.
 */
function readMsAdpcmExtension(format: WaveFormat, name: string, origin: number): MsAdpcmFormat {
  if (format.extension === null) throw new FormatError(`${name}: MS-ADPCM format without an extension`);
  const reader = new ByteReader(format.extension, { order: 'le', name, origin });
  const samplesPerBlock = reader.u16le();
  const coefficientCount = reader.u16le();
  const coefficients: (readonly [number, number])[] = [];
  for (let i = 0; i < coefficientCount; i++) coefficients.push([reader.i16le(), reader.i16le()]);
  if (format.bitsPerSample !== 4) {
    throw new FormatError(`${name}: MS-ADPCM with ${format.bitsPerSample} bits per sample`);
  }
  if (coefficientCount < 1) throw new FormatError(`${name}: MS-ADPCM without coefficients`);
  const headerSize = 7 * format.channels;
  const maxSamplesPerBlock = 2 + Math.floor(((format.blockAlign - headerSize) * 2) / format.channels);
  if (format.blockAlign < headerSize || samplesPerBlock < 2 || samplesPerBlock > maxSamplesPerBlock) {
    throw new FormatError(
      `${name}: MS-ADPCM block of ${format.blockAlign} bytes cannot hold ${samplesPerBlock} samples per channel`,
    );
  }
  return { channels: format.channels, blockAlign: format.blockAlign, samplesPerBlock, coefficients };
}

/**
 * Decodes the sample data to floating point, one array per channel. For MS-ADPCM, a `fact` sample
 * count smaller than the decoded length trims the padding nibble of the last block; a larger one
 * is ignored (the data holds no more samples).
 */
export function decodeWave(wave: WaveFile): DecodedAudio {
  const sampleRate = wave.format.samplesPerSecond;
  if (wave.adpcm !== null) {
    let samples = decodeMsAdpcm(wave.data, wave.adpcm);
    const fact = wave.factSampleCount;
    if (fact !== null && fact < (samples[0]?.length ?? 0)) samples = samples.map((s) => s.subarray(0, fact));
    const channels = samples.map(int16ToFloat32);
    return { sampleRate, channels, length: channels[0]?.length ?? 0 };
  }
  const channels = decodePcm(wave.data, wave.format.channels, wave.format.bitsPerSample);
  return { sampleRate, channels, length: channels[0]?.length ?? 0 };
}
