/**
 * Builds small synthetic ISO 9660 images in memory, for tests (the repository holds no disc
 * bytes). It writes the structures in docs/formats/iso9660.md with 2,048-byte blocks: the system
 * area, a primary volume descriptor, optionally a Joliet supplementary descriptor, the terminator,
 * then the directories and the file data. Path tables are left empty; the reader does not use them.
 */
import { ByteWriter } from '../writer.ts';

const BLOCK = 2048;

export interface IsoFileSpec {
  /** Name without the version suffix, e.g. `README.TXT`. */
  readonly name: string;
  readonly data: Uint8Array;
  /** Appended to the name in the identifier. Defaults to `;1`. */
  readonly versionSuffix?: string;
  /** Extra file flag bits (the directory and multi-extent bits are set by the builder). */
  readonly flags?: number;
  readonly date?: Date;
  /** Split the data into extents of these lengths (multi-extent file); they must add up to its length. */
  readonly extentLengths?: readonly number[];
  /** File unit size and interleave gap, for an interleaved file. */
  readonly interleave?: { readonly unitSize: number; readonly gap: number };
}

export interface IsoDirectorySpec {
  readonly name: string;
  readonly children: readonly IsoNodeSpec[];
  readonly date?: Date;
}

export type IsoNodeSpec = IsoFileSpec | IsoDirectorySpec;

export interface IsoImageSpec {
  /** Defaults to `SYNTHETIC`. */
  readonly volumeLabel?: string;
  readonly root: readonly IsoNodeSpec[];
  /** Add a supplementary volume descriptor with the Joliet escape sequence. */
  readonly joliet?: boolean;
  /** Put SUSP "SP" and Rock Ridge "RR" entries in the root directory's "." record. */
  readonly rockRidge?: boolean;
}

export interface BuiltIso {
  readonly bytes: Uint8Array;
  /** Byte offset of the directory record of each file and directory, by path (`A/B.TXT`). */
  readonly recordOffsets: ReadonlyMap<string, number>;
}

const isDirectory = (node: IsoNodeSpec): node is IsoDirectorySpec => 'children' in node;

interface PlannedDirectory {
  readonly spec: IsoDirectorySpec;
  readonly path: string;
  block: number;
  size: number;
  parent: PlannedDirectory | undefined;
}

interface PlannedFile {
  readonly spec: IsoFileSpec;
  /** First block of each extent. */
  readonly blocks: number[];
  readonly lengths: readonly number[];
}

export function buildIso(spec: IsoImageSpec): BuiltIso {
  const descriptorCount = spec.joliet === true ? 3 : 2;
  const rootSpec: IsoDirectorySpec = {
    name: '\0',
    children: spec.root,
    date: new Date(Date.UTC(2000, 0, 1)),
  };

  // Plan directories (breadth first) and their sizes, then files.
  const directories: PlannedDirectory[] = [];
  const files = new Map<IsoFileSpec, PlannedFile>();
  const queue: PlannedDirectory[] = [{ spec: rootSpec, path: '', block: 0, size: 0, parent: undefined }];
  while (queue.length > 0) {
    const directory = queue.shift()!;
    directory.parent ??= directory;
    directories.push(directory);
    const lengths = [recordLength(1, 0), recordLength(1, 0)];
    if (directory.parent === directory && spec.rockRidge === true) {
      lengths[0] = recordLength(1, ROCK_RIDGE.length);
    }
    for (const child of directory.spec.children) {
      const extents = isDirectory(child) ? 1 : (child.extentLengths?.length ?? 1);
      for (let i = 0; i < extents; i++) lengths.push(recordLength(identifierOf(child).length, 0));
      if (isDirectory(child)) {
        const path = directory.path === '' ? child.name : `${directory.path}/${child.name}`;
        queue.push({ spec: child, path, block: 0, size: 0, parent: directory });
      }
    }
    directory.size = packedSize(lengths);
  }
  let next = 16 + descriptorCount;
  for (const directory of directories) {
    directory.block = next;
    next += directory.size / BLOCK;
  }
  for (const directory of directories) {
    for (const child of directory.spec.children) {
      if (isDirectory(child)) continue;
      const lengths = child.extentLengths ?? [child.data.length];
      if (lengths.reduce((a, b) => a + b, 0) !== child.data.length) {
        throw new Error(`${child.name}: the extent lengths do not add up to the data length`);
      }
      const blocks = lengths.map((length) => {
        const block = next;
        next += Math.max(1, Math.ceil(length / BLOCK));
        return block;
      });
      files.set(child, { spec: child, blocks, lengths });
    }
  }

  const image = new Uint8Array(next * BLOCK);
  const recordOffsets = new Map<string, number>();
  const root = directories[0]!;
  const rootRecord = directoryRecord({
    extent: root.block,
    length: root.size,
    flags: 2,
    identifier: [0],
    date: rootSpec.date,
  });
  image.set(primaryDescriptor(spec.volumeLabel ?? 'SYNTHETIC', next, rootRecord, 1), 16 * BLOCK);
  if (spec.joliet === true) image.set(primaryDescriptor('SYNTHETIC', next, rootRecord, 2), 17 * BLOCK);
  image.set(terminator(), (16 + descriptorCount - 1) * BLOCK);

  const childDirectory = new Map(directories.map((directory) => [directory.spec, directory]));
  for (const directory of directories) {
    const records: { path: string | undefined; bytes: Uint8Array }[] = [];
    const self = { extent: directory.block, length: directory.size, flags: 2, date: directory.spec.date };
    const systemUse = directory === root && spec.rockRidge === true ? ROCK_RIDGE : [];
    records.push({ path: undefined, bytes: directoryRecord({ ...self, identifier: [0], systemUse }) });
    const parent = directory.parent!;
    records.push({
      path: undefined,
      bytes: directoryRecord({
        extent: parent.block,
        length: parent.size,
        flags: 2,
        identifier: [1],
        date: parent.spec.date,
      }),
    });
    for (const child of directory.spec.children) {
      const identifier = identifierOf(child);
      const path = directory.path === '' ? child.name : `${directory.path}/${child.name}`;
      if (isDirectory(child)) {
        const planned = childDirectory.get(child)!;
        records.push({
          path,
          bytes: directoryRecord({
            extent: planned.block,
            length: planned.size,
            flags: 2,
            identifier,
            date: child.date,
          }),
        });
        continue;
      }
      const planned = files.get(child)!;
      planned.lengths.forEach((length, i) => {
        const last = i === planned.lengths.length - 1;
        records.push({
          path: i === 0 ? path : undefined,
          bytes: directoryRecord({
            extent: planned.blocks[i]!,
            length,
            flags: (child.flags ?? 0) | (last ? 0 : 0x80),
            identifier,
            date: child.date,
            unitSize: child.interleave?.unitSize ?? 0,
            gap: child.interleave?.gap ?? 0,
          }),
        });
      });
      let at = 0;
      planned.lengths.forEach((length, i) => {
        image.set(child.data.subarray(at, at + length), planned.blocks[i]! * BLOCK);
        at += length;
      });
    }
    let position = directory.block * BLOCK;
    for (const record of records) {
      if ((position % BLOCK) + record.bytes.length > BLOCK) position += BLOCK - (position % BLOCK);
      image.set(record.bytes, position);
      if (record.path !== undefined) recordOffsets.set(record.path, position);
      position += record.bytes.length;
    }
  }
  return { bytes: image, recordOffsets };
}

/** SUSP "SP" (check bytes BE EF, nothing skipped) followed by a Rock Ridge "RR" entry. */
const ROCK_RIDGE = [0x53, 0x50, 7, 1, 0xbe, 0xef, 0, 0x52, 0x52, 5, 1, 0x81];

function identifierOf(node: IsoNodeSpec): number[] {
  const text = isDirectory(node) ? node.name : node.name + (node.versionSuffix ?? ';1');
  return [...text].map((char) => char.charCodeAt(0));
}

function recordLength(identifierLength: number, systemUseLength: number): number {
  return 33 + identifierLength + (identifierLength % 2 === 0 ? 1 : 0) + systemUseLength;
}

/** Bytes taken by records packed into blocks without crossing a block boundary. */
function packedSize(lengths: readonly number[]): number {
  let position = 0;
  for (const length of lengths) {
    if ((position % BLOCK) + length > BLOCK) position += BLOCK - (position % BLOCK);
    position += length;
  }
  return Math.ceil(position / BLOCK) * BLOCK;
}

function both16(writer: ByteWriter, value: number): void {
  writer.u16(value).bytes([(value >> 8) & 0xff, value & 0xff]);
}

function both32(writer: ByteWriter, value: number): void {
  writer.u32(value).bytes([(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]);
}

function text(writer: ByteWriter, value: string, length: number): void {
  writer.bytes([...value.padEnd(length, ' ')].map((char) => char.charCodeAt(0)));
}

interface RecordFields {
  readonly extent: number;
  readonly length: number;
  readonly flags: number;
  readonly identifier: readonly number[];
  readonly date?: Date | undefined;
  readonly unitSize?: number;
  readonly gap?: number;
  readonly systemUse?: readonly number[];
}

function directoryRecord(fields: RecordFields): Uint8Array {
  const systemUse = fields.systemUse ?? [];
  const writer = new ByteWriter('le');
  writer.u8(recordLength(fields.identifier.length, systemUse.length)).u8(0);
  both32(writer, fields.extent);
  both32(writer, fields.length);
  const date = fields.date;
  if (date === undefined) {
    writer.bytes([0, 0, 0, 0, 0, 0, 0]);
  } else {
    writer.bytes([
      date.getUTCFullYear() - 1900,
      date.getUTCMonth() + 1,
      date.getUTCDate(),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      0,
    ]);
  }
  writer
    .u8(fields.flags)
    .u8(fields.unitSize ?? 0)
    .u8(fields.gap ?? 0);
  both16(writer, 1);
  writer.u8(fields.identifier.length).bytes(fields.identifier);
  if (fields.identifier.length % 2 === 0) writer.u8(0);
  writer.bytes(systemUse);
  return writer.toBytes();
}

function primaryDescriptor(label: string, blocks: number, rootRecord: Uint8Array, type: 1 | 2): Uint8Array {
  const writer = new ByteWriter('le');
  writer.u8(type).bytes([0x43, 0x44, 0x30, 0x30, 0x31]).u8(1).u8(0);
  text(writer, '', 32);
  text(writer, label, 32);
  writer.bytes(new Uint8Array(8));
  both32(writer, blocks);
  // Escape sequences (supplementary descriptors only): `%/E` marks Joliet level 3.
  writer.bytes(type === 2 ? [0x25, 0x2f, 0x45, ...new Uint8Array(29)] : new Uint8Array(32));
  both16(writer, 1);
  both16(writer, 1);
  both16(writer, BLOCK);
  both32(writer, 0);
  writer.bytes(new Uint8Array(16));
  writer.bytes(rootRecord);
  for (const length of [128, 128, 128, 128, 37, 37, 37]) text(writer, '', length);
  const date = [...'2000010112000000'].map((char) => char.charCodeAt(0));
  writer.bytes([...date, 0]); // created
  writer.bytes([...date, 0]); // modified
  writer.bytes([...new Uint8Array(16).fill(0x30), 0]); // expires: not specified
  writer.bytes([...new Uint8Array(16).fill(0x30), 0]); // effective: not specified
  writer.u8(1);
  writer.bytes(new Uint8Array(BLOCK - writer.length));
  return writer.toBytes();
}

function terminator(): Uint8Array {
  return Uint8Array.from([0xff, 0x43, 0x44, 0x30, 0x30, 0x31, 1, ...new Uint8Array(BLOCK - 7)]);
}
