/**
 * Decoder for Windows device-independent bitmaps, implemented from docs/formats/dib-and-palette.md
 * and the public BMP/DIB documentation.
 *
 * Accepts a `.DIB`/`.BMP` file (`BITMAPFILEHEADER` first) or a headerless DIB (`BITMAPINFOHEADER`
 * first), which is how NE `RT_BITMAP` resources are stored. Supported pixel formats: 8-bit `BI_RLE8`
 * and uncompressed (`BI_RGB`) 1-, 4- and 8-bit. The output is always one palette index per pixel,
 * top-down, with no row padding.
 */
import { ByteReader } from '../reader.ts';

/** `biCompression` values. */
export const DIB_COMPRESSION = { rgb: 0, rle8: 1, rle4: 2, bitfields: 3 } as const;

const INFO_HEADER_SIZE = 40;
/** `BM`, little-endian. */
const FILE_SIGNATURE = 0x4d42;

/** `BITMAPFILEHEADER`, present only in `.DIB`/`.BMP` files. */
export interface DibFileHeader {
  /** `bfSize`: declared file size. */
  readonly fileSize: number;
  /** `bfReserved1`. */
  readonly unknown1: number;
  /** `bfReserved2`. */
  readonly unknown2: number;
  /** `bfOffBits`: offset of the pixel data from the start of the file. */
  readonly pixelOffset: number;
}

/** `BITMAPINFOHEADER`, with the raw signed height. */
export interface DibInfoHeader {
  /** `biSize`: 40, or more for the later header versions (the extra fields are skipped). */
  readonly headerSize: number;
  readonly width: number;
  /** `biHeight` as stored: positive for bottom-up rows, negative for top-down. */
  readonly height: number;
  readonly planes: number;
  readonly bitCount: number;
  /** `biCompression`, see {@link DIB_COMPRESSION}. */
  readonly compression: number;
  /** `biSizeImage`: byte length of the pixel data (may be 0 for `BI_RGB`). */
  readonly imageSize: number;
  readonly xPixelsPerMeter: number;
  readonly yPixelsPerMeter: number;
  /** `biClrUsed`: number of colour-table entries, 0 meaning `2^bitCount`. */
  readonly colorsUsed: number;
  readonly colorsImportant: number;
}

/** What an RLE8 decode did, for checking that a file is consumed exactly. */
export interface RleStats {
  /** Bytes of pixel data read, up to and including the end-of-bitmap escape. */
  readonly bytesRead: number;
  /** Bytes of pixel data available (`biSizeImage`, or up to the end of the input). */
  readonly bytesAvailable: number;
  /** Whether the data ended with an end-of-bitmap escape (rather than running out). */
  readonly endOfBitmap: boolean;
  /** Pixels never written (skipped by a delta or end-of-line, or left after an early end). */
  readonly unwrittenPixels: number;
  /** Number of delta escapes. */
  readonly deltas: number;
}

export interface Dib {
  readonly width: number;
  /** Always positive. */
  readonly height: number;
  /** Whether the rows were stored top-down (negative `biHeight`). */
  readonly topDown: boolean;
  /**
   * One palette index per pixel, `width * height`, top-down, no padding. Pixels an RLE8 bitmap
   * never writes are 0 (see {@link RleStats.unwrittenPixels}).
   */
  readonly indices: Uint8Array;
  /** The colour table as RGB triplets: `3 * colorCount` bytes. */
  readonly palette: Uint8Array;
  /** The fourth (`rgbReserved`) byte of each colour-table entry. */
  readonly paletteReserved: Uint8Array;
  readonly colorCount: number;
  readonly fileHeader: DibFileHeader | undefined;
  readonly infoHeader: DibInfoHeader;
  /** Present for `BI_RLE8` bitmaps. */
  readonly rle: RleStats | undefined;
}

/** Decodes a DIB file or headerless DIB. Throws `FormatError` if it is malformed or unsupported. */
export function decodeDib(bytes: Uint8Array, name = 'DIB'): Dib {
  const reader = new ByteReader(bytes, { order: 'le', name });
  let fileHeader: DibFileHeader | undefined;
  if (bytes.length >= 2 && reader.slice(0, 2).u16() === FILE_SIGNATURE) {
    reader.skip(2);
    fileHeader = {
      fileSize: reader.u32(),
      unknown1: reader.u16(),
      unknown2: reader.u16(),
      pixelOffset: reader.u32(),
    };
  }
  const base = reader.position;
  const info = readInfoHeader(reader);
  const { width, bitCount, compression } = info;
  if (width <= 0 || info.height === 0 || info.height === -0x80000000) {
    throw reader.error(`invalid size ${width}×${info.height}`, base + 4);
  }
  if (info.planes !== 1) throw reader.error(`unsupported plane count ${info.planes}`, base + 12);
  if (bitCount !== 1 && bitCount !== 4 && bitCount !== 8) {
    throw reader.error(`unsupported bit count ${bitCount}; only 1, 4 and 8 are supported`, base + 14);
  }
  const rle = compression === DIB_COMPRESSION.rle8;
  if (compression !== DIB_COMPRESSION.rgb && !(rle && bitCount === 8)) {
    throw reader.error(`unsupported compression ${compression} for ${bitCount}-bit pixels`, base + 16);
  }
  const topDown = info.height < 0;
  if (topDown && rle) throw reader.error('a compressed bitmap cannot be top-down', base + 8);
  const height = Math.abs(info.height);

  const maxColors = 1 << bitCount;
  const colorCount = info.colorsUsed === 0 ? maxColors : info.colorsUsed;
  if (colorCount > maxColors) {
    throw reader.error(`${colorCount} colours is too many for ${bitCount}-bit pixels`, base + 32);
  }
  reader.seek(base + info.headerSize);
  const palette = new Uint8Array(colorCount * 3);
  const paletteReserved = new Uint8Array(colorCount);
  for (let i = 0; i < colorCount; i++) {
    // RGBQUAD is stored blue, green, red, reserved.
    palette[i * 3 + 2] = reader.u8();
    palette[i * 3 + 1] = reader.u8();
    palette[i * 3] = reader.u8();
    paletteReserved[i] = reader.u8();
  }

  const pixelStart = fileHeader === undefined ? reader.position : fileHeader.pixelOffset;
  if (pixelStart < reader.position || pixelStart > bytes.length) {
    throw reader.error(`pixel data offset ${pixelStart} is outside the file`, 10);
  }
  const indices = new Uint8Array(width * height);
  let stats: RleStats | undefined;
  if (rle) {
    const available = info.imageSize === 0 ? bytes.length - pixelStart : info.imageSize;
    if (available > bytes.length - pixelStart) {
      throw reader.error(
        `pixel data of ${available} bytes at ${pixelStart} runs past the end (length ${bytes.length})`,
        base + 20,
      );
    }
    stats = decodeRle8(reader.slice(pixelStart, available), width, height, indices);
  } else {
    const stride = Math.ceil((width * bitCount) / 32) * 4;
    const data = reader.slice(pixelStart, Math.min(stride * height, bytes.length - pixelStart));
    if (data.length < stride * height) {
      throw data.error(`pixel data needs ${stride * height} bytes; only ${data.length} present`);
    }
    unpackRows(data.bytes, width, height, bitCount, stride, topDown, indices);
  }
  return {
    width,
    height,
    topDown,
    indices,
    palette,
    paletteReserved,
    colorCount,
    fileHeader,
    infoHeader: info,
    rle: stats,
  };
}

/** Reads a `BITMAPINFOHEADER` and checks its size field. Exported for cursors and icons. */
export function readInfoHeader(reader: ByteReader): DibInfoHeader {
  const at = reader.position;
  const headerSize = reader.u32();
  if (headerSize < INFO_HEADER_SIZE) {
    const kind = headerSize === 12 ? ' (OS/2 BITMAPCOREHEADER is not supported)' : '';
    throw reader.error(`unsupported bitmap header size ${headerSize}${kind}`, reader.origin + at);
  }
  return {
    headerSize,
    width: reader.i32(),
    height: reader.i32(),
    planes: reader.u16(),
    bitCount: reader.u16(),
    compression: reader.u32(),
    imageSize: reader.u32(),
    xPixelsPerMeter: reader.i32(),
    yPixelsPerMeter: reader.i32(),
    colorsUsed: reader.u32(),
    colorsImportant: reader.u32(),
  };
}

/**
 * Unpacks uncompressed rows of 1, 4 or 8 bits per pixel (most significant bits first) into
 * top-down indices.
 */
export function unpackRows(
  data: Uint8Array,
  width: number,
  height: number,
  bitCount: number,
  stride: number,
  topDown: boolean,
  out: Uint8Array,
): void {
  const perByte = 8 / bitCount;
  const mask = (1 << bitCount) - 1;
  for (let row = 0; row < height; row++) {
    const y = topDown ? row : height - 1 - row;
    const src = row * stride;
    const dst = y * width;
    if (bitCount === 8) {
      out.set(data.subarray(src, src + width), dst);
      continue;
    }
    for (let x = 0; x < width; x++) {
      const byte = data[src + Math.floor(x / perByte)] ?? 0;
      const shift = 8 - bitCount * ((x % perByte) + 1);
      out[dst + x] = (byte >> shift) & mask;
    }
  }
}

/**
 * Decodes `BI_RLE8` data into top-down `out`. Rows are stored bottom-up, so stored row 0 is the
 * last output row. Stops at end-of-bitmap, or when the data runs out between instructions.
 */
function decodeRle8(data: ByteReader, width: number, height: number, out: Uint8Array): RleStats {
  let x = 0;
  let row = 0; // stored (bottom-up) row
  let written = 0;
  let deltas = 0;
  let endOfBitmap = false;
  const put = (count: number, at: number): number => {
    if (row >= height || x + count > width) {
      throw data.error(
        `run of ${count} pixel${count === 1 ? '' : 's'} at x=${x}, row ${row} overflows the ${width}×${height} bitmap`,
        data.origin + at,
      );
    }
    written += count;
    return (height - 1 - row) * width + x;
  };
  while (!data.atEnd) {
    const at = data.position;
    const count = data.u8();
    const value = data.u8();
    if (count > 0) {
      const start = put(count, at);
      out.fill(value, start, start + count);
      x += count;
    } else if (value === 0) {
      x = 0;
      row++;
    } else if (value === 1) {
      endOfBitmap = true;
      break;
    } else if (value === 2) {
      x += data.u8();
      row += data.u8();
      deltas++;
    } else {
      const start = put(value, at);
      out.set(data.bytesView(value), start);
      x += value;
      if (value % 2 === 1) data.skip(1);
    }
  }
  return {
    bytesRead: data.position,
    bytesAvailable: data.length,
    endOfBitmap,
    unwrittenPixels: width * height - written,
    deltas,
  };
}
