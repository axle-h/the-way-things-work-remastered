/**
 * Builds synthetic DIBs for tests (the repository holds no disc bytes), in the public layout
 * described in docs/formats/dib-and-palette.md.
 */
import { ByteWriter } from '../writer.ts';

export interface DibSpec {
  readonly width: number;
  /** Stored height: negative for top-down rows. */
  readonly height: number;
  readonly bitCount?: number;
  /** 0 = `BI_RGB`, 1 = `BI_RLE8`. */
  readonly compression?: number;
  /** RGB triplets; its length decides `biClrUsed` unless `colorsUsed` is given. */
  readonly palette: ArrayLike<number>;
  readonly colorsUsed?: number;
  /** The pixel data exactly as stored (padded rows, or RLE8 codes). */
  readonly pixelData: ArrayLike<number>;
  /** Writes a `BITMAPFILEHEADER` first (default true); resources have none. */
  readonly fileHeader?: boolean;
  /** Overrides `biSizeImage` (default: the pixel data length). */
  readonly imageSize?: number;
}

export function buildDib(spec: DibSpec): Uint8Array {
  const colorCount = spec.palette.length / 3;
  const infoHeaderSize = 40;
  const pixelOffset = (spec.fileHeader === false ? 0 : 14) + infoHeaderSize + colorCount * 4;
  const writer = new ByteWriter('le');
  if (spec.fileHeader !== false) {
    writer
      .u16(0x4d42)
      .u32(pixelOffset + spec.pixelData.length)
      .u16(0)
      .u16(0)
      .u32(pixelOffset);
  }
  writer
    .u32(infoHeaderSize)
    .i32(spec.width)
    .i32(spec.height)
    .u16(1)
    .u16(spec.bitCount ?? 8)
    .u32(spec.compression ?? 0)
    .u32(spec.imageSize ?? spec.pixelData.length)
    .i32(2835)
    .i32(2835)
    .u32(spec.colorsUsed ?? colorCount)
    .u32(0);
  for (let i = 0; i < colorCount; i++) {
    writer.u8(spec.palette[i * 3 + 2] ?? 0);
    writer.u8(spec.palette[i * 3 + 1] ?? 0);
    writer.u8(spec.palette[i * 3] ?? 0);
    writer.u8(0);
  }
  return writer.bytes(spec.pixelData).toBytes();
}
