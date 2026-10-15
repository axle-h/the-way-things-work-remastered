/**
 * Decoded pictures: `.DIB` files from the disc and bitmap resources of the original program,
 * each decoded once. Pixel values are master-palette indices and are used unchanged; the
 * pictures' own colour tables are ignored (rendering.md §4).
 */
import { decodeDib, readBitmapResource, type NeResourceKey, type NeResources } from '@twtw/formats';
import type { DataSource } from './data/data-source.ts';
import type { IndexedImage } from './screen.ts';

/** Bitmap resources of `TWTW.EXE` that the engine draws itself (program.md, Bitmaps). */
export const ProgramBitmap = {
  /** AnimationControl parts (rendering.md §5, playback.md §7). */
  animationControl: 101,
  /** Rewind, at rest (greyed). */
  animationRewind: 115,
  /** Play, at rest and paused. */
  animationPlay: 116,
  /** Rewind, while the movie is not at its start. */
  animationRewindActive: 117,
  /** Pause, while the movie plays. */
  animationPause: 119,
  /** Play, greyed: the movie has ended. */
  animationPlayEnded: 120,
  /** The progress indicator. */
  animationProgress: 159,
  cancel: 170,
  /** The CancelButton while pressed (behaviour.md §3). */
  cancelPressed: 171,
  lampOn: 172,
  lampOff: 173,
  /** The A–Z dial's pressed "go" button (behaviour.md §7). */
  dialGo: 352,
} as const;

/** Default budget for decoded `.DIB` files kept for reuse (pictures in use are held by pages). */
const DEFAULT_CACHE_BYTES = 64 * 1024 * 1024;

export class PictureStore {
  readonly #source: DataSource;
  readonly #program: NeResources;
  readonly #budget: number;
  /** Decoded files by lower-case path, least recently used first. */
  readonly #files = new Map<string, Promise<IndexedImage>>();
  readonly #sizes = new Map<string, number>();
  #bytes = 0;
  readonly #resources = new Map<string, IndexedImage>();

  constructor(source: DataSource, program: NeResources, cacheBytes = DEFAULT_CACHE_BYTES) {
    this.#source = source;
    this.#program = program;
    this.#budget = cacheBytes;
  }

  /** A `.DIB` file by disc path. Rejects if it is missing or cannot be decoded. */
  file(path: string): Promise<IndexedImage> {
    const key = path.toLowerCase();
    const cached = this.#files.get(key);
    if (cached !== undefined) {
      // Move to the most recently used end.
      this.#files.delete(key);
      this.#files.set(key, cached);
      return cached;
    }
    const loading = this.#source.read(path).then((bytes) => toImage(decodeDib(bytes, path)));
    this.#files.set(key, loading);
    loading.then(
      (image) => this.#account(key, image),
      () => this.#files.delete(key),
    );
    return loading;
  }

  /**
   * A bitmap resource of the program, by integer id or name (`@THUMB` or `THUMB`). The program is
   * already in memory, so this is synchronous. Throws if there is no such bitmap.
   */
  resource(id: NeResourceKey): IndexedImage {
    const name = typeof id === 'string' ? id.replace(/^@/, '').toUpperCase() : id;
    const key = String(name);
    let image = this.#resources.get(key);
    if (image === undefined) {
      image = toImage(readBitmapResource(this.#program, name));
      this.#resources.set(key, image);
    }
    return image;
  }

  #account(key: string, image: IndexedImage): void {
    if (!this.#files.has(key) || this.#sizes.has(key)) return;
    this.#sizes.set(key, image.pixels.length);
    this.#bytes += image.pixels.length;
    for (const oldest of this.#files.keys()) {
      if (this.#bytes <= this.#budget) break;
      const size = this.#sizes.get(oldest);
      if (size === undefined || oldest === key) continue; // still loading, or the newest
      this.#files.delete(oldest);
      this.#sizes.delete(oldest);
      this.#bytes -= size;
    }
  }
}

function toImage(dib: { width: number; height: number; indices: Uint8Array }): IndexedImage {
  return { width: dib.width, height: dib.height, pixels: dib.indices };
}
