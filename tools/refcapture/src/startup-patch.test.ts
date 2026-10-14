import { parsePageDatabase } from '@twtw/formats';
import { describe, expect, it } from 'vitest';
import { patchStartupPage, startupPageOffset } from './startup-patch.ts';
import { built, ref } from './test-database.ts';

describe('startupPageOffset', () => {
  it('is 8 + string-table length + 18 and holds the startup page', () => {
    const view = new DataView(built.bytes.buffer, built.bytes.byteOffset);
    const offset = startupPageOffset(built.bytes);
    expect(offset).toBe(8 + view.getUint32(4) + 18);
    expect(view.getUint32(offset)).toBe(ref('title'));
  });

  it('rejects a file too short for its header', () => {
    expect(() => startupPageOffset(new Uint8Array(4))).toThrow(/too short/);
  });
});

describe('patchStartupPage', () => {
  it('makes another base page the startup page and changes nothing else', () => {
    const patched = patchStartupPage(built.bytes, ref('airplane'));
    expect(parsePageDatabase(patched).product.startupPage).toBe(ref('airplane'));
    const offset = startupPageOffset(built.bytes);
    const changed = [...patched.keys()].filter((i) => patched[i] !== built.bytes[i]);
    expect(changed.every((i) => i >= offset && i < offset + 4)).toBe(true);
    expect(parsePageDatabase(built.bytes).product.startupPage).toBe(ref('title'));
  });

  it('refuses a popup page', () => {
    expect(() => patchStartupPage(built.bytes, ref('popup'))).toThrow(/popup page/);
  });
});
