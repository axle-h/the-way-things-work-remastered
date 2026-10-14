/**
 * DK "PICS" animations (`*.ANI`): 8-bit PCM interleaved with packed image rectangles. See
 * docs/formats/pics.md. All integers are little-endian.
 *
 * {@link parsePics} reads the header and the chunk table eagerly; sound and packed images stay
 * views into the input, and images are unpacked on demand (`unpackPicsImage`). For streaming,
 * {@link parsePicsHeader} and {@link parsePicsChunk} read the same structures one at a time.
 */
import { readWaveFormat, type WaveFormat } from '../audio/wave.ts';
import type { Rect } from '../pagedb/model.ts';
import { ByteReader } from '../reader.ts';

/** Bytes before the sound format: marker, frame count, pre-roll factors, format size. */
const FIXED_HEADER_SIZE = 14;
/** Bytes of a chunk header, before its sound and packed image. */
export const PICS_CHUNK_HEADER_SIZE = 28;
/** The constant filler at chunk offset 22. */
export const PICS_CHUNK_FILLER = 'funky!';

export interface PicsHeader {
  /** Always 1 on the disc. */
  readonly formatMarker: number;
  /** Number of frame chunks after the pre-roll. */
  readonly frameCount: number;
  readonly preRollFactorA: number;
  readonly preRollFactorB: number;
  /** Number of pre-roll chunks: A × B. */
  readonly preRollCount: number;
  /** Size of the sound format block (16 on the disc). */
  readonly soundFormatSize: number;
  /** PCM, mono, 22,050 Hz, 8-bit unsigned on the disc. */
  readonly soundFormat: WaveFormat;
  /** Offset of the first chunk. */
  readonly byteLength: number;
}

export interface PicsChunk {
  /** Position among all chunks, pre-roll included, from 0. */
  readonly index: number;
  /** Absolute offset of the chunk header. */
  readonly offset: number;
  /** Header, sound and packed image. */
  readonly byteLength: number;
  /** Always 1 on the disc. */
  readonly type: number;
  /** Sound byte count `s` (the length of {@link sound}). */
  readonly soundByteCount: number;
  /** Where the image goes, in picture coordinates; right and bottom are exclusive. */
  readonly rect: Rect;
  /** Size of the unpacked image; 0 when this chunk has no new image. */
  readonly unpackedSize: number;
  /** Packed image byte count `p` (the length of {@link packed}). */
  readonly packedSize: number;
  /** Always {@link PICS_CHUNK_FILLER}. */
  readonly filler: string;
  /** PCM in the header's sound format (a view). */
  readonly sound: Uint8Array;
  /** The packed image (a view). */
  readonly packed: Uint8Array;
}

export interface PicsFile {
  readonly header: PicsHeader;
  /** All chunks in file order: the pre-roll chunks, then the frame chunks. */
  readonly chunks: readonly PicsChunk[];
  /** The first `preRollCount` chunks; they carry sound only. */
  readonly preRoll: readonly PicsChunk[];
  /** The `frameCount` chunks after the pre-roll. */
  readonly frames: readonly PicsChunk[];
  /** Bytes after the last chunk (0 on the disc). */
  readonly trailingBytes: number;
}

/** Reads the header and sound format at the start of `bytes`. */
export function parsePicsHeader(bytes: Uint8Array, name = 'PICS'): PicsHeader {
  const reader = new ByteReader(bytes, { order: 'le', name });
  const formatMarker = reader.u16();
  if (formatMarker !== 1) throw reader.error(`format marker is ${formatMarker}, expected 1`, 0);
  const frameCount = reader.u32();
  const preRollFactorA = reader.u16();
  const preRollFactorB = reader.u16();
  const soundFormatSize = reader.u32();
  const soundFormat = readWaveFormat(reader, soundFormatSize);
  if (reader.position !== FIXED_HEADER_SIZE + soundFormatSize) throw reader.error('sound format misread');
  if (soundFormat.formatTag !== 1 || soundFormat.averageBytesPerSecond === 0) {
    throw reader.error(`sound format tag ${soundFormat.formatTag} is not usable PCM`, FIXED_HEADER_SIZE);
  }
  return {
    formatMarker,
    frameCount,
    preRollFactorA,
    preRollFactorB,
    preRollCount: preRollFactorA * preRollFactorB,
    soundFormatSize,
    soundFormat,
    byteLength: reader.position,
  };
}

/** Reads the chunk at `offset`, which is chunk number `index` (counting the pre-roll). */
export function parsePicsChunk(bytes: Uint8Array, offset: number, index: number, name = 'PICS'): PicsChunk {
  const reader = new ByteReader(bytes, { order: 'le', name }).seek(offset);
  const type = reader.u16();
  const soundByteCount = reader.u32();
  const rect: Rect = { left: reader.i16(), top: reader.i16(), right: reader.i16(), bottom: reader.i16() };
  const unpackedSize = reader.u32();
  const packedSize = reader.u32();
  const filler = reader.ascii(PICS_CHUNK_FILLER.length);
  if (filler !== PICS_CHUNK_FILLER) {
    throw reader.error(`chunk ${index} has no '${PICS_CHUNK_FILLER}' filler (damaged header?)`, offset);
  }
  if (unpackedSize !== 0) {
    const width = rect.right - rect.left;
    const height = rect.bottom - rect.top;
    const expected = width > 0 && height > 0 ? picsStride(width) * height : -1;
    if (expected !== unpackedSize) {
      throw reader.error(
        `chunk ${index}: unpacked size ${unpackedSize} does not match its ${width}×${height} rectangle`,
        offset,
      );
    }
  }
  const sound = reader.bytesView(soundByteCount);
  const packed = reader.bytesView(packedSize);
  return {
    index,
    offset,
    byteLength: reader.position - offset,
    type,
    soundByteCount,
    rect,
    unpackedSize,
    packedSize,
    filler,
    sound,
    packed,
  };
}

/** Parses a whole PICS file: header and chunk table. Images are not unpacked. */
export function parsePics(bytes: Uint8Array, name = 'PICS'): PicsFile {
  const header = parsePicsHeader(bytes, name);
  const total = header.preRollCount + header.frameCount;
  const chunks: PicsChunk[] = [];
  let offset = header.byteLength;
  for (let index = 0; index < total; index++) {
    const chunk = parsePicsChunk(bytes, offset, index, name);
    chunks.push(chunk);
    offset += chunk.byteLength;
  }
  return {
    header,
    chunks,
    preRoll: chunks.slice(0, header.preRollCount),
    frames: chunks.slice(header.preRollCount),
    trailingBytes: bytes.length - offset,
  };
}

/** Bytes per unpacked image row: the width rounded up to even. */
export function picsStride(width: number): number {
  return (width + 1) & ~1;
}

/** The whole soundtrack: every chunk's PCM concatenated in order, pre-roll included. */
export function picsSoundtrack(file: PicsFile): Uint8Array {
  const out = new Uint8Array(file.chunks.reduce((sum, chunk) => sum + chunk.sound.length, 0));
  let at = 0;
  for (const chunk of file.chunks) {
    out.set(chunk.sound, at);
    at += chunk.sound.length;
  }
  return out;
}

/**
 * When each frame chunk becomes visible, in seconds from the start of the soundtrack.
 *
 * Hypothesis [H] (docs/formats/pics.md, "Sound and timing"; fits every file but not confirmed):
 * frame chunk `k` appears when the PCM of chunk `k` (counting from the first pre-roll chunk)
 * starts playing, so each picture leads the sound stored with it by the pre-roll.
 */
export function picsFrameTimes(file: PicsFile): number[] {
  const bytesPerSecond = file.header.soundFormat.averageBytesPerSecond;
  const times: number[] = [];
  let soundBytes = 0;
  for (let k = 0; k < file.frames.length; k++) {
    times.push(soundBytes / bytesPerSecond);
    soundBytes += file.chunks[k]?.sound.length ?? 0;
  }
  return times;
}

/** Length of the soundtrack in seconds. */
export function picsDuration(file: PicsFile): number {
  const bytes = file.chunks.reduce((sum, chunk) => sum + chunk.sound.length, 0);
  return bytes / file.header.soundFormat.averageBytesPerSecond;
}
