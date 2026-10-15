import { bytesSource, openIso } from '@twtw/formats';
import { buildIso } from '@twtw/formats/testing';
import { describe, expect, it } from 'vitest';
import { parseManifest } from '../manifest.ts';
import { DataNotFoundError } from './data-source.ts';
import { IsoDataSource } from './iso-source.ts';

const picture = Uint8Array.from({ length: 5000 }, (_, i) => (i * 11) & 0xff); // spans three blocks
const database = Uint8Array.of(1, 2, 3, 4);

async function open(): Promise<IsoDataSource> {
  const { bytes } = buildIso({
    volumeLabel: 'TESTDISC',
    root: [
      { name: 'DKCODE', children: [{ name: 'TWTW.PNG', data: database }] },
      {
        name: 'ARTICLE1',
        children: [{ name: 'AIRP', children: [{ name: 'AIRP0M.DIB', data: picture }] }],
      },
      { name: 'README.TXT', data: new Uint8Array(0) },
    ],
  });
  return IsoDataSource.open(await openIso(bytesSource(bytes)));
}

describe('IsoDataSource', () => {
  it('reads files ignoring case and separators', async () => {
    const source = await open();
    expect(source.volumeLabel).toBe('TESTDISC');
    expect(await source.read('dkcode/twtw.png')).toEqual(database);
    expect(await source.read('\\ARTICLE1\\airp\\AIRP0m.DIB')).toEqual(picture);
    expect(await source.read('README.TXT')).toEqual(new Uint8Array(0));
    expect(await source.exists('Article1/Airp/airp0m.dib')).toBe(true);
    expect(await source.exists('ARTICLE1/AIRP')).toBe(false);
    expect(source.sizeOf('article1/airp/airp0m.dib')).toBe(5000);
    expect(source.sizeOf('nope')).toBeUndefined();
  });

  it('rejects missing files and directories with DataNotFoundError', async () => {
    const source = await open();
    await expect(source.read('DKCODE/NOPE.PNG')).rejects.toBeInstanceOf(DataNotFoundError);
    await expect(source.read('DKCODE')).rejects.toBeInstanceOf(DataNotFoundError);
  });

  it('lists every file as a valid manifest, sorted by path', async () => {
    const source = await open();
    expect(parseManifest(JSON.parse(JSON.stringify(source.manifest)))).toEqual({
      version: 1,
      files: [
        { path: 'ARTICLE1/AIRP/AIRP0M.DIB', size: 5000 },
        { path: 'DKCODE/TWTW.PNG', size: 4 },
        { path: 'README.TXT', size: 0 },
      ],
    });
  });
});
