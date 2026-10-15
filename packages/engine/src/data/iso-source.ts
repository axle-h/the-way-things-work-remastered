import type { IsoEntry, IsoImage } from '@twtw/formats';
import type { Manifest, ManifestFile } from '../manifest.ts';
import { DataNotFoundError, type DataSource } from './data-source.ts';
import { FileIndex } from './file-index.ts';

/**
 * A {@link DataSource} over a disc image, read in place through the ISO 9660 reader: the desktop
 * app serves the user's `.iso` this way, without extracting it (docs/PLAN.md §3, "Data access").
 * Opening it walks the directory tree once; each read then asks the image's block source for just
 * that file's bytes.
 */
export class IsoDataSource implements DataSource {
  readonly iso: IsoImage;
  readonly index: FileIndex;
  /** Every file, as `pnpm data` would list it for the extracted disc. */
  readonly manifest: Manifest;
  /** File entries by stored path. */
  readonly #entries: ReadonlyMap<string, IsoEntry>;

  private constructor(iso: IsoImage, entries: ReadonlyMap<string, IsoEntry>) {
    this.iso = iso;
    this.#entries = entries;
    this.index = new FileIndex(entries.keys());
    const files: ManifestFile[] = [...entries.values()].map((entry) => ({
      path: entry.path,
      size: entry.size,
    }));
    files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    this.manifest = { version: 1, files };
  }

  /** Lists the image's files. Hidden files are served too: the disc has none (iso9660.md). */
  static async open(iso: IsoImage): Promise<IsoDataSource> {
    const entries = new Map<string, IsoEntry>();
    for await (const entry of iso.walk()) {
      if (!entry.isDirectory) entries.set(entry.path, entry);
    }
    return new IsoDataSource(iso, entries);
  }

  /** The image's volume label (`DKMMTWTW` for the disc). */
  get volumeLabel(): string {
    return this.iso.volumeLabel;
  }

  async read(path: string): Promise<Uint8Array> {
    const entry = this.#entry(path);
    if (entry === undefined) throw new DataNotFoundError(path);
    return this.iso.readFile(entry);
  }

  exists(path: string): Promise<boolean> {
    return Promise.resolve(this.#entry(path) !== undefined);
  }

  /** The file's size, or `undefined` if there is no such file. */
  sizeOf(path: string): number | undefined {
    return this.#entry(path)?.size;
  }

  #entry(path: string): IsoEntry | undefined {
    const stored = this.index.resolve(path);
    return stored === undefined ? undefined : this.#entries.get(stored);
  }
}
