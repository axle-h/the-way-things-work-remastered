/**
 * Reads files from an ISO 9660 (ECMA-119) disc image through a {@link BlockSource}, reading only
 * the descriptors, directories and file ranges it needs. See docs/formats/iso9660.md.
 *
 * Names come from the primary volume descriptor's directory hierarchy (Joliet and Rock Ridge are
 * detected and reported, but not used). Path lookup ignores case and uses `/` separators.
 */
import { ByteReader, FormatError } from '../reader.ts';
import {
  DESCRIPTORS_OFFSET,
  FileFlags,
  SECTOR_SIZE,
  bothU16,
  bothU32,
  displayName,
  hasRockRidgeEntries,
  parseDirectoryRecord,
  readTextField,
  readVolumeDate,
  type DirectoryRecord,
} from './records.ts';
import type { BlockSource } from './source.ts';

/** Volume descriptor types (ECMA-119 8.1.1). */
export const VolumeDescriptorType = {
  bootRecord: 0,
  primary: 1,
  supplementary: 2,
  partition: 3,
  terminator: 255,
} as const;

/** Give up looking for the terminator after this many descriptors. */
const MAX_DESCRIPTORS = 64;

export interface IsoOptions {
  /**
   * Check that the little- and big-endian halves of both-endian numbers agree (the reader always
   * uses the little-endian half). Defaults to true.
   */
  readonly checkBothEndian?: boolean;
}

/** One contiguous run of a file's data. */
export interface IsoExtent {
  /** Absolute byte offset of the data in the image (after any extended attribute record). */
  readonly position: number;
  /** Length in bytes. */
  readonly length: number;
}

/** A file or directory. */
export interface IsoEntry {
  /** Name as on the disc, without the `;1` version suffix or a trailing `.`. Empty for the root. */
  readonly name: string;
  /** Path from the root with `/` separators and the disc's case, e.g. `DKCODE/TWTW.PNG`. Empty for the root. */
  readonly path: string;
  readonly isDirectory: boolean;
  /** Size in bytes (for a directory, the size of its records). */
  readonly size: number;
  /** Where the data is, in order. More than one only for a multi-extent file. */
  readonly extents: readonly IsoExtent[];
  /** Recording date, or `undefined` when not specified. */
  readonly modified: Date | undefined;
  /** The "existence" flag: the file need not be shown to the user. */
  readonly hidden: boolean;
  /** The `;n` version number, when present. */
  readonly version: number | undefined;
  /** Whether the file is recorded in interleaved mode, which this reader does not support. */
  readonly interleaved: boolean;
}

export interface VolumeDescriptorSummary {
  readonly type: number;
  readonly version: number;
  /** Sector (2,048 bytes) where the descriptor is. */
  readonly sector: number;
}

/** The primary volume descriptor's fields (ECMA-119 8.4), plus what the other descriptors reveal. */
export interface IsoVolumeInfo {
  readonly systemIdentifier: string;
  /** The volume identifier, e.g. `DKMMTWTW`. */
  readonly volumeLabel: string;
  /** Volume size in logical blocks. */
  readonly volumeSpaceSize: number;
  readonly volumeSetSize: number;
  readonly volumeSequenceNumber: number;
  /** Logical block size in bytes (2,048 on CD-ROMs). */
  readonly logicalBlockSize: number;
  readonly pathTableSize: number;
  readonly volumeSetIdentifier: string;
  readonly publisherIdentifier: string;
  readonly dataPreparerIdentifier: string;
  readonly applicationIdentifier: string;
  readonly copyrightFileIdentifier: string;
  readonly abstractFileIdentifier: string;
  readonly bibliographicFileIdentifier: string;
  readonly created: Date | undefined;
  readonly modified: Date | undefined;
  readonly expires: Date | undefined;
  readonly effective: Date | undefined;
  readonly fileStructureVersion: number;
  /** Every volume descriptor before the terminator, in order. */
  readonly descriptors: readonly VolumeDescriptorSummary[];
  /** A supplementary descriptor with a Joliet escape sequence is present (its names are not used). */
  readonly hasJoliet: boolean;
  /** The root directory carries SUSP/Rock Ridge entries (not used). */
  readonly hasRockRidge: boolean;
  /** The root directory. */
  readonly root: IsoEntry;
}

/** Why a path could not be used. */
export type IsoPathErrorReason = 'not-found' | 'not-a-directory' | 'is-a-directory';

/** A path that does not exist, or names the wrong kind of entry. */
export class IsoPathError extends Error {
  readonly path: string;
  readonly reason: IsoPathErrorReason;

  constructor(path: string, reason: IsoPathErrorReason) {
    const what = {
      'not-found': 'no such file or directory',
      'not-a-directory': 'not a directory',
      'is-a-directory': 'is a directory',
    }[reason];
    super(`${path === '' ? '/' : path}: ${what}`);
    this.name = 'IsoPathError';
    this.path = path;
    this.reason = reason;
  }
}

/** Opens a disc image: reads the volume descriptors and the root directory. */
export async function openIso(source: BlockSource, options: IsoOptions = {}): Promise<IsoImage> {
  const checkBothEndian = options.checkBothEndian ?? true;
  if (source.size < DESCRIPTORS_OFFSET + SECTOR_SIZE) {
    throw new FormatError(`ISO 9660: image of ${source.size} bytes is too small to hold a volume descriptor`);
  }
  const descriptors: VolumeDescriptorSummary[] = [];
  let primary: ByteReader | undefined;
  let hasJoliet = false;
  for (let index = 0; ; index++) {
    const sector = 16 + index;
    const offset = sector * SECTOR_SIZE;
    if (index >= MAX_DESCRIPTORS || offset + SECTOR_SIZE > source.size) {
      throw new FormatError('ISO 9660: no volume descriptor set terminator', DESCRIPTORS_OFFSET);
    }
    const reader = new ByteReader(await readExactly(source, offset, SECTOR_SIZE), {
      order: 'le',
      name: 'ISO 9660',
      origin: offset,
    });
    const type = reader.u8();
    const identifier = reader.ascii(5);
    const version = reader.u8();
    if (identifier !== 'CD001') {
      throw reader.error(
        `volume descriptor ${index} has identifier ${JSON.stringify(identifier)}, not "CD001"`,
        offset,
      );
    }
    if (type === VolumeDescriptorType.terminator) break;
    descriptors.push({ type, version, sector });
    if (type === VolumeDescriptorType.primary) {
      primary ??= reader;
    } else if (type === VolumeDescriptorType.supplementary && isJolietEscape(reader.slice(88, 3).bytes)) {
      hasJoliet = true;
    }
  }
  if (primary === undefined) {
    throw new FormatError('ISO 9660: no primary volume descriptor', DESCRIPTORS_OFFSET);
  }
  const pvd = parsePrimary(primary, checkBothEndian);
  // SUSP requires its "SP" entry in the root directory's own "." record.
  const [dot] = await readDirectoryRecords(source, pvd.root, pvd.logicalBlockSize, checkBothEndian);
  const hasRockRidge = dot !== undefined && dot.identifier === '\0' && hasRockRidgeEntries(dot.systemUse);
  return new IsoImage(source, { ...pvd, descriptors, hasJoliet, hasRockRidge }, checkBothEndian);
}

type PrimaryFields = Omit<IsoVolumeInfo, 'descriptors' | 'hasJoliet' | 'hasRockRidge'>;

function parsePrimary(reader: ByteReader, check: boolean): PrimaryFields {
  reader.seek(8);
  const systemIdentifier = readTextField(reader, 32);
  const volumeLabel = readTextField(reader, 32);
  reader.skip(8);
  const volumeSpaceSize = bothU32(reader, 'volume space size', check);
  reader.skip(32);
  const volumeSetSize = bothU16(reader, 'volume set size', check);
  const volumeSequenceNumber = bothU16(reader, 'volume sequence number', check);
  const blockSizeAt = reader.origin + reader.position;
  const logicalBlockSize = bothU16(reader, 'logical block size', check);
  if (![512, 1024, 2048].includes(logicalBlockSize)) {
    throw reader.error(`unsupported logical block size ${logicalBlockSize}`, blockSizeAt);
  }
  const pathTableSize = bothU32(reader, 'path table size', check);
  reader.skip(16); // path table locations: not needed, the directories are read instead
  const rootRecord = parseDirectoryRecord(reader.take(34), check);
  const root = entryFor([rootRecord], '', '', logicalBlockSize);
  if (!root.isDirectory) {
    throw reader.error('the root directory record is not a directory', rootRecord.offset);
  }
  return {
    systemIdentifier,
    volumeLabel,
    volumeSpaceSize,
    volumeSetSize,
    volumeSequenceNumber,
    logicalBlockSize,
    pathTableSize,
    root,
    volumeSetIdentifier: readTextField(reader, 128),
    publisherIdentifier: readTextField(reader, 128),
    dataPreparerIdentifier: readTextField(reader, 128),
    applicationIdentifier: readTextField(reader, 128),
    copyrightFileIdentifier: readTextField(reader, 37),
    abstractFileIdentifier: readTextField(reader, 37),
    bibliographicFileIdentifier: readTextField(reader, 37),
    created: readVolumeDate(reader),
    modified: readVolumeDate(reader),
    expires: readVolumeDate(reader),
    effective: readVolumeDate(reader),
    fileStructureVersion: reader.u8(),
  };
}

interface Directory {
  readonly entries: readonly IsoEntry[];
  /** Entries by upper-case name. */
  readonly byName: ReadonlyMap<string, IsoEntry>;
}

/** An opened disc image. Create it with {@link openIso}. */
export class IsoImage implements IsoVolumeInfo {
  readonly source: BlockSource;
  readonly checkBothEndian: boolean;
  readonly systemIdentifier: string;
  readonly volumeLabel: string;
  readonly volumeSpaceSize: number;
  readonly volumeSetSize: number;
  readonly volumeSequenceNumber: number;
  readonly logicalBlockSize: number;
  readonly pathTableSize: number;
  readonly volumeSetIdentifier: string;
  readonly publisherIdentifier: string;
  readonly dataPreparerIdentifier: string;
  readonly applicationIdentifier: string;
  readonly copyrightFileIdentifier: string;
  readonly abstractFileIdentifier: string;
  readonly bibliographicFileIdentifier: string;
  readonly created: Date | undefined;
  readonly modified: Date | undefined;
  readonly expires: Date | undefined;
  readonly effective: Date | undefined;
  readonly fileStructureVersion: number;
  readonly descriptors: readonly VolumeDescriptorSummary[];
  readonly hasJoliet: boolean;
  readonly hasRockRidge: boolean;
  readonly root: IsoEntry;

  /** Parsed directories by the byte position of their records. */
  readonly #directories = new Map<number, Promise<Directory>>();

  constructor(source: BlockSource, info: IsoVolumeInfo, checkBothEndian: boolean) {
    this.source = source;
    this.checkBothEndian = checkBothEndian;
    this.systemIdentifier = info.systemIdentifier;
    this.volumeLabel = info.volumeLabel;
    this.volumeSpaceSize = info.volumeSpaceSize;
    this.volumeSetSize = info.volumeSetSize;
    this.volumeSequenceNumber = info.volumeSequenceNumber;
    this.logicalBlockSize = info.logicalBlockSize;
    this.pathTableSize = info.pathTableSize;
    this.volumeSetIdentifier = info.volumeSetIdentifier;
    this.publisherIdentifier = info.publisherIdentifier;
    this.dataPreparerIdentifier = info.dataPreparerIdentifier;
    this.applicationIdentifier = info.applicationIdentifier;
    this.copyrightFileIdentifier = info.copyrightFileIdentifier;
    this.abstractFileIdentifier = info.abstractFileIdentifier;
    this.bibliographicFileIdentifier = info.bibliographicFileIdentifier;
    this.created = info.created;
    this.modified = info.modified;
    this.expires = info.expires;
    this.effective = info.effective;
    this.fileStructureVersion = info.fileStructureVersion;
    this.descriptors = info.descriptors;
    this.hasJoliet = info.hasJoliet;
    this.hasRockRidge = info.hasRockRidge;
    this.root = info.root;
  }

  /** The entry at a path, or `undefined` if there is none. Case is ignored; `''` and `/` are the root. */
  async find(path: string): Promise<IsoEntry | undefined> {
    let entry = this.root;
    for (const segment of path.split('/')) {
      if (segment === '' || segment === '.') continue;
      if (!entry.isDirectory) return undefined;
      const next = (await this.#directory(entry)).byName.get(segment.toUpperCase());
      if (next === undefined) return undefined;
      entry = next;
    }
    return entry;
  }

  /** The entry at a path; throws {@link IsoPathError} if there is none. */
  async stat(path: string): Promise<IsoEntry> {
    const entry = await this.find(path);
    if (entry === undefined) throw new IsoPathError(path, 'not-found');
    return entry;
  }

  /** The entries of a directory (the root by default), in disc order, without `.` and `..`. */
  async listDirectory(target: string | IsoEntry = this.root): Promise<readonly IsoEntry[]> {
    const entry = typeof target === 'string' ? await this.stat(target) : target;
    if (!entry.isDirectory) throw new IsoPathError(entry.path, 'not-a-directory');
    return (await this.#directory(entry)).entries;
  }

  /** Every file and directory below the root, depth first, each directory before its contents. */
  walk(): AsyncGenerator<IsoEntry> {
    return this.#walk(this.root, new Set());
  }

  async *#walk(directory: IsoEntry, visited: Set<number>): AsyncGenerator<IsoEntry> {
    const position = directory.extents[0]?.position ?? -1;
    if (visited.has(position)) {
      throw new FormatError(`ISO 9660: directory ${directory.path} is reached twice`, position);
    }
    visited.add(position);
    for (const entry of await this.listDirectory(directory)) {
      yield entry;
      if (entry.isDirectory) yield* this.#walk(entry, visited);
    }
  }

  /** The whole content of a file. */
  async readFile(target: string | IsoEntry): Promise<Uint8Array> {
    const entry = await this.#file(target);
    return this.#readRange(entry, 0, entry.size);
  }

  /** `length` bytes of a file from `offset`; the range must lie within the file. */
  async readFileRange(target: string | IsoEntry, offset: number, length: number): Promise<Uint8Array> {
    const entry = await this.#file(target);
    const valid = Number.isSafeInteger(offset) && Number.isSafeInteger(length) && offset >= 0 && length >= 0;
    if (!valid || offset + length > entry.size) {
      throw new RangeError(
        `${entry.path}: range ${offset}+${length} is outside the file (${entry.size} bytes)`,
      );
    }
    return this.#readRange(entry, offset, length);
  }

  async #file(target: string | IsoEntry): Promise<IsoEntry> {
    const entry = typeof target === 'string' ? await this.stat(target) : target;
    if (entry.isDirectory) throw new IsoPathError(entry.path, 'is-a-directory');
    if (entry.interleaved) {
      throw new FormatError(
        `ISO 9660: ${entry.path} is recorded in interleaved mode, which is not supported`,
      );
    }
    return entry;
  }

  async #readRange(entry: IsoEntry, offset: number, length: number): Promise<Uint8Array> {
    const pieces: Uint8Array[] = [];
    let skip = offset;
    let left = length;
    for (const extent of entry.extents) {
      if (left === 0) break;
      if (skip >= extent.length) {
        skip -= extent.length;
        continue;
      }
      const count = Math.min(extent.length - skip, left);
      pieces.push(await readExactly(this.source, extent.position + skip, count));
      skip = 0;
      left -= count;
    }
    if (pieces.length === 1) return pieces[0]!;
    const result = new Uint8Array(length);
    let at = 0;
    for (const piece of pieces) {
      result.set(piece, at);
      at += piece.length;
    }
    return result;
  }

  #directory(entry: IsoEntry): Promise<Directory> {
    const key = entry.extents[0]?.position ?? -1;
    let directory = this.#directories.get(key);
    if (directory === undefined) {
      directory = this.#loadDirectory(entry);
      directory.catch(() => this.#directories.delete(key));
      this.#directories.set(key, directory);
    }
    return directory;
  }

  async #loadDirectory(directory: IsoEntry): Promise<Directory> {
    const records = await readDirectoryRecords(
      this.source,
      directory,
      this.logicalBlockSize,
      this.checkBothEndian,
    );
    const entries: IsoEntry[] = [];
    const byName = new Map<string, IsoEntry>();
    for (let i = 0; i < records.length; i++) {
      const record = records[i]!;
      if (record.identifier === '\0' || record.identifier === '\x01') continue; // "." and ".."
      // A multi-extent file is a run of records with the same identifier; all but the last are flagged.
      const run = [record];
      while (run[run.length - 1]!.flags & FileFlags.multiExtent) {
        const next = records[++i];
        if (next === undefined || next.identifier !== record.identifier) {
          throw new FormatError(
            `ISO 9660: multi-extent file ${record.identifier} has no final extent`,
            record.offset,
          );
        }
        run.push(next);
      }
      if (record.flags & FileFlags.associated) continue;
      const { name } = displayName(record.identifier);
      if (name === '' || name === '.' || name === '..' || /[/\\\0]/.test(name)) {
        throw new FormatError(
          `ISO 9660: invalid file identifier ${JSON.stringify(record.identifier)}`,
          record.offset,
        );
      }
      const entry = entryFor(run, directory.path, name, this.logicalBlockSize);
      // Versions of a name are recorded highest first; keep only that one.
      const key = entry.name.toUpperCase();
      if (byName.has(key)) continue;
      byName.set(key, entry);
      entries.push(entry);
    }
    return { entries, byName };
  }
}

/** Every record of a directory, including "." and "..". */
async function readDirectoryRecords(
  source: BlockSource,
  directory: IsoEntry,
  blockSize: number,
  checkBothEndian: boolean,
): Promise<DirectoryRecord[]> {
  const [extent, ...more] = directory.extents;
  if (extent === undefined || more.length > 0) {
    throw new FormatError(
      `ISO 9660: directory ${directory.path || '/'} has ${directory.extents.length} extents`,
    );
  }
  const bytes = await readExactly(source, extent.position, extent.length);
  const records: DirectoryRecord[] = [];
  for (let blockStart = 0; blockStart < bytes.length; blockStart += blockSize) {
    const block = new ByteReader(bytes.subarray(blockStart, Math.min(blockStart + blockSize, bytes.length)), {
      order: 'le',
      name: 'ISO 9660',
      origin: extent.position + blockStart,
    });
    // Records never cross a block boundary; a zero length byte pads out the rest of the block.
    let at = 0;
    while (at < block.length) {
      const length = block.bytes[at]!;
      if (length === 0) break;
      records.push(parseDirectoryRecord(block.slice(at), checkBothEndian));
      at += length;
    }
  }
  return records;
}

function entryFor(
  run: readonly DirectoryRecord[],
  parent: string,
  name: string,
  blockSize: number,
): IsoEntry {
  const first = run[0]!;
  const extents = run.map((record) => ({
    position: (record.extent + record.extendedAttributeLength) * blockSize,
    length: record.dataLength,
  }));
  return {
    name,
    path: parent === '' ? name : `${parent}/${name}`,
    isDirectory: (first.flags & FileFlags.directory) !== 0,
    size: extents.reduce((sum, extent) => sum + extent.length, 0),
    extents,
    modified: first.recorded,
    hidden: (first.flags & FileFlags.hidden) !== 0,
    version: displayName(first.identifier).version,
    interleaved: run.some((record) => record.fileUnitSize !== 0 || record.interleaveGap !== 0),
  };
}

/** Reads from the source, checking bounds and the length returned. */
async function readExactly(source: BlockSource, offset: number, length: number): Promise<Uint8Array> {
  if (offset + length > source.size) {
    throw new FormatError(
      `ISO 9660: ${length} bytes at ${offset} run past the end of the ${source.size}-byte image`,
      offset,
    );
  }
  const bytes = await source.read(offset, length);
  if (bytes.length !== length) {
    throw new FormatError(`ISO 9660: the image returned ${bytes.length} bytes instead of ${length}`, offset);
  }
  return bytes;
}

/** Joliet marks its supplementary descriptor with escape sequence `%/@`, `%/C` or `%/E` (UCS-2 levels 1–3). */
function isJolietEscape(escapes: Uint8Array): boolean {
  return escapes[0] === 0x25 && escapes[1] === 0x2f && [0x40, 0x43, 0x45].includes(escapes[2] ?? 0);
}
