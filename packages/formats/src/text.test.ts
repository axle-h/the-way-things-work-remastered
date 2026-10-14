import { describe, expect, it } from 'vitest';
import { decodeWindows1252, encodeWindows1252 } from './text.ts';

describe('decodeWindows1252', () => {
  it('decodes ASCII', () => {
    expect(decodeWindows1252(new Uint8Array([0x41, 0x69, 0x72, 0x20, 0x5c, 0x7e]))).toBe('Air \\~');
  });

  it('maps 0x80–0x9F through the Windows-1252 table', () => {
    const bytes = new Uint8Array([0x80, 0x85, 0x91, 0x92, 0x93, 0x94, 0x96, 0x97, 0x99, 0x9f]);
    expect(decodeWindows1252(bytes)).toBe('€…‘’“”–—™Ÿ');
  });

  it('maps the five undefined bytes to the same code point', () => {
    const bytes = new Uint8Array([0x81, 0x8d, 0x8f, 0x90, 0x9d]);
    expect([...decodeWindows1252(bytes)].map((c) => c.charCodeAt(0))).toEqual([0x81, 0x8d, 0x8f, 0x90, 0x9d]);
  });

  it('maps 0xA0–0xFF to Latin-1', () => {
    expect(decodeWindows1252(new Uint8Array([0xa0, 0xa9, 0xe9, 0xfc, 0xff]))).toBe(' ©éüÿ');
  });

  it('decodes every byte to exactly one character', () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(decodeWindows1252(all)).toHaveLength(256);
  });
});

describe('encodeWindows1252', () => {
  it('is the inverse of decoding for every byte', () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect([...encodeWindows1252(decodeWindows1252(all))]).toEqual([...all]);
  });

  it('rejects characters outside Windows-1252', () => {
    expect(() => encodeWindows1252('→')).toThrow(RangeError);
    expect(() => encodeWindows1252('\u0080')).toThrow(RangeError);
  });
});
