import { describe, expect, it } from 'vitest';
import { ByteReader } from '../reader.ts';
import {
  displayName,
  hasRockRidgeEntries,
  parseDirectoryRecord,
  readRecordDate,
  readVolumeDate,
} from './records.ts';

const reader = (bytes: number[]): ByteReader =>
  new ByteReader(Uint8Array.from(bytes), { order: 'le', name: 'test' });
const ascii = (text: string): number[] => [...text].map((char) => char.charCodeAt(0));

describe('directory record fields', () => {
  it('parses a record written by hand from ECMA-119 9.1', () => {
    const record = parseDirectoryRecord(
      reader([
        ...[41, 0], // record length, extended attribute record length
        ...[0x10, 0x20, 0, 0, 0, 0, 0x20, 0x10], // extent 0x2010, both orders
        ...[0x34, 0x12, 0, 0, 0, 0, 0x12, 0x34], // data length 0x1234
        ...[94, 8, 9, 16, 17, 58, 4], // 1994-08-09 16:17:58, UTC+1
        ...[0x01, 0, 0], // hidden; not interleaved
        ...[1, 0, 0, 1], // volume sequence number 1
        6,
        ...ascii('A.TXT;'), // even-length identifier, then one padding byte
        0,
        0xaa,
      ]),
      true,
    );
    expect(record).toMatchObject({
      offset: 0,
      extent: 0x2010,
      dataLength: 0x1234,
      recorded: new Date(Date.UTC(1994, 7, 9, 15, 17, 58)),
      flags: 1,
      volumeSequenceNumber: 1,
      identifier: 'A.TXT;',
    });
    expect([...record.systemUse]).toEqual([0xaa]);
  });

  it('reads recording dates with negative offsets, and all-zero dates as unspecified', () => {
    expect(readRecordDate(reader([100, 12, 31, 23, 59, 59, -20 & 0xff]))).toEqual(
      new Date(Date.UTC(2001, 0, 1, 4, 59, 59)),
    );
    expect(readRecordDate(reader([0, 0, 0, 0, 0, 0, 0]))).toBeUndefined();
  });

  it('reads volume dates', () => {
    expect(readVolumeDate(reader([...ascii('1994080916175712'), 0]))).toEqual(
      new Date(Date.UTC(1994, 7, 9, 16, 17, 57, 120)),
    );
    expect(readVolumeDate(reader([...ascii('0000000000000000'), 0]))).toBeUndefined();
    expect(readVolumeDate(reader(new Array(17).fill(0)))).toBeUndefined();
    expect(() => readVolumeDate(reader([...ascii('1994-08-09 16:17'), 0]))).toThrow(/invalid volume date/);
  });

  it('turns identifiers into names', () => {
    expect(displayName('README.TXT;1')).toEqual({ name: 'README.TXT', version: 1 });
    expect(displayName('INDEX.;1')).toEqual({ name: 'INDEX', version: 1 });
    expect(displayName('DKCODE')).toEqual({ name: 'DKCODE', version: undefined });
    expect(displayName('A.B;12')).toEqual({ name: 'A.B', version: 12 });
  });

  it('recognises SUSP with Rock Ridge entries', () => {
    const sp = [0x53, 0x50, 7, 1, 0xbe, 0xef, 0];
    expect(hasRockRidgeEntries(Uint8Array.from([...sp, ...ascii('PX'), 4, 1]))).toBe(true);
    expect(hasRockRidgeEntries(Uint8Array.from(sp))).toBe(false);
    expect(hasRockRidgeEntries(Uint8Array.from([...ascii('PX'), 4, 1]))).toBe(false);
    expect(hasRockRidgeEntries(new Uint8Array(0))).toBe(false);
  });
});
