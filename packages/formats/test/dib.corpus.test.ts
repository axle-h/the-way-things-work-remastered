/**
 * Corpus test: decodes every `.DIB` on the disc and checks the invariants in
 * docs/formats/dib-and-palette.md. Only counts and invariants are asserted; no disc content is
 * stored in the repository.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import {
  ARTWORK_FIRST_INDEX,
  ARTWORK_LAST_INDEX,
  buildMasterPalette,
  decodeDib,
  paletteRangeEquals,
  readNeResources,
  readPaletteResource,
  type Dib,
} from '../src/index.ts';
import { describeIfAvailable, discFile, discFileSet, missingDiscFile } from './disc.ts';

const PROGRAM = 'DKCODE/TWTW.EXE';

function dibPaths(): string[] {
  return [...discFileSet()].filter((path) => path.endsWith('.dib')).sort();
}

function readDisc(path: string): Uint8Array {
  const file = discFile(path) ?? discFile(path.toUpperCase());
  if (file === undefined) throw new Error(`${path} is missing from the disc`);
  return readFileSync(file);
}

describeIfAvailable('DIB corpus (disc)', missingDiscFile(PROGRAM), () => {
  const decoded = new Map<string, Dib>();

  beforeAll(() => {
    for (const path of dibPaths()) decoded.set(path, decodeDib(readDisc(path), path));
  });

  it('decodes all 1,698 DIBs as 8-bit RLE8 with a 256-entry colour table', () => {
    expect(decoded.size).toBe(1698);
    for (const [path, dib] of decoded) {
      const { infoHeader, fileHeader } = dib;
      expect.soft({ path, bits: infoHeader.bitCount, compression: infoHeader.compression }).toEqual({
        path,
        bits: 8,
        compression: 1,
      });
      expect.soft({ path, colors: dib.colorCount, topDown: dib.topDown }).toEqual({
        path,
        colors: 256,
        topDown: false,
      });
      expect.soft({ path, offset: fileHeader?.pixelOffset }).toEqual({ path, offset: 14 + 40 + 256 * 4 });
      expect(dib.indices).toHaveLength(dib.width * dib.height);
    }
  });

  it('consumes every file exactly: the RLE data ends with end-of-bitmap at the declared size', () => {
    for (const [path, dib] of decoded) {
      const bytes = readDisc(path);
      const rle = dib.rle;
      expect.soft({ path, fileSize: dib.fileHeader?.fileSize }).toEqual({ path, fileSize: bytes.length });
      expect
        .soft({
          path,
          imageSize: (dib.fileHeader?.pixelOffset ?? 0) + dib.infoHeader.imageSize,
        })
        .toEqual({ path, imageSize: bytes.length });
      expect
        .soft({ path, endOfBitmap: rle?.endOfBitmap, read: rle?.bytesRead })
        .toEqual({ path, endOfBitmap: true, read: rle?.bytesAvailable });
    }
  });

  it('writes every pixel: no deltas and no short rows', () => {
    const odd = [...decoded]
      .filter(([, dib]) => dib.rle?.unwrittenPixels !== 0 || dib.rle.deltas !== 0)
      .map(([path, dib]) => ({ path, unwritten: dib.rle?.unwrittenPixels, deltas: dib.rle?.deltas }));
    expect(odd).toEqual([]);
  });

  it('shares one colour table, which matches the PALETTE resource in entries 10–245', () => {
    const [first] = decoded.values();
    if (first === undefined) throw new Error('no DIBs');
    const reference = first.palette;
    for (const [path, dib] of decoded) {
      expect.soft({ path, same: paletteRangeEquals(dib.palette, reference, 0, 255) }).toEqual({
        path,
        same: true,
      });
    }
    // Entries 0–9 and 246–255 of the files are black or white placeholders.
    const black = [0, 0, 0];
    const white = [255, 255, 255];
    const placeholder = (index: number): number[] => [...reference.subarray(index * 3, index * 3 + 3)];
    expect(placeholder(0)).toEqual(black);
    for (let index = 1; index <= 9; index++) expect(placeholder(index)).toEqual(white);
    for (let index = 246; index <= 254; index++) expect(placeholder(index)).toEqual(black);
    expect(placeholder(255)).toEqual(white);

    const resource = readPaletteResource(readNeResources(readDisc(PROGRAM), PROGRAM));
    expect(resource.colors).toHaveLength(256 * 3);
    expect(resource.trailingBytes).toBe(12); // padding to the 16-byte resource alignment
    // Reserved entries are PC_EXPLICIT with the system palette index in the low word; the rest
    // are PC_NOCOLLAPSE.
    for (let index = 0; index < 256; index++) {
      const explicit = index < ARTWORK_FIRST_INDEX || index > ARTWORK_LAST_INDEX;
      expect.soft({ index, flags: resource.flags[index] }).toEqual({ index, flags: explicit ? 2 : 4 });
      if (explicit) {
        expect
          .soft({ index, low: resource.colors[index * 3], high: resource.colors[index * 3 + 1] })
          .toEqual({
            index,
            low: index,
            high: 0,
          });
      }
    }
    expect(paletteRangeEquals(resource.colors, reference, ARTWORK_FIRST_INDEX, ARTWORK_LAST_INDEX)).toBe(
      true,
    );
    expect(buildMasterPalette(resource.colors)).toEqual(buildMasterPalette(reference));
  });
});
