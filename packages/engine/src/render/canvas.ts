import type { IndexedImage } from '../screen.ts';

/** A rectangle with exclusive right and bottom edges. */
export interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/**
 * A clipped, translated view of an indexed image to draw into. Coordinates passed to its methods
 * are local: (0,0) is the view's origin. Nothing is ever drawn outside its clip box or the image.
 *
 * The original paints each panel into an off-screen bitmap of the panel's size and copies it to
 * the window (rendering.md §3). Drawing straight into the framebuffer through a view clipped to
 * the panel gives the same pixels.
 */
export class IndexedCanvas {
  readonly image: IndexedImage;
  /** Image position of local (0,0). */
  readonly originX: number;
  readonly originY: number;
  /** In image coordinates, within the image bounds. */
  readonly clip: Box;

  constructor(image: IndexedImage, originX = 0, originY = 0, clip?: Box) {
    this.image = image;
    this.originX = originX;
    this.originY = originY;
    const bounds = { left: 0, top: 0, right: image.width, bottom: image.height };
    this.clip = clip === undefined ? bounds : intersect(clip, bounds);
  }

  /**
   * A view whose origin is local (x, y), clipped to the local rectangle (x, y, width, height) as
   * well as to this view's clip.
   */
  view(x: number, y: number, width: number, height: number): IndexedCanvas {
    const left = this.originX + x;
    const top = this.originY + y;
    const clip = intersect(this.clip, { left, top, right: left + width, bottom: top + height });
    return new IndexedCanvas(this.image, left, top, clip);
  }

  /** Fills the local rectangle (x, y, width, height) with a palette index. */
  fill(x: number, y: number, width: number, height: number, index: number): void {
    const box = this.#toImage(x, y, width, height);
    if (box === null) return;
    const { pixels, width: stride } = this.image;
    for (let row = box.top; row < box.bottom; row++) {
      pixels.fill(index, row * stride + box.left, row * stride + box.right);
    }
  }

  /**
   * Copies part of a picture, opaque and unscaled: the source rectangle (sx, sy, width, height),
   * itself clipped to the picture, lands with its top-left at local (x, y).
   */
  draw(
    picture: IndexedImage,
    x: number,
    y: number,
    sx = 0,
    sy = 0,
    width = picture.width - sx,
    height = picture.height - sy,
  ): void {
    // Clip the source rectangle to the picture, moving the destination with it.
    if (sx < 0) [x, width, sx] = [x - sx, width + sx, 0];
    if (sy < 0) [y, height, sy] = [y - sy, height + sy, 0];
    width = Math.min(width, picture.width - sx);
    height = Math.min(height, picture.height - sy);
    const box = this.#toImage(x, y, width, height);
    if (box === null) return;
    const srcLeft = sx + (box.left - (this.originX + x));
    const srcTop = sy + (box.top - (this.originY + y));
    const { pixels, width: stride } = this.image;
    const span = box.right - box.left;
    for (let row = box.top; row < box.bottom; row++) {
      const from = (srcTop + row - box.top) * picture.width + srcLeft;
      pixels.set(picture.pixels.subarray(from, from + span), row * stride + box.left);
    }
  }

  /**
   * Replaces each pixel of the local rectangle by `map(index, imageX, imageY)`. The coordinates
   * passed to `map` are image (framebuffer) coordinates, for patterns aligned to the screen.
   */
  map(
    x: number,
    y: number,
    width: number,
    height: number,
    map: (index: number, imageX: number, imageY: number) => number,
  ): void {
    const box = this.#toImage(x, y, width, height);
    if (box === null) return;
    const { pixels, width: stride } = this.image;
    for (let row = box.top; row < box.bottom; row++) {
      for (let column = box.left; column < box.right; column++) {
        const at = row * stride + column;
        pixels[at] = map(pixels[at]!, column, row);
      }
    }
  }

  /** The local rectangle in image coordinates, clipped; `null` when nothing is left. */
  #toImage(x: number, y: number, width: number, height: number): Box | null {
    if (width <= 0 || height <= 0) return null;
    const left = this.originX + x;
    const top = this.originY + y;
    const box = intersect(this.clip, { left, top, right: left + width, bottom: top + height });
    return box.left < box.right && box.top < box.bottom ? box : null;
  }
}

export function intersect(a: Box, b: Box): Box {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  return {
    left,
    top,
    right: Math.max(left, Math.min(a.right, b.right)),
    bottom: Math.max(top, Math.min(a.bottom, b.bottom)),
  };
}
