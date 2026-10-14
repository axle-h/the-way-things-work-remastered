/**
 * Minimal PNG writing and reading (public PNG specification, ISO/IEC 15948), for looking at
 * rendered frames and comparing them with reference captures. Only what the tools need: 8-bit
 * samples, no interlacing.
 */
import { crc32, deflateSync, inflateSync } from 'node:zlib';
import type { IndexedImage } from '@twtw/engine';

const SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

/** Encodes an indexed image as a palette PNG (colour type 3) with the given 256-entry RGB palette. */
export function encodeIndexedPng(image: IndexedImage, palette: Uint8Array): Uint8Array {
  const { width, height, pixels } = image;
  return concat([
    SIGNATURE,
    chunk('IHDR', imageHeader(width, height, 3)),
    chunk('PLTE', palette.subarray(0, 256 * 3)),
    chunk('IDAT', deflateSync(unfilteredRows(pixels, width, height))),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

/** Encodes an RGB image as a truecolour PNG (colour type 2). */
export function encodeRgbPng(image: RgbImage): Uint8Array {
  const { width, height, rgb } = image;
  if (rgb.length !== width * height * 3) {
    throw new Error(`expected ${width * height * 3} bytes of RGB for ${width}×${height}, got ${rgb.length}`);
  }
  return concat([
    SIGNATURE,
    chunk('IHDR', imageHeader(width, height, 2)),
    chunk('IDAT', deflateSync(unfilteredRows(rgb, width * 3, height))),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

/** IHDR: bit depth 8, the colour type, deflate, adaptive filtering, no interlace. */
function imageHeader(width: number, height: number, colourType: 2 | 3): Uint8Array {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, colourType, 0, 0, 0], 8);
  return header;
}

/** The samples with filter type 0 (none) in front of every row. */
function unfilteredRows(samples: Uint8Array, stride: number, height: number): Uint8Array {
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++)
    raw.set(samples.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  return raw;
}

/** An image as RGB triplets, row by row from the top. */
export interface RgbImage {
  readonly width: number;
  readonly height: number;
  /** `3 * width * height` bytes. */
  readonly rgb: Uint8Array;
}

/** Converts an indexed image to RGB through a palette of RGB triplets. */
export function indexedToRgb(image: IndexedImage, palette: Uint8Array): RgbImage {
  const rgb = new Uint8Array(image.pixels.length * 3);
  image.pixels.forEach((index, i) => {
    rgb[i * 3] = palette[index * 3]!;
    rgb[i * 3 + 1] = palette[index * 3 + 1]!;
    rgb[i * 3 + 2] = palette[index * 3 + 2]!;
  });
  return { width: image.width, height: image.height, rgb };
}

/** Decodes an 8-bit, non-interlaced PNG (greyscale, RGB, palette, with or without alpha) to RGB. */
export function decodePng(bytes: Uint8Array): RgbImage {
  if (bytes.length < 8 || !SIGNATURE.every((value, i) => bytes[i] === value))
    throw new Error('PNG: bad signature');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  let colourType = -1;
  let palette = new Uint8Array(0);
  const data: Uint8Array[] = [];
  for (let at = 8; at + 8 <= bytes.length;) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const body = bytes.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      const [depth, colour, , , interlace] = body.subarray(8);
      if (depth !== 8 || interlace !== 0) throw new Error(`PNG: unsupported bit depth ${depth} or interlace`);
      colourType = colour ?? -1;
    } else if (type === 'PLTE') {
      palette = body.slice();
    } else if (type === 'IDAT') {
      data.push(body);
    } else if (type === 'IEND') {
      break;
    }
    at += 12 + length;
  }
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colourType];
  if (channels === undefined) throw new Error(`PNG: unsupported colour type ${colourType}`);
  const raw = inflateSync(concat(data));
  const stride = width * channels;
  const samples = new Uint8Array(stride * height);
  unfilter(raw, samples, stride, channels, height);

  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    const s = i * channels;
    if (colourType === 3) {
      rgb.set(palette.subarray(samples[s]! * 3, samples[s]! * 3 + 3), i * 3);
    } else if (colourType === 0 || colourType === 4) {
      rgb.fill(samples[s]!, i * 3, i * 3 + 3);
    } else {
      rgb.set(samples.subarray(s, s + 3), i * 3);
    }
  }
  return { width, height, rgb };
}

/** Undoes the per-row PNG filters (none, sub, up, average, Paeth). */
function unfilter(raw: Uint8Array, out: Uint8Array, stride: number, bpp: number, height: number): void {
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[row + x - bpp]! : 0;
      const b = y > 0 ? out[row - stride + x]! : 0;
      const c = x >= bpp && y > 0 ? out[row - stride + x - bpp]! : 0;
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
          throw new Error(`PNG: bad filter type ${String(filter)} on row ${y}`);
      }
      out[row + x] = (line[x]! + predictor) & 0xff;
    }
  }
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

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
