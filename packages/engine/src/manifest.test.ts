import { describe, expect, it } from 'vitest';
import { parseManifest } from './manifest.ts';

describe('parseManifest', () => {
  it('accepts a valid manifest', () => {
    const json = { version: 1, files: [{ path: 'DIR/FILE.BIN', size: 3 }] };
    expect(parseManifest(json)).toEqual(json);
  });

  it.each([
    ['a non-object', 'nope'],
    ['an unknown version', { version: 2, files: [] }],
    ['missing files', { version: 1 }],
    ['an absolute path', { version: 1, files: [{ path: '/A', size: 1 }] }],
    ['a backslash path', { version: 1, files: [{ path: 'A\\B', size: 1 }] }],
    ['a negative size', { version: 1, files: [{ path: 'A', size: -1 }] }],
    ['a fractional size', { version: 1, files: [{ path: 'A', size: 1.5 }] }],
  ])('rejects %s', (_label, json) => {
    expect(() => parseManifest(json)).toThrow(/manifest/);
  });
});
