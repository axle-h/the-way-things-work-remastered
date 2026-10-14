/**
 * Corpus test: reads the resources of the original program (`DKCODE/TWTW.EXE`) as data and checks
 * the facts in docs/formats/program.md §Resources. Only counts and structural facts are asserted.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import {
  CURSOR_PIXEL,
  NE_RESOURCE_TYPE,
  decodeDib,
  readBitmapResource,
  readCursorResources,
  readNeResources,
  readPaletteResource,
  type NeResources,
} from '../src/index.ts';
import { describeIfAvailable, discFile, missingDiscFile } from './disc.ts';

const PROGRAM = 'DKCODE/TWTW.EXE';
const SCROLL_BAR_PARTS = [
  'LINEUP',
  'LINEUPALT',
  'LINEDOWN',
  'LINEDOWNALT',
  'THUMB',
  'THUMBALT',
  'THUMBTRACK',
  'THUMBTRACKALT',
];

describeIfAvailable('NE resources corpus (disc)', missingDiscFile(PROGRAM), () => {
  let resources: NeResources;

  beforeAll(() => {
    resources = readNeResources(readFileSync(discFile(PROGRAM) ?? ''), PROGRAM);
  });

  it('lists the resource types and counts in program.md', () => {
    expect(resources.alignShift).toBe(4);
    const counts = Object.fromEntries(resources.types.map(({ type, count }) => [String(type), count]));
    expect(counts).toEqual({
      [NE_RESOURCE_TYPE.groupCursor]: 2,
      [NE_RESOURCE_TYPE.groupIcon]: 1,
      [NE_RESOURCE_TYPE.bitmap]: 37,
      [NE_RESOURCE_TYPE.dialog]: 9,
      [NE_RESOURCE_TYPE.string]: 8,
      [NE_RESOURCE_TYPE.version]: 1,
      PALETTE: 1,
      [NE_RESOURCE_TYPE.icon]: 1,
      [NE_RESOURCE_TYPE.cursor]: 2,
    });
    expect(resources.resources).toHaveLength(62);
    expect(resources.types.every((type) => type.unknown1 === 0)).toBe(true);
    expect(resources.resources.every((r) => r.unknown1 === 0 && r.unknown2 === 0)).toBe(true);
  });

  it('has the 8 named scroll-bar bitmaps and 29 numbered ones, all decodable', () => {
    const bitmaps = resources.ofType(NE_RESOURCE_TYPE.bitmap);
    const named = bitmaps.filter((bitmap) => typeof bitmap.id === 'string').map((bitmap) => bitmap.id);
    expect(named.toSorted()).toEqual(SCROLL_BAR_PARTS.toSorted());
    for (const bitmap of bitmaps) {
      const dib = decodeDib(resources.data(bitmap), `bitmap ${String(bitmap.id)}`);
      expect(dib.fileHeader).toBeUndefined();
      if (dib.rle !== undefined) {
        expect.soft({ id: bitmap.id, end: dib.rle.endOfBitmap, unwritten: dib.rle.unwrittenPixels }).toEqual({
          id: bitmap.id,
          end: true,
          unwritten: 0,
        });
      }
    }
    for (const part of SCROLL_BAR_PARTS) {
      const dib = readBitmapResource(resources, `@${part}`);
      expect(dib.infoHeader.bitCount).toBe(8);
      expect(dib.width).toBe(16);
      expect(readBitmapResource(resources, part.toLowerCase()).indices).toEqual(dib.indices);
    }
  });

  it('reads the PALETTE resource', () => {
    const palette = readPaletteResource(resources);
    expect(palette.version).toBe(0x300);
    expect(palette.flags).toHaveLength(256);
  });

  it('decodes both cursor groups (107 and 157), one 32×32 image each', () => {
    const cursors = readCursorResources(resources);
    expect(cursors.map((cursor) => cursor.id)).toEqual([107, 157]);
    for (const cursor of cursors) {
      expect(cursor.images).toHaveLength(1);
      const [image] = cursor.images;
      if (image === undefined) throw new Error('no image');
      expect([image.width, image.height]).toEqual([32, 32]);
      expect([...image.colors]).toEqual([0, 0, 0, 255, 255, 255]);
      expect(image.hotspotX).toBeLessThan(32);
      expect(image.hotspotY).toBeLessThan(32);
      const used = new Set(image.pixels);
      expect(used.has(CURSOR_PIXEL.black) && used.has(CURSOR_PIXEL.white)).toBe(true);
      expect(used.has(CURSOR_PIXEL.transparent)).toBe(true);
      // The hotspot is on the drawn shape, not on a transparent pixel.
      expect(image.pixels[image.hotspotY * image.width + image.hotspotX]).not.toBe(CURSOR_PIXEL.transparent);
    }
  });
});
