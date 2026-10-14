import { describe, expect, it } from 'vitest';
import { ByteReader, FormatError } from './reader.ts';
import { ByteWriter } from './writer.ts';

const sample = new Uint8Array([0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0]);

describe('ByteReader', () => {
  it('reads big-endian values', () => {
    const r = new ByteReader(sample, { order: 'be' });
    expect(r.u16()).toBe(0x1234);
    expect(r.u16()).toBe(0x5678);
    expect(r.u32()).toBe(0x9abcdef0);
    expect(r.atEnd).toBe(true);
    r.seek(4);
    expect(r.i16()).toBe(0x9abc - 0x10000);
    r.seek(4);
    expect(r.i32()).toBe(0x9abcdef0 - 0x1_0000_0000);
  });

  it('reads little-endian values', () => {
    const r = new ByteReader(sample, { order: 'le' });
    expect(r.u16()).toBe(0x3412);
    expect(r.u32()).toBe(0xbc9a7856);
    r.seek(4);
    expect(r.i16()).toBe(0xbc9a - 0x10000);
    r.seek(4);
    expect(r.i32()).toBe(0xf0debc9a - 0x1_0000_0000);
  });

  it('reads explicit byte orders regardless of the default', () => {
    const r = new ByteReader(sample, { order: 'le' });
    expect(r.u16be()).toBe(0x1234);
    expect(r.u16le()).toBe(0x7856);
    expect(r.u32be()).toBe(0x9abcdef0);
    r.seek(0);
    expect(r.u32le()).toBe(0x78563412);
    expect(r.i32be()).toBe(0x9abcdef0 - 0x1_0000_0000);
    r.seek(4);
    expect(r.i16be()).toBe(0x9abc - 0x10000);
    expect(r.i16le()).toBe(0xf0de - 0x10000);
    r.seek(4);
    expect(r.i32le()).toBe(0xf0debc9a - 0x1_0000_0000);
  });

  it('reads bytes and signed bytes', () => {
    const r = new ByteReader(sample, { order: 'be' });
    expect(r.u8()).toBe(0x12);
    r.seek(4);
    expect(r.i8()).toBe(0x9a - 0x100);
    expect(r.u8()).toBe(0xbc);
  });

  it('tracks position and remaining bytes', () => {
    const r = new ByteReader(sample, { order: 'be' });
    expect([r.position, r.remaining, r.length]).toEqual([0, 8, 8]);
    r.skip(3);
    expect([r.position, r.remaining]).toEqual([3, 5]);
    r.seek(8);
    expect(r.atEnd).toBe(true);
  });

  it('returns byte views, copies and ASCII tags', () => {
    const r = new ByteReader(new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2]), { order: 'le' });
    expect(r.ascii(4)).toBe('RIFF');
    const view = r.bytesView(2);
    expect([...view]).toEqual([1, 2]);
    r.seek(4);
    const copy = r.bytesCopy(2);
    copy[0] = 9;
    expect(r.bytes[4]).toBe(1);
    view[0] = 7;
    expect(r.bytes[4]).toBe(7);
  });

  it('respects the byte offset of a subarray', () => {
    const r = new ByteReader(sample.subarray(2, 6), { order: 'be' });
    expect(r.u32()).toBe(0x56789abc);
  });

  it('throws a FormatError with name and absolute offset when reading past the end', () => {
    const r = new ByteReader(sample, { order: 'be', name: 'TEST.BIN' });
    r.seek(6);
    expect(() => r.u32()).toThrow(FormatError);
    expect(() => r.u32()).toThrow('TEST.BIN: cannot read 4 bytes; only 2 left (at offset 6 (0x6))');
    expect(r.position).toBe(6);
    expect(() => r.skip(3)).toThrow(/only 2 left/);
    expect(() => r.bytesView(-1)).toThrow(/invalid byte count/);
  });

  it('rejects out-of-range seeks', () => {
    const r = new ByteReader(sample, { order: 'be' });
    expect(() => r.seek(9)).toThrow(FormatError);
    expect(() => r.seek(-1)).toThrow(FormatError);
    expect(() => r.seek(1.5)).toThrow(FormatError);
  });

  it('takes a sub-reader that reports absolute offsets', () => {
    const r = new ByteReader(sample, { order: 'be', name: 'X' });
    r.skip(2);
    const sub = r.take(4);
    expect(r.position).toBe(6);
    expect(sub.origin).toBe(2);
    expect(sub.u16()).toBe(0x5678);
    sub.skip(2);
    try {
      sub.u8();
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(FormatError);
      expect((error as FormatError).offset).toBe(6);
    }
    expect(() => r.take(3)).toThrow(FormatError);
  });

  it('slices without moving', () => {
    const r = new ByteReader(sample, { order: 'le' });
    const s = r.slice(6);
    expect(r.position).toBe(0);
    expect([s.origin, s.length, s.order]).toEqual([6, 2, 'le']);
    expect(s.u16()).toBe(0xf0de);
    expect(r.slice(2, 2).u16()).toBe(0x7856);
    expect(() => r.slice(7, 2)).toThrow(/runs past the end/);
  });

  it('builds errors at the current or a given offset', () => {
    const r = new ByteReader(sample, { order: 'be', name: 'N', origin: 0x100 });
    r.skip(1);
    expect(r.error('bad').message).toBe('N: bad (at offset 257 (0x101))');
    expect(r.error('bad', 0).offset).toBe(0);
  });
});

describe('ByteWriter', () => {
  it('writes both byte orders and round-trips through ByteReader', () => {
    for (const order of ['be', 'le'] as const) {
      const bytes = new ByteWriter(order)
        .u8(0xfe)
        .i8(-2)
        .u16(0xbeef)
        .i16(-2)
        .u32(0xdeadbeef)
        .i32(-2)
        .bytes([1, 2, 3])
        .toBytes();
      const r = new ByteReader(bytes, { order });
      expect([r.u8(), r.i8(), r.u16(), r.i16(), r.u32(), r.i32()]).toEqual([
        0xfe, -2, 0xbeef, -2, 0xdeadbeef, -2,
      ]);
      expect([...r.bytesView(3)]).toEqual([1, 2, 3]);
      expect(r.atEnd).toBe(true);
    }
  });

  it('grows past its initial capacity and patches earlier values', () => {
    const w = new ByteWriter('be').u32(0);
    for (let i = 0; i < 1000; i++) w.u16(i);
    w.patchU32(0, w.length);
    const r = new ByteReader(w.toBytes(), { order: 'be' });
    expect(r.u32()).toBe(2004);
    r.seek(2002);
    expect(r.u16()).toBe(999);
    expect(() => w.patchU32(2002, 0)).toThrow(RangeError);
  });
});
