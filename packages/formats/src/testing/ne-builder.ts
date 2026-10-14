/**
 * Builds synthetic NE executables for tests (the repository holds no disc bytes), in the public
 * layout described in docs/formats/program.md §Resources.
 */
import { ByteWriter } from '../writer.ts';

/** A resource for {@link buildNeExecutable}: integer or named type and id. */
export interface NeResourceSpec {
  readonly type: number | string;
  readonly id: number | string;
  readonly data: ArrayLike<number>;
  readonly flags?: number;
}

/**
 * Builds a minimal NE executable: an MZ stub whose `e_lfanew` points to an NE header with only
 * the resource table (and an empty resident name table after it), followed by the resource data
 * aligned to `1 << alignShift` bytes.
 */
export function buildNeExecutable(resources: readonly NeResourceSpec[], alignShift = 4): Uint8Array {
  const unit = 2 ** alignShift;
  const neOffset = 0x40;
  const neHeaderSize = 0x40;

  // Group resources by type, in first-appearance order.
  const groups = new Map<number | string, NeResourceSpec[]>();
  for (const resource of resources) {
    const group = groups.get(resource.type) ?? [];
    group.push(resource);
    groups.set(resource.type, group);
  }
  const names = [
    ...new Set([...groups.keys(), ...resources.map((r) => r.id)].filter((k) => typeof k === 'string')),
  ];
  const typeBlocksSize = [...groups.values()].reduce((size, group) => size + 8 + group.length * 12, 0);
  const namesStart = 2 + typeBlocksSize + 2;
  const nameOffsets = new Map<string, number>();
  let namesSize = 0;
  for (const name of names) {
    nameOffsets.set(name, namesStart + namesSize);
    namesSize += 1 + name.length;
  }
  const tableSize = namesStart + namesSize + 1;
  const tableOffset = neHeaderSize;
  const residentNamesOffset = tableOffset + tableSize;
  const residentNamesSize = 1;
  let dataOffset = Math.ceil((neOffset + residentNamesOffset + residentNamesSize) / unit) * unit;

  const key = (value: number | string): number =>
    typeof value === 'number' ? value | 0x8000 : (nameOffsets.get(value) ?? 0);

  const table = new ByteWriter('le').u16(alignShift);
  const data: { offset: number; bytes: ArrayLike<number> }[] = [];
  for (const [type, group] of groups) {
    table.u16(key(type)).u16(group.length).u32(0);
    for (const resource of group) {
      const length = Math.ceil(resource.data.length / unit) * unit;
      table
        .u16(dataOffset / unit)
        .u16(length / unit)
        .u16(resource.flags ?? 0x30)
        .u16(key(resource.id))
        .u16(0)
        .u16(0);
      data.push({ offset: dataOffset, bytes: resource.data });
      dataOffset += length;
    }
  }
  table.u16(0);
  for (const name of names) table.u8(name.length).bytes([...name].map((c) => c.charCodeAt(0)));
  table.u8(0);

  const file = new Uint8Array(dataOffset);
  const header = new ByteWriter('le').u16(0x5a4d);
  file.set(header.toBytes(), 0);
  new DataView(file.buffer).setUint32(0x3c, neOffset, true);
  const ne = new DataView(file.buffer, neOffset);
  ne.setUint16(0, 0x454e, true);
  ne.setUint16(0x24, tableOffset, true);
  ne.setUint16(0x26, residentNamesOffset, true);
  file.set(table.toBytes(), neOffset + tableOffset);
  for (const { offset, bytes } of data) file.set(bytes, offset);
  return file;
}
