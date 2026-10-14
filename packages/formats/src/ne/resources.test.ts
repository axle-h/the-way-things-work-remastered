import { describe, expect, it } from 'vitest';
import { FormatError } from '../reader.ts';
import { buildNeExecutable } from '../testing/ne-builder.ts';
import { NE_RESOURCE_TYPE, readNeResources } from './resources.ts';

/**
 * A hand-assembled NE file, written straight from the public layout so that the reader is checked
 * independently of the test builder: MZ stub, NE header at 0x40, resource table at NE+0x40 with
 * alignment shift 4, one integer-typed resource (RT_BITMAP id 5) and one named-type resource
 * (`PAL`, id `X`), then the data at 0x100 and 0x110.
 */
function handAssembled(): Uint8Array {
  const file = new Uint8Array(0x120);
  file.set([0x4d, 0x5a], 0); // MZ
  file.set([0x40, 0, 0, 0], 0x3c); // e_lfanew
  file.set([0x4e, 0x45], 0x40); // NE
  file.set([0x40, 0, 0x73, 0], 0x40 + 0x24); // resource table at +0x40, resident names at +0x73
  // prettier-ignore
  file.set([
    4, 0, //                                 alignment shift
    0x02, 0x80, 1, 0, 0, 0, 0, 0, //         type RT_BITMAP, 1 resource
    0x10, 0, 1, 0, 0x30, 0, 0x05, 0x80, 0xaa, 0, 0xbb, 0, // at 0x100, 16 bytes, flags 0x30, id 5
    0x2c, 0, 1, 0, 0, 0, 0, 0, //            type named at table offset 0x2c, 1 resource
    0x11, 0, 1, 0, 0x70, 0, 0x30, 0, 0, 0, 0, 0, // at 0x110, 16 bytes, flags 0x70, id named at 0x30
    0, 0, //                                 end of types
    3, 0x50, 0x41, 0x4c, //                  "PAL" (offset 0x2c)
    1, 0x58, //                              "X" (offset 0x30)
    0, //                                    end of names
  ], 0x80);
  file.fill(0xb1, 0x100, 0x110);
  file.fill(0xc2, 0x110, 0x120);
  return file;
}

describe('readNeResources', () => {
  it('reads a hand-assembled resource table', () => {
    const ne = readNeResources(handAssembled(), 'test.exe');
    expect(ne.neOffset).toBe(0x40);
    expect(ne.tableOffset).toBe(0x80);
    expect(ne.alignShift).toBe(4);
    expect(ne.types).toEqual([
      { type: 2, count: 1, unknown1: 0 },
      { type: 'PAL', count: 1, unknown1: 0 },
    ]);
    expect(ne.resources).toEqual([
      { type: 2, id: 5, offset: 0x100, length: 0x10, flags: 0x30, unknown1: 0xaa, unknown2: 0xbb },
      { type: 'PAL', id: 'X', offset: 0x110, length: 0x10, flags: 0x70, unknown1: 0, unknown2: 0 },
    ]);
    expect([...ne.get(NE_RESOURCE_TYPE.bitmap, 5)]).toEqual(new Array(16).fill(0xb1));
    expect([...ne.get('pal', 'x')]).toEqual(new Array(16).fill(0xc2));
  });

  it('finds resources by integer or name (ignoring case) and lists them by type', () => {
    const bytes = buildNeExecutable([
      { type: NE_RESOURCE_TYPE.bitmap, id: 7, data: [1, 2, 3] },
      { type: NE_RESOURCE_TYPE.bitmap, id: 'THUMB', data: [4, 5] },
      { type: 'PALETTE', id: 200, data: [6] },
    ]);
    const ne = readNeResources(bytes);
    expect(ne.ofType(NE_RESOURCE_TYPE.bitmap).map((r) => r.id)).toEqual([7, 'THUMB']);
    expect(ne.find(NE_RESOURCE_TYPE.bitmap, 'thumb')?.id).toBe('THUMB');
    expect(ne.find('palette', 200)?.type).toBe('PALETTE');
    // Integer and named keys never match each other.
    expect(ne.find(NE_RESOURCE_TYPE.bitmap, '7')).toBeUndefined();
    expect(ne.find('PALETTE', 201)).toBeUndefined();
    // Data includes the padding to the alignment unit.
    expect([...ne.get(NE_RESOURCE_TYPE.bitmap, 7)]).toEqual([1, 2, 3, ...new Array(13).fill(0)]);
    expect(() => ne.get(NE_RESOURCE_TYPE.bitmap, 8)).toThrow(/no resource of type 2 with id 8/);
  });

  it('honours the alignment shift', () => {
    const ne = readNeResources(buildNeExecutable([{ type: 10, id: 1, data: [9, 9, 9] }], 6));
    const [resource] = ne.resources;
    expect(ne.alignShift).toBe(6);
    expect((resource?.offset ?? 1) % 64).toBe(0);
    expect(resource?.length).toBe(64);
  });

  it('accepts an executable without resources', () => {
    const bytes = handAssembled();
    bytes.set([0x73, 0], 0x40 + 0x24); // resource table offset = resident name table offset
    const ne = readNeResources(bytes);
    expect(ne.resources).toEqual([]);
    expect(ne.types).toEqual([]);
  });

  describe('rejects malformed input with FormatError', () => {
    const corrupt = (patch: (bytes: Uint8Array) => void): Uint8Array => {
      const bytes = handAssembled();
      patch(bytes);
      return bytes;
    };
    const cases: [string, Uint8Array, RegExp][] = [
      ['no MZ signature', corrupt((b) => b.set([0, 0], 0)), /not an MZ executable/],
      ['e_lfanew past the end', corrupt((b) => b.set([0, 0x10], 0x3c)), /NE header offset is outside/],
      ['no NE signature', corrupt((b) => b.set([0x50, 0x45], 0x40)), /no NE header/],
      [
        'resource data past the end',
        corrupt((b) => b.set([0x20, 0], 0x80 + 10)),
        /runs past the end of the file/,
      ],
      [
        'a name offset outside the table',
        corrupt((b) => b.set([0x60, 0], 0x80 + 2 + 8 + 12)),
        /outside the resource table/,
      ],
      ['a truncated table', corrupt((b) => b.set([0x54, 0], 0x40 + 0x26)), /cannot read 2 bytes/],
      ['resident names before resources', corrupt((b) => b.set([0x20, 0], 0x40 + 0x26)), /precedes/],
    ];
    it.each(cases)('%s', (_, bytes, message) => {
      expect(() => readNeResources(bytes)).toThrow(FormatError);
      expect(() => readNeResources(bytes)).toThrow(message);
    });
  });
});
