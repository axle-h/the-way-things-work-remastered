/**
 * Independent comparison (docs/PLAN.md §5.3): our DIB decoder against Pillow, a public decoder,
 * on every `.DIB` on the disc and every bitmap resource in `TWTW.EXE`. Resources are headerless, so
 * they are given a `BITMAPFILEHEADER` before Pillow sees them. Only hashes of the outputs are
 * compared. Skips when the disc, `python3` or Pillow is absent.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { ByteWriter } from '../src/testing/index.ts';
import { decodeDib, NE_RESOURCE_TYPE, readNeResources, type Dib } from '../src/index.ts';
import { describeIfAvailable, discFile, discFileSet, missingDiscFile } from './disc.ts';

const PROGRAM = 'DKCODE/TWTW.EXE';

// Reads one item per line (a file path, or `b64:` and the file's bytes) and prints one line per
// item: the image mode, size, and SHA-256 of the pixel indices (top-down) and of the palette.
const PILLOW_SCRIPT = `
import base64, hashlib, io, sys
from PIL import Image
for line in sys.stdin:
    line = line.rstrip('\\n')
    source = io.BytesIO(base64.b64decode(line[4:])) if line.startswith('b64:') else line
    with Image.open(source) as image:
        image.load()
        mode, pixels, palette = image.mode, image.tobytes(), bytes(image.getpalette() or [])
        if mode == '1':
            # Pillow opens a black-and-white 1-bit bitmap as mode 1 (pixels 0 and 255).
            mode, pixels, palette = 'P', bytes(1 if v else 0 for v in image.getdata()), bytes([0, 0, 0, 255, 255, 255])
        print(mode, image.width, image.height,
              hashlib.sha256(pixels).hexdigest(), hashlib.sha256(palette).hexdigest())
`;

function pillowMissing(): string | null {
  const probe = spawnSync('python3', ['-I', '-c', 'import PIL'], { encoding: 'utf8' });
  return probe.status === 0 ? null : 'python3 with Pillow is not available';
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** What Pillow should report for one of our decodes. */
function expected(dib: Dib): string {
  // Pillow reports exactly the colours in the table, as we do.
  return ['P', dib.width, dib.height, sha256(dib.indices), sha256(dib.palette)].join(' ');
}

function runPillow(items: readonly string[]): string[] {
  const result = spawnSync('python3', ['-I', '-c', PILLOW_SCRIPT], {
    input: items.join('\n') + '\n',
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`Pillow failed: ${result.stderr}`);
  return result.stdout.trimEnd().split('\n');
}

/** A headerless DIB with a `BITMAPFILEHEADER` in front, as a `.BMP` file. */
function withFileHeader(dib: Dib, bytes: Uint8Array): Uint8Array {
  const pixelOffset = 14 + dib.infoHeader.headerSize + dib.colorCount * 4;
  const writer = new ByteWriter('le')
    .u16(0x4d42)
    .u32(14 + bytes.length)
    .u16(0)
    .u16(0)
    .u32(pixelOffset);
  return writer.bytes(bytes).toBytes();
}

describeIfAvailable('DIB decoder against Pillow (disc)', missingDiscFile(PROGRAM) ?? pillowMissing(), () => {
  it('matches Pillow on every DIB file', { timeout: 120_000 }, () => {
    const files = [...discFileSet()]
      .filter((path) => path.endsWith('.dib'))
      .sort()
      .map((path) => discFile(path.toUpperCase()) ?? path);
    const ours = files.map((file) => expected(decodeDib(readFileSync(file), file)));
    const theirs = runPillow(files);
    expect(theirs).toHaveLength(files.length);
    const mismatches = files.filter((_, i) => ours[i] !== theirs[i]);
    expect(mismatches).toEqual([]);
  });

  it('matches Pillow on every bitmap resource in the program', () => {
    const resources = readNeResources(readFileSync(discFile(PROGRAM) ?? ''), PROGRAM);
    const bitmaps = resources.ofType(NE_RESOURCE_TYPE.bitmap);
    const decoded = bitmaps.map((resource) => {
      const bytes = resources.data(resource);
      return { id: resource.id, bytes, dib: decodeDib(bytes, `bitmap ${String(resource.id)}`) };
    });
    const theirs = runPillow(
      decoded.map(({ dib, bytes }) => `b64:${Buffer.from(withFileHeader(dib, bytes)).toString('base64')}`),
    );
    const mismatches = decoded
      .map(({ id, dib }, i) => ({ id, ours: expected(dib), theirs: theirs[i] }))
      .filter(({ ours, theirs }) => ours !== theirs);
    expect(mismatches).toEqual([]);
  });
});
