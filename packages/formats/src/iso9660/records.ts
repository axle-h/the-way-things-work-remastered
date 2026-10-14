/**
 * Low-level ISO 9660 (ECMA-119) structures: both-endian numbers, dates, identifiers and directory
 * records. See docs/formats/iso9660.md.
 */
import type { ByteReader } from '../reader.ts';

/** Size of a CD-ROM sector; the volume descriptors start at sector 16 whatever the block size. */
export const SECTOR_SIZE = 2048;
/** Byte offset of the first volume descriptor. */
export const DESCRIPTORS_OFFSET = 16 * SECTOR_SIZE;
/** Length of the fixed part of a directory record, before the file identifier. */
export const RECORD_FIXED_LENGTH = 33;

/** File flag bits of a directory record (ECMA-119 9.1.6). */
export const FileFlags = {
  /** "Existence": the file need not be shown to the user. */
  hidden: 0x01,
  directory: 0x02,
  /** An associated file (e.g. a Macintosh resource fork) sharing the name of another file. */
  associated: 0x04,
  /** The file's records are described by an extended attribute record. */
  record: 0x08,
  /** Owner and permissions are in an extended attribute record. */
  protection: 0x10,
  /** This is not the last extent of the file: the next record continues it. */
  multiExtent: 0x80,
} as const;

/** Reads a both-endian 16-bit number (LE then BE), using the LE half. */
export function bothU16(reader: ByteReader, field: string, check: boolean): number {
  const at = reader.origin + reader.position;
  const le = reader.u16le();
  const be = reader.u16be();
  if (check && le !== be) throw reader.error(`${field}: little-endian ${le} and big-endian ${be} differ`, at);
  return le;
}

/** Reads a both-endian 32-bit number (LE then BE), using the LE half. */
export function bothU32(reader: ByteReader, field: string, check: boolean): number {
  const at = reader.origin + reader.position;
  const le = reader.u32le();
  const be = reader.u32be();
  if (check && le !== be) throw reader.error(`${field}: little-endian ${le} and big-endian ${be} differ`, at);
  return le;
}

/** An a- or d-character field, with trailing spaces (and NULs) removed. */
export function readTextField(reader: ByteReader, length: number): string {
  return reader.ascii(length).replace(/[ \0]+$/, '');
}

/**
 * The 7-byte date of a directory record (ECMA-119 9.1.5): years since 1900, month, day, hour,
 * minute, second, and the offset from UTC in 15-minute units. All zero means "not specified".
 */
export function readRecordDate(reader: ByteReader): Date | undefined {
  const bytes = reader.bytesView(7);
  if (bytes.every((byte) => byte === 0)) return undefined;
  const [year = 0, month = 0, day = 0, hour = 0, minute = 0, second = 0, offset = 0] = bytes;
  const offsetQuarters = offset >= 0x80 ? offset - 0x100 : offset;
  return new Date(Date.UTC(1900 + year, month - 1, day, hour, minute, second) - offsetQuarters * 15 * 60_000);
}

/**
 * The 17-byte date of a volume descriptor (ECMA-119 8.4.26.1): `YYYYMMDDHHMMSScc` as digits, then
 * the offset from UTC in 15-minute units. All-zero digits (or bytes) mean "not specified".
 */
export function readVolumeDate(reader: ByteReader): Date | undefined {
  const at = reader.origin + reader.position;
  const digits = reader.ascii(16);
  const offset = reader.i8();
  if (/^[0\0]{16}$/.test(digits)) return undefined;
  if (!/^\d{16}$/.test(digits)) throw reader.error(`invalid volume date ${JSON.stringify(digits)}`, at);
  const part = (start: number, length: number): number => Number(digits.slice(start, start + length));
  const utc = Date.UTC(
    part(0, 4),
    part(4, 2) - 1,
    part(6, 2),
    part(8, 2),
    part(10, 2),
    part(12, 2),
    part(14, 2) * 10,
  );
  return new Date(utc - offset * 15 * 60_000);
}

/** A directory record as stored (ECMA-119 9.1). */
export interface DirectoryRecord {
  /** Absolute byte offset of the record in the image, for error messages. */
  readonly offset: number;
  /** Length of the extended attribute record, in logical blocks, before the file data. */
  readonly extendedAttributeLength: number;
  /** First logical block of the extent (including any extended attribute record). */
  readonly extent: number;
  /** Length of the extent's data in bytes. */
  readonly dataLength: number;
  readonly recorded: Date | undefined;
  readonly flags: number;
  readonly fileUnitSize: number;
  readonly interleaveGap: number;
  readonly volumeSequenceNumber: number;
  /** The file identifier bytes as characters (`\0` is "this directory", `\x01` the parent). */
  readonly identifier: string;
  /** The system use area, e.g. Rock Ridge entries. */
  readonly systemUse: Uint8Array;
}

/**
 * Parses one directory record. The reader must start at the record (its first byte being the
 * record length) and hold at least the whole record.
 */
export function parseDirectoryRecord(reader: ByteReader, checkBothEndian: boolean): DirectoryRecord {
  const offset = reader.origin;
  reader.seek(0);
  const length = reader.u8();
  if (length < RECORD_FIXED_LENGTH + 1) {
    throw reader.error(`directory record length ${length} is too short`, offset);
  }
  if (length > reader.length) {
    throw reader.error(
      `directory record of ${length} bytes overruns its block (${reader.length} left)`,
      offset,
    );
  }
  const extendedAttributeLength = reader.u8();
  const extent = bothU32(reader, 'extent location', checkBothEndian);
  const dataLength = bothU32(reader, 'data length', checkBothEndian);
  const recorded = readRecordDate(reader);
  const flags = reader.u8();
  const fileUnitSize = reader.u8();
  const interleaveGap = reader.u8();
  const volumeSequenceNumber = bothU16(reader, 'volume sequence number', checkBothEndian);
  const identifierLength = reader.u8();
  if (identifierLength === 0) throw reader.error('empty file identifier', offset);
  if (RECORD_FIXED_LENGTH + identifierLength > length) {
    throw reader.error(
      `file identifier of ${identifierLength} bytes overruns the ${length}-byte record`,
      offset,
    );
  }
  const identifier = reader.ascii(identifierLength);
  // A padding byte follows an even-length identifier, so that the system use area is word-aligned.
  const systemUseStart = RECORD_FIXED_LENGTH + identifierLength + (identifierLength % 2 === 0 ? 1 : 0);
  const systemUse = reader.bytes.subarray(Math.min(systemUseStart, length), length);
  return {
    offset,
    extendedAttributeLength,
    extent,
    dataLength,
    recorded,
    flags,
    fileUnitSize,
    interleaveGap,
    volumeSequenceNumber,
    identifier,
    systemUse,
  };
}

/**
 * The name shown for a file identifier: the `;n` version suffix and a trailing `.` (a file with no
 * extension) are removed, e.g. `README.TXT;1` → `README.TXT`, `INDEX.;1` → `INDEX`.
 */
export function displayName(identifier: string): { name: string; version: number | undefined } {
  const semicolon = identifier.lastIndexOf(';');
  let name = identifier;
  let version: number | undefined;
  if (semicolon >= 0) {
    name = identifier.slice(0, semicolon);
    const suffix = identifier.slice(semicolon + 1);
    if (/^\d+$/.test(suffix)) version = Number(suffix);
  }
  if (name.endsWith('.')) name = name.slice(0, -1);
  return { name, version };
}

/**
 * Whether a System Use area starts with the SUSP "SP" entry (`SP`, length 7, version 1, `BE EF`)
 * and holds a Rock Ridge entry (`RR`, `PX`, `NM`) or an extension reference (`ER`). Checked on the
 * root directory's own "." record, where SUSP requires "SP" to appear.
 */
export function hasRockRidgeEntries(systemUse: Uint8Array): boolean {
  const isSp =
    systemUse.length >= 7 &&
    systemUse[0] === 0x53 && // S
    systemUse[1] === 0x50 && // P
    systemUse[4] === 0xbe &&
    systemUse[5] === 0xef;
  if (!isSp) return false;
  let at = 0;
  while (at + 4 <= systemUse.length) {
    const signature = String.fromCharCode(systemUse[at] ?? 0, systemUse[at + 1] ?? 0);
    const length = systemUse[at + 2] ?? 0;
    if (['RR', 'PX', 'NM', 'ER'].includes(signature)) return true;
    if (length < 4) break;
    at += length;
  }
  return false;
}
