/**
 * Corpus test: parses every PICS animation (`*.ANI`) on the disc and unpacks every image,
 * checking the structural invariants in docs/formats/pics.md. Only counts and invariants are
 * asserted; no disc content is stored in the repository.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import {
  FormatError,
  parsePics,
  picsDuration,
  picsFrameTimes,
  picsStride,
  unpackPicsImage,
  unpackPicsRuns,
  type PicsFile,
} from '../src/index.ts';
import { describeIfAvailable, discFile, discFileSet, missingDiscFile } from './disc.ts';

/** The two files with damaged headers, never referenced by the page database. */
const DAMAGED = ['principl/qlvr/qlvr0m0a.ani', 'principl/qlvr/qlvr.ani'];

describeIfAvailable('PICS animations corpus (disc)', missingDiscFile('TITLE/TITL0M0A.ANI'), () => {
  let paths: string[];
  const parsed = new Map<string, PicsFile>();
  const failures = new Map<string, unknown>();
  const read = (path: string): Uint8Array => readFileSync(discFile(path.toUpperCase()) ?? '');

  beforeAll(() => {
    paths = [...discFileSet()].filter((path) => path.endsWith('.ani')).sort();
    for (const path of paths) {
      try {
        parsed.set(path, parsePics(read(path), path));
      } catch (error) {
        failures.set(path, error);
      }
    }
  });

  it('parses 495 of the 497 files; the two damaged ones fail with a FormatError', () => {
    expect(paths).toHaveLength(497);
    expect([...failures.keys()].sort()).toEqual([...DAMAGED].sort());
    for (const error of failures.values()) expect(error).toBeInstanceOf(FormatError);
    expect(parsed.size).toBe(495);
  });

  it('consumes every file exactly, with the header values in the spec', () => {
    let chunks = 0;
    let preRoll = 0;
    for (const pics of parsed.values()) {
      expect(pics.trailingBytes).toBe(0);
      expect(pics.header.formatMarker).toBe(1);
      expect(pics.header.soundFormatSize).toBe(16);
      expect(pics.header.soundFormat).toEqual({
        formatTag: 1,
        channels: 1,
        samplesPerSecond: 22050,
        averageBytesPerSecond: 22050,
        blockAlign: 1,
        bitsPerSample: 8,
        extension: null,
      });
      for (const chunk of pics.chunks) {
        expect(chunk.type).toBe(1);
        if (chunk.unpackedSize === 0) expect(chunk.packedSize).toBe(0);
      }
      for (const chunk of pics.preRoll) expect(chunk.unpackedSize).toBe(0);
      chunks += pics.chunks.length;
      preRoll += pics.preRoll.length;
    }
    expect(chunks).toBe(22215);
    expect(preRoll).toBe(3878);
  });

  it('unpacks every image to its declared size, consuming the packed bytes exactly but for 11', () => {
    let images = 0;
    const overlong: number[] = [];
    for (const pics of parsed.values()) {
      for (const chunk of pics.chunks) {
        const image = unpackPicsImage(chunk);
        if (image === null) continue;
        images++;
        expect(image.indices.length).toBe(chunk.unpackedSize);
        expect(image.stride * image.height).toBe(chunk.unpackedSize);
        expect(image.stride).toBe(picsStride(image.width));
        const { consumed } = unpackPicsRuns(chunk.packed, chunk.unpackedSize);
        if (consumed !== chunk.packedSize) {
          // A superfluous one-byte literal after the complete image.
          overlong.push(chunk.packedSize - consumed);
          expect(chunk.packed[consumed]).toBe(0x81);
        }
      }
    }
    expect(images).toBe(14132);
    expect(overlong).toEqual(new Array(11).fill(2));
  });

  it('gives strictly increasing frame times within the soundtrack [H]', () => {
    for (const pics of parsed.values()) {
      const times = picsFrameTimes(pics);
      for (let k = 1; k < times.length; k++) expect(times[k]).toBeGreaterThan(times[k - 1] ?? 0);
      expect(times.at(-1)).toBeLessThanOrEqual(picsDuration(pics));
    }
  });
});
