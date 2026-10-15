import { describe, expect, it } from 'vitest';
import { buildNeExecutable } from '../testing/ne-builder.ts';
import { readStringResource } from './program.ts';
import { NE_RESOURCE_TYPE, readNeResources } from './resources.ts';

/** A string-table block: 16 strings, each a length byte and Windows-1252 bytes. */
function stringBlock(strings: Record<number, number[]>): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < 16; i++) {
    const text = strings[i] ?? [];
    bytes.push(text.length, ...text);
  }
  return bytes;
}

const ascii = (text: string): number[] => [...text].map((char) => char.charCodeAt(0));

describe('readStringResource', () => {
  const resources = readNeResources(
    buildNeExecutable([
      { type: NE_RESOURCE_TYPE.string, id: 1, data: stringBlock({ 0: ascii('first'), 15: ascii('last') }) },
      // Strings 5000–5015 are block 313; 5000 is its position 8.
      { type: NE_RESOURCE_TYPE.string, id: 313, data: stringBlock({ 8: [0x28, 0x43, 0x29, 0x20, 0xe9] }) },
    ]),
  );

  it('finds a string by id: block (id >> 4) + 1, position id & 15', () => {
    expect(readStringResource(resources, 0)).toBe('first');
    expect(readStringResource(resources, 15)).toBe('last');
    expect(readStringResource(resources, 5000)).toBe('(C) é');
  });

  it('returns null for empty strings and missing blocks', () => {
    expect(readStringResource(resources, 1)).toBeNull();
    expect(readStringResource(resources, 5001)).toBeNull();
    expect(readStringResource(resources, 2001)).toBeNull();
  });
});
