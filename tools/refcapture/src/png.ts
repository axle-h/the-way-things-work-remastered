// Minimal PNG encoding and decoding for 8-bit RGB captures (the PNG specification, no dependencies).
import { crc32, deflateSync, inflateSync } from 'node:zlib';

const SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

/** Encodes `width × height` pixels of packed RGB (3 bytes per pixel, rows top to bottom). */
export function encodePng(width: number, height: number, rgb: Uint8Array): Uint8Array {
  const stride = width * 3;
  if (rgb.length !== stride * height) {
    throw new Error(`expected ${stride * height} bytes of RGB for ${width}×${height}, got ${rgb.length}`);
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 2, 0, 0, 0], 8); // bit depth 8, colour type 2 (RGB), deflate, filter 0, no interlace
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) raw.set(rgb.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  return concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array()),
  ]);
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export interface RgbImage {
  readonly width: number;
  readonly height: number;
  /** Packed RGB, 3 bytes per pixel, rows top to bottom. */
  readonly rgb: Uint8Array;
}

/** Decodes an 8-bit, non-interlaced RGB or RGBA PNG (alpha is dropped). */
export function decodePng(bytes: Uint8Array): RgbImage {
  if (!SIGNATURE.every((value, i) => bytes[i] === value)) throw new Error('not a PNG file');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  let channels = 0;
  const data: Uint8Array[] = [];
  for (let offset = 8; offset + 8 <= bytes.length;) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      const [depth, colourType, , , interlace] = body.subarray(8, 13);
      channels = colourType === 2 ? 3 : colourType === 6 ? 4 : 0;
      if (depth !== 8 || channels === 0 || interlace !== 0) {
        throw new Error(`unsupported PNG: depth ${depth}, colour type ${colourType}, interlace ${interlace}`);
      }
    } else if (type === 'IDAT') {
      data.push(body);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  const raw = inflateSync(concat(data));
  const stride = width * channels;
  const pixels = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    const up = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : new Uint8Array(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? out[i - channels]! : 0;
      const b = up[i]!;
      const c = i >= channels ? up[i - channels]! : 0;
      let predictor: number;
      switch (filter) {
        case 0:
          predictor = 0;
          break;
        case 1:
          predictor = a;
          break;
        case 2:
          predictor = b;
          break;
        case 3:
          predictor = (a + b) >> 1;
          break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          break;
        }
        default:
          throw new Error(`bad PNG filter ${filter} on row ${y}`);
      }
      out[i] = (line[i]! + predictor) & 0xff;
    }
  }
  if (channels === 3) return { width, height, rgb: pixels };
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0, j = 0; i < pixels.length; i += 4, j += 3) rgb.set(pixels.subarray(i, i + 3), j);
  return { width, height, rgb };
}
