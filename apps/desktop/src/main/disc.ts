// The user's disc: a disc image (.iso) read in place through the ISO 9660
// reader, or a folder holding the disc's files (a CD in a drive, or a copy). Nothing is extracted or
// copied. Before it is used it is checked to be The Way Things Work as this app knows it: the image's
// volume label, and the SHA-256 of the page database (identity.ts). No Electron imports, so it is
// unit-tested.
import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { IsoDataSource, type DataSource, type Manifest } from '@twtw/engine';
import { openIso } from '@twtw/formats';
import { DirectoryDataSource, openFileSource } from '@twtw/node';
import type { DiscKind } from '@twtw/web/desktop-bridge';
import { TWTW_DISC, type DiscIdentity } from './identity.ts';

/** A checked disc, open for reading. */
export interface OpenDisc extends DataSource {
  readonly kind: DiscKind;
  /** The image file or folder. */
  readonly path: string;
  /** Every file, for `/data/manifest.json`. */
  readonly manifest: Manifest;
  close(): Promise<void>;
}

/** A disc that cannot be used, with a reason to show the user. */
export class DiscRejected extends Error {
  constructor(reason: string, options?: ErrorOptions) {
    super(reason, options);
    this.name = 'DiscRejected';
  }
}

/** Opens and checks a disc image or folder. Rejects with {@link DiscRejected} if it is not the disc. */
export function openDisc(kind: DiscKind, path: string, identity = TWTW_DISC): Promise<OpenDisc> {
  return kind === 'iso' ? openImage(path, identity) : openFolder(path, identity);
}

async function openImage(path: string, identity: DiscIdentity): Promise<OpenDisc> {
  let file;
  try {
    file = await openFileSource(path);
  } catch (error) {
    throw new DiscRejected(`This file cannot be opened (${describe(error)}).`, { cause: error });
  }
  try {
    let iso;
    try {
      iso = await openIso(file);
    } catch (error) {
      throw new DiscRejected('This file is not a CD image (.iso).', { cause: error });
    }
    if (iso.volumeLabel !== identity.volumeLabel) {
      const label = iso.volumeLabel === '' ? 'no label' : `the label “${iso.volumeLabel}”`;
      throw new DiscRejected(`This CD image is not The Way Things Work: it has ${label}.`);
    }
    const source = await IsoDataSource.open(iso);
    await checkDatabase(source, identity);
    return {
      kind: 'iso',
      path,
      manifest: source.manifest,
      read: (name) => source.read(name),
      exists: (name) => source.exists(name),
      close: () => file.close(),
    };
  } catch (error) {
    await file.close();
    throw error;
  }
}

async function openFolder(path: string, identity: DiscIdentity): Promise<OpenDisc> {
  // Looked for before anything else: a wrong folder could hold any number of files to walk.
  if (!(await hasFile(path, identity.databasePath))) {
    throw new DiscRejected(
      `This folder is not The Way Things Work disc: it has no ${identity.databasePath}. ` +
        'Choose the top folder of the CD.',
    );
  }
  let source: DirectoryDataSource;
  try {
    source = await DirectoryDataSource.open(path);
  } catch (error) {
    throw new DiscRejected(`This folder cannot be read (${describe(error)}).`, { cause: error });
  }
  await checkDatabase(source, identity);
  return {
    kind: 'directory',
    path,
    manifest: source.manifest,
    read: (name) => source.read(name),
    exists: (name) => source.exists(name),
    close: () => Promise.resolve(),
  };
}

async function checkDatabase(source: DataSource, identity: DiscIdentity): Promise<void> {
  let bytes: Uint8Array;
  try {
    bytes = await source.read(identity.databasePath);
  } catch (error) {
    throw new DiscRejected(`This disc has no readable ${identity.databasePath}.`, { cause: error });
  }
  if (sha256(bytes) !== identity.databaseSha256) {
    throw new DiscRejected(
      'This looks like The Way Things Work, but not the 1994 edition this app plays ' +
        `(its ${identity.databasePath} is different).`,
    );
  }
}

/** SHA-256 in lower-case hex. */
export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Whether `root` holds a file at a `/`-separated relative path, ignoring case (CDs are upper case). */
async function hasFile(root: string, relative: string): Promise<boolean> {
  let directory = root;
  const parts = relative.split('/');
  for (const [index, part] of parts.entries()) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return false;
    }
    const last = index === parts.length - 1;
    const match = entries.find(
      (entry) =>
        entry.name.toUpperCase() === part.toUpperCase() && (last ? entry.isFile() : entry.isDirectory()),
    );
    if (match === undefined) return false;
    directory = join(directory, match.name);
  }
  return true;
}

function describe(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'ENOENT') return 'it is not there';
  if (code === 'EACCES' || code === 'EPERM') return 'permission denied';
  if (code === 'EISDIR') return 'it is a folder';
  return error instanceof Error ? error.message : String(error);
}
