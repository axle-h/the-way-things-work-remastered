import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildIso, type IsoNodeSpec } from '@twtw/formats/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DiscRejected, openDisc, sha256 } from './disc.ts';
import { TWTW_DISC, type DiscIdentity } from './identity.ts';

// Synthetic stand-ins for the disc: a page database of a few bytes, identified by its own hash.
const database = Uint8Array.of(1, 9, 9, 4);
const picture = Uint8Array.from({ length: 3000 }, (_, i) => i & 0xff);
const identity: DiscIdentity = {
  volumeLabel: 'TESTDISC',
  databasePath: 'DKCODE/TWTW.PNG',
  databaseSha256: sha256(database),
};
const tree: IsoNodeSpec[] = [
  { name: 'DKCODE', children: [{ name: 'TWTW.PNG', data: database }] },
  { name: 'ARTICLE1', children: [{ name: 'AIRP0M.DIB', data: picture }] },
];

describe('openDisc', () => {
  let scratch: string;
  beforeEach(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'twtw-disc-'));
  });
  afterEach(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  async function image(name: string, label: string, root: IsoNodeSpec[] = tree): Promise<string> {
    const path = join(scratch, name);
    await writeFile(path, buildIso({ volumeLabel: label, root }).bytes);
    return path;
  }

  const rejection = async (promise: Promise<unknown>): Promise<string> => {
    const error = await promise.then(
      () => null,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(DiscRejected);
    return (error as DiscRejected).message;
  };

  it('opens the disc image in place and serves its files', async () => {
    const path = await image('disc.iso', 'TESTDISC');
    const disc = await openDisc('iso', path, identity);
    try {
      expect(disc).toMatchObject({ kind: 'iso', path });
      expect(disc.manifest.files).toEqual([
        { path: 'ARTICLE1/AIRP0M.DIB', size: 3000 },
        { path: 'DKCODE/TWTW.PNG', size: 4 },
      ]);
      expect(await disc.read('article1/airp0m.dib')).toEqual(picture);
      expect(await disc.exists('DKCODE/twtw.png')).toBe(true);
    } finally {
      await disc.close();
    }
  });

  it('turns down images that are not the disc', async () => {
    expect(await rejection(openDisc('iso', join(scratch, 'missing.iso'), identity))).toMatch(
      /cannot be opened \(it is not there\)/,
    );
    const text = join(scratch, 'notes.iso');
    await writeFile(text, 'hello');
    expect(await rejection(openDisc('iso', text, identity))).toMatch(/not a CD image/);
    expect(await rejection(openDisc('iso', await image('other.iso', 'HOLIDAYS'), identity))).toMatch(
      /not The Way Things Work: it has the label “HOLIDAYS”/,
    );
    expect(await rejection(openDisc('iso', await image('blank.iso', ''), identity))).toMatch(
      /it has no label/,
    );
    const noDatabase = await image('nodb.iso', 'TESTDISC', [{ name: 'README.TXT', data: database }]);
    expect(await rejection(openDisc('iso', noDatabase, identity))).toMatch(/no readable DKCODE\/TWTW.PNG/);
    const changed = await image('changed.iso', 'TESTDISC', [
      { name: 'DKCODE', children: [{ name: 'TWTW.PNG', data: Uint8Array.of(1, 9, 9, 5) }] },
    ]);
    expect(await rejection(openDisc('iso', changed, identity))).toMatch(/not the 1994 edition/);
  });

  it('opens a folder, such as a mounted CD whose names are lower case', async () => {
    await mkdir(join(scratch, 'cd', 'dkcode'), { recursive: true });
    await mkdir(join(scratch, 'cd', 'article1'));
    await writeFile(join(scratch, 'cd', 'dkcode', 'twtw.png'), database);
    await writeFile(join(scratch, 'cd', 'article1', 'airp0m.dib'), picture);
    const disc = await openDisc('directory', join(scratch, 'cd'), identity);
    expect(disc.kind).toBe('directory');
    expect(disc.manifest.files.map((file) => file.path)).toEqual(['article1/airp0m.dib', 'dkcode/twtw.png']);
    expect(await disc.read('ARTICLE1/AIRP0M.DIB')).toEqual(picture);
    await disc.close();
  });

  it('turns down folders that are not the disc', async () => {
    await mkdir(join(scratch, 'empty'));
    expect(await rejection(openDisc('directory', join(scratch, 'empty'), identity))).toMatch(
      /has no DKCODE\/TWTW.PNG\. Choose the top folder/,
    );
    expect(await rejection(openDisc('directory', join(scratch, 'nowhere'), identity))).toMatch(
      /has no DKCODE/,
    );
    await mkdir(join(scratch, 'copy', 'DKCODE'), { recursive: true });
    await writeFile(join(scratch, 'copy', 'DKCODE', 'TWTW.PNG'), 'changed');
    expect(await rejection(openDisc('directory', join(scratch, 'copy'), identity))).toMatch(
      /not the 1994 edition/,
    );
  });
});

describe('TWTW_DISC', () => {
  it('identifies the disc by its label and a SHA-256', () => {
    expect(TWTW_DISC.volumeLabel).toBe('DKMMTWTW');
    expect(TWTW_DISC.databasePath).toBe('DKCODE/TWTW.PNG');
    expect(TWTW_DISC.databaseSha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
