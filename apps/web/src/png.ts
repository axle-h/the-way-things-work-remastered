// Palette PNGs of the engine's indexed pictures, for Copy, Print and "Save picture".
// Pure: the deflate step is the platform's `CompressionStream`, which browsers and Node
// both have, so it runs in the unit tests too. Public PNG specification (ISO/IEC 15948): 8-bit
// palette (colour type 3), no interlacing, filter type 0 on every row.
import type { IndexedImage } from '@twtw/engine';

const SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

/**
 * Enlarges an indexed picture by a whole factor, each pixel becoming a `scale` × `scale` block
 * (nearest neighbour: no new colours, never smoothed).
 */
export function upscaleIndexed(image: IndexedImage, scale: number): IndexedImage {
  if (!Number.isInteger(scale) || scale < 1)
    throw new Error(`scale must be a whole number ≥ 1, got ${scale}`);
  if (scale === 1) return image;
  const width = image.width * scale;
  const height = image.height * scale;
  const pixels = new Uint8Array(width * height);
  const row = new Uint8Array(width);
  for (let y = 0; y < image.height; y++) {
    const source = image.pixels.subarray(y * image.width, (y + 1) * image.width);
    for (let x = 0, at = 0; x < image.width; x++, at += scale) row.fill(source[x]!, at, at + scale);
    for (let copy = 0; copy < scale; copy++) pixels.set(row, (y * scale + copy) * width);
  }
  return { width, height, pixels };
}

/** Whether this platform can encode PNGs with {@link encodeIndexedPng}. */
export const canEncodePng = (): boolean => typeof CompressionStream === 'function';

/** Encodes an indexed picture as a palette PNG with the given 256 RGB triplets. */
export async function encodeIndexedPng(
  image: IndexedImage,
  palette: Uint8Array,
): Promise<Uint8Array<ArrayBuffer>> {
  const { width, height, pixels } = image;
  if (pixels.length !== width * height) {
    throw new Error(`expected ${width * height} pixels for ${width}×${height}, got ${pixels.length}`);
  }
  if (palette.length < 256 * 3) throw new Error(`expected 768 bytes of palette, got ${palette.length}`);
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 3, 0, 0, 0], 8); // bit depth 8, palette, deflate, adaptive filtering, no interlace
  const rows = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y++) rows.set(pixels.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
  return concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('PLTE', palette.subarray(0, 256 * 3)),
    chunk('IDAT', await deflate(rows)),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

/** zlib-wrapped deflate, as IDAT wants it. */
async function deflate(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
  return out;
}

let crcTable: Uint32Array | null = null;

/** CRC-32 (ISO 3309), as the PNG chunks use it. */
export function crc32(bytes: Uint8Array): number {
  if (crcTable === null) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function concat(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
