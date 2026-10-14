/**
 * Reader for the resources of a 16-bit Windows (NE) executable, written from the public NE format
 * documentation (see docs/formats/program.md §Resources). The program file is data here: we only
 * locate and copy resource bytes.
 *
 * Layout: the MZ header's `e_lfanew` (u32 at 0x3C) points to the NE header (`NE`). The NE header's
 * u16 at +0x24 is the offset of the resource table and the u16 at +0x26 the offset of the resident
 * name table, both relative to the NE header. The resource table is:
 * - `alignShift` u16: resource offsets and lengths are in units of `1 << alignShift` bytes;
 * - type blocks until a type id of 0: type id u16, resource count u16, reserved u32, then per
 *   resource: offset u16, length u16, flags u16, id u16, reserved u16, reserved u16;
 * - the names of named types and resources, as length-prefixed strings.
 *
 * A type id or resource id with bit 15 set is an integer (the low 15 bits); otherwise it is the
 * offset, from the start of the resource table, of the length-prefixed name.
 */
import { ByteReader } from '../reader.ts';
import { decodeWindows1252 } from '../text.ts';

/** Integer resource types (`RT_…`). */
export const NE_RESOURCE_TYPE = {
  cursor: 1,
  bitmap: 2,
  icon: 3,
  menu: 4,
  dialog: 5,
  string: 6,
  fontDirectory: 7,
  font: 8,
  accelerator: 9,
  rcData: 10,
  groupCursor: 12,
  groupIcon: 14,
  version: 16,
} as const;

/** Resource flag bits. */
export const NE_RESOURCE_FLAGS = { moveable: 0x10, pure: 0x20, preload: 0x40 } as const;

const MZ_SIGNATURE = 0x5a4d;
const NE_SIGNATURE = 0x454e;
const INTEGER_ID = 0x8000;

/** A resource type or id: an integer, or a name (as stored, normally upper case). */
export type NeResourceKey = number | string;

export interface NeResource {
  readonly type: NeResourceKey;
  readonly id: NeResourceKey;
  /** File offset of the data. */
  readonly offset: number;
  /** Length of the data, a multiple of the alignment (so it may include padding). */
  readonly length: number;
  /** See {@link NE_RESOURCE_FLAGS}. */
  readonly flags: number;
  /** The two reserved words after the id (a handle and a usage count at run time; 0 on disk). */
  readonly unknown1: number;
  readonly unknown2: number;
}

export interface NeResourceType {
  readonly type: NeResourceKey;
  readonly count: number;
  /** The reserved u32 after the count. */
  readonly unknown1: number;
}

export class NeResources {
  readonly bytes: Uint8Array;
  readonly name: string;
  /** File offset of the NE header. */
  readonly neOffset: number;
  /** File offset of the resource table. */
  readonly tableOffset: number;
  readonly alignShift: number;
  readonly types: readonly NeResourceType[];
  /** Every resource, in table order. */
  readonly resources: readonly NeResource[];

  constructor(bytes: Uint8Array, name: string) {
    this.bytes = bytes;
    this.name = name;
    const reader = new ByteReader(bytes, { order: 'le', name });
    if (reader.u16() !== MZ_SIGNATURE) throw reader.error('not an MZ executable', 0);
    this.neOffset = reader.seek(0x3c).u32();
    if (this.neOffset + 0x40 > bytes.length) throw reader.error('NE header offset is outside the file', 0x3c);
    const ne = reader.slice(this.neOffset);
    if (ne.u16() !== NE_SIGNATURE) throw ne.error('no NE header at e_lfanew', ne.origin);
    const tableStart = ne.seek(0x24).u16();
    const residentNames = ne.u16();
    this.tableOffset = this.neOffset + tableStart;
    const types: NeResourceType[] = [];
    const resources: NeResource[] = [];
    if (tableStart === residentNames) {
      // No resource table.
      this.alignShift = 0;
    } else {
      if (residentNames < tableStart) {
        throw ne.error('resident name table precedes the resource table', ne.origin + 0x26);
      }
      const table = ne.slice(tableStart, residentNames - tableStart);
      this.alignShift = table.u16();
      if (this.alignShift > 16)
        throw table.error(`implausible alignment shift ${this.alignShift}`, table.origin);
      const unit = 2 ** this.alignShift;
      for (;;) {
        const typeAt = table.position;
        const rawType = table.u16();
        if (rawType === 0) break;
        const type = this.#key(table, rawType, typeAt);
        const count = table.u16();
        types.push({ type, count, unknown1: table.u32() });
        for (let i = 0; i < count; i++) {
          const entryAt = table.position;
          const offset = table.u16() * unit;
          const length = table.u16() * unit;
          const flags = table.u16();
          const id = this.#key(table, table.u16(), entryAt + 6);
          const unknown1 = table.u16();
          const unknown2 = table.u16();
          if (offset + length > bytes.length) {
            throw table.error(
              `resource ${String(type)}/${String(id)} at ${offset}+${length} runs past the end of the file`,
              table.origin + entryAt,
            );
          }
          resources.push({ type, id, offset, length, flags, unknown1, unknown2 });
        }
      }
    }
    this.types = types;
    this.resources = resources;
  }

  /** Every resource of a type. Names match ignoring case. */
  ofType(type: NeResourceKey): NeResource[] {
    return this.resources.filter((resource) => keysEqual(resource.type, type));
  }

  /** The resource with this type and id, if any. Names match ignoring case. */
  find(type: NeResourceKey, id: NeResourceKey): NeResource | undefined {
    return this.resources.find((resource) => keysEqual(resource.type, type) && keysEqual(resource.id, id));
  }

  /** A resource's bytes (a view, including any alignment padding). */
  data(resource: NeResource): Uint8Array {
    return this.bytes.subarray(resource.offset, resource.offset + resource.length);
  }

  /** The bytes of the resource with this type and id; throws if there is none. */
  get(type: NeResourceKey, id: NeResourceKey): Uint8Array {
    const resource = this.find(type, id);
    if (resource === undefined) {
      throw new RangeError(
        `${this.name}: no resource of type ${describeKey(type)} with id ${describeKey(id)}`,
      );
    }
    return this.data(resource);
  }

  /** Decodes an id or type field: an integer (bit 15 set) or a name at an offset in the table. */
  #key(table: ByteReader, raw: number, fieldAt: number): NeResourceKey {
    if ((raw & INTEGER_ID) !== 0) return raw & ~INTEGER_ID;
    if (raw >= table.length) {
      throw table.error(`name offset ${raw} is outside the resource table`, table.origin + fieldAt);
    }
    const nameReader = table.slice(raw);
    return decodeWindows1252(nameReader.bytesView(nameReader.u8()));
  }
}

/** Parses the resource table of an NE executable. Throws `FormatError` if it is malformed. */
export function readNeResources(bytes: Uint8Array, name = 'executable'): NeResources {
  return new NeResources(bytes, name);
}

function keysEqual(a: NeResourceKey, b: NeResourceKey): boolean {
  if (typeof a === 'number' || typeof b === 'number') return a === b;
  return a.toUpperCase() === b.toUpperCase();
}

function describeKey(key: NeResourceKey): string {
  return typeof key === 'number' ? String(key) : `"${key}"`;
}
