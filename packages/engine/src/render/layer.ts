/**
 * What has been drawn over a panel since it was last painted at rest: animation frames
 * (playback.md §3). The original draws frames straight to the screen and never restores the
 * picture, so a frame stays until something draws over it or the panel is repainted (a page
 * change, or the area being uncovered by a window). The engine composes the screen from state on
 * every render, so the panel keeps those pixels here, with a mask of which ones are set, and
 * paints them over its objects.
 */
import { intersect, type Box, type IndexedCanvas } from './canvas.ts';

/** An opaque image to draw at its rectangle, rows `stride` bytes apart (a decoded PICS frame). */
export interface LayerImage {
  readonly rect: { readonly left: number; readonly top: number };
  readonly width: number;
  readonly height: number;
  readonly stride: number;
  readonly indices: Uint8Array;
}

export class PanelLayer {
  readonly width: number;
  readonly height: number;
  #pixels: Uint8Array | null = null;
  #mask: Uint8Array | null = null;
  /** Bounding box of the set pixels; `null` when none is set. */
  #bounds: Box | null = null;

  constructor(width: number, height: number) {
    this.width = Math.max(0, width);
    this.height = Math.max(0, height);
  }

  /** Whether nothing is drawn. */
  get empty(): boolean {
    return this.#bounds === null;
  }

  /** The bounding box of what is drawn, in panel coordinates. */
  get bounds(): Box | null {
    return this.#bounds;
  }

  /** The palette index drawn at (x, y), or `null` if nothing is. */
  pixelAt(x: number, y: number): number | null {
    if (this.#mask === null || x < 0 || y < 0 || x >= this.width || y >= this.height) return null;
    const at = y * this.width + x;
    return this.#mask[at] === 0 ? null : this.#pixels![at]!;
  }

  /** Draws an image opaquely at its rectangle (panel coordinates), clipped to the panel. */
  draw(image: LayerImage): void {
    const { left, top } = image.rect;
    const box = intersect(
      { left, top, right: left + image.width, bottom: top + image.height },
      { left: 0, top: 0, right: this.width, bottom: this.height },
    );
    if (box.left >= box.right || box.top >= box.bottom) return;
    const size = this.width * this.height;
    this.#pixels ??= new Uint8Array(size);
    this.#mask ??= new Uint8Array(size);
    const span = box.right - box.left;
    for (let y = box.top; y < box.bottom; y++) {
      const from = (y - top) * image.stride + (box.left - left);
      const to = y * this.width + box.left;
      this.#pixels.set(image.indices.subarray(from, from + span), to);
      this.#mask.fill(1, to, to + span);
    }
    this.#bounds =
      this.#bounds === null
        ? box
        : {
            left: Math.min(this.#bounds.left, box.left),
            top: Math.min(this.#bounds.top, box.top),
            right: Math.max(this.#bounds.right, box.right),
            bottom: Math.max(this.#bounds.bottom, box.bottom),
          };
  }

  /** Forgets what is drawn in a rectangle (panel coordinates, right and bottom exclusive). */
  clear(rect: Box): void {
    const bounds = this.#bounds;
    if (bounds === null || this.#mask === null) return;
    const box = intersect(rect, bounds);
    if (box.left >= box.right || box.top >= box.bottom) return;
    if (
      box.left === bounds.left &&
      box.top === bounds.top &&
      box.right === bounds.right &&
      box.bottom === bounds.bottom
    ) {
      this.clearAll();
      return;
    }
    for (let y = box.top; y < box.bottom; y++) {
      this.#mask.fill(0, y * this.width + box.left, y * this.width + box.right);
    }
  }

  clearAll(): void {
    if (this.#mask !== null && this.#bounds !== null) {
      const { left, top, right, bottom } = this.#bounds;
      for (let y = top; y < bottom; y++) this.#mask.fill(0, y * this.width + left, y * this.width + right);
    }
    this.#bounds = null;
  }

  /** Takes over what another layer of the same size shows (a panel kept across a page change). */
  adopt(other: PanelLayer): void {
    if (other.width !== this.width || other.height !== this.height || other.#bounds === null) return;
    this.#pixels = other.#pixels!.slice();
    this.#mask = other.#mask!.slice();
    this.#bounds = other.#bounds;
  }

  /** Paints the set pixels into a canvas whose origin is the panel's top-left. */
  paint(canvas: IndexedCanvas): void {
    if (this.#bounds === null) return;
    canvas.drawMasked(this.#pixels!, this.#mask!, this.width, this.#bounds);
  }
}
