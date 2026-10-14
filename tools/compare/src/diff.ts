/**
 * Pixel comparison of our rendering with a reference capture, and the classification of every
 * differing pixel: explained by the first mask that covers it, or unexplained.
 */
import type { Rect } from '@twtw/formats';
import type { RgbImage } from '@twtw/node';

/** Why a difference is expected. The descriptions are shown in the report. */
export const REASONS = {
  wineClientStrip:
    'Wine paints only 634×454 of the client; the rest of the 638×459 capture stays black (rendering.md §10)',
  wineCaptionColour:
    "Wine's caption colours (frame 9E9E9E, active 3296FA) are not in the palette (rendering.md §7.3, §10)",
  azLamp: 'the A–Z machine lamp blinks once a second (rendering.md §6)',
  moviePlaying:
    "a Principles movie page: the panel's on_open SENDMESSAGE starts its AnimationControl (rendering.md §8)",
  wineAnimationStall:
    'Wine animation stall: the autostart animation stopped before its finished ChangePage (reference-environments.md, "Animations under Wine")',
  autostartAnimation: 'autostart animation frames over the page (rendering.md §8)',
  animationLeftover: 'frames of the animation that moved on to this page stay on screen (rendering.md §8)',
  referenceChanging: 'the reference was still changing here when it was captured (sidecar changingRect)',
} as const;

export type Reason = keyof typeof REASONS;

/** An area where differences are expected, for a reason. */
export interface Mask {
  readonly reason: Reason;
  /** Page coordinates, right and bottom exclusive. */
  readonly rect: Rect;
  /** What the mask covers, e.g. the object or file it comes from. */
  readonly detail: string;
  /** Only pixels whose reference colour is one of these (`0xRRGGBB`); any colour when absent. */
  readonly referenceColours?: readonly number[];
  /**
   * Only pixels whose reference colour this accepts at that position, e.g. a colour an animation
   * paints there in some frame. Not written to results.json.
   */
  readonly accepts?: (x: number, y: number, referenceColour: number) => boolean;
}

/** Per-pixel classes in {@link DiffResult.classes}. */
export const PixelClass = { same: 0, explained: 1, unexplained: 2 } as const;

export interface DiffResult {
  /** The compared area, from page (0,0). */
  readonly width: number;
  readonly height: number;
  readonly differing: number;
  readonly unexplained: number;
  /** Differing pixels explained by each reason. */
  readonly byReason: Partial<Record<Reason, number>>;
  /** One {@link PixelClass} per pixel of the area, row by row. */
  readonly classes: Uint8Array;
}

/** Compares `width × height` pixels from (0,0) of two RGB images and classifies the differences. */
export function diffImages(
  ours: RgbImage,
  reference: RgbImage,
  width: number,
  height: number,
  masks: readonly Mask[],
): DiffResult {
  if (width > Math.min(ours.width, reference.width) || height > Math.min(ours.height, reference.height)) {
    throw new Error(`compare area ${width}×${height} exceeds an image`);
  }
  const classes = new Uint8Array(width * height);
  const byReason: Partial<Record<Reason, number>> = {};
  let differing = 0;
  let unexplained = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = (y * ours.width + x) * 3;
      const b = (y * reference.width + x) * 3;
      const ref = (reference.rgb[b]! << 16) | (reference.rgb[b + 1]! << 8) | reference.rgb[b + 2]!;
      const our = (ours.rgb[a]! << 16) | (ours.rgb[a + 1]! << 8) | ours.rgb[a + 2]!;
      if (ref === our) continue;
      differing++;
      const mask = masks.find((m) => covers(m, x, y, ref));
      if (mask === undefined) {
        unexplained++;
        classes[y * width + x] = PixelClass.unexplained;
      } else {
        byReason[mask.reason] = (byReason[mask.reason] ?? 0) + 1;
        classes[y * width + x] = PixelClass.explained;
      }
    }
  }
  return { width, height, differing, unexplained, byReason, classes };
}

function covers(mask: Mask, x: number, y: number, referenceColour: number): boolean {
  const { rect } = mask;
  return (
    x >= rect.left &&
    x < rect.right &&
    y >= rect.top &&
    y < rect.bottom &&
    (mask.referenceColours === undefined || mask.referenceColours.includes(referenceColour)) &&
    (mask.accepts === undefined || mask.accepts(x, y, referenceColour))
  );
}

/**
 * Bounding boxes of the pixels of class `cls`, grouping pixels no more than `gap` apart, at most
 * `limit` boxes (the closest boxes are merged until they fit). Largest first.
 */
export function boundingBoxes(
  classes: Uint8Array,
  width: number,
  height: number,
  cls: number,
  gap = 3,
  limit = 12,
): Rect[] {
  // Union-find over the marked pixels; each joins marked pixels within `gap` above or to the left.
  const parent = new Int32Array(classes.length).fill(-1);
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root]!;
    while (parent[i] !== root) {
      const next = parent[i]!;
      parent[i] = root;
      i = next;
    }
    return root;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (classes[i] !== cls) continue;
      parent[i] = i;
      for (let dy = -gap; dy <= 0; dy++) {
        const ny = y + dy;
        if (ny < 0) continue;
        for (let dx = -gap; dx <= gap; dx++) {
          if (dy === 0 && dx >= 0) break;
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const j = ny * width + nx;
          if (parent[j] === -1) continue;
          const a = find(i);
          const b = find(j);
          if (a !== b) parent[a] = b;
        }
      }
    }
  }
  const boxes = new Map<number, { left: number; top: number; right: number; bottom: number }>();
  for (let i = 0; i < classes.length; i++) {
    if (parent[i] === -1) continue;
    const x = i % width;
    const y = (i - x) / width;
    const root = find(i);
    const box = boxes.get(root);
    if (box === undefined) {
      boxes.set(root, { left: x, top: y, right: x + 1, bottom: y + 1 });
    } else {
      box.left = Math.min(box.left, x);
      box.top = Math.min(box.top, y);
      box.right = Math.max(box.right, x + 1);
      box.bottom = Math.max(box.bottom, y + 1);
    }
  }
  let list: Rect[] = [...boxes.values()];
  // Many scattered boxes: first merge those whose centres share a cell of a coarsening grid.
  for (let cell = 16; list.length > 64; cell *= 2) {
    const cells = new Map<string, Rect>();
    for (const box of list) {
      const key = `${Math.floor((box.left + box.right) / 2 / cell)},${Math.floor((box.top + box.bottom) / 2 / cell)}`;
      const other = cells.get(key);
      cells.set(key, other === undefined ? box : union(other, box));
    }
    list = [...cells.values()];
  }
  // Then merge the pair that grows the least until the boxes fit the limit.
  while (list.length > limit) {
    let best = [0, 1];
    let bestGrowth = Infinity;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const growth = area(union(list[i]!, list[j]!)) - area(list[i]!) - area(list[j]!);
        if (growth < bestGrowth) {
          bestGrowth = growth;
          best = [i, j];
        }
      }
    }
    const [i, j] = best as [number, number];
    list[i] = union(list[i]!, list[j]!);
    list.splice(j, 1);
  }
  return list.sort((a, b) => area(b) - area(a));
}

export function union(a: Rect, b: Rect): Rect {
  return {
    left: Math.min(a.left, b.left),
    top: Math.min(a.top, b.top),
    right: Math.max(a.right, b.right),
    bottom: Math.max(a.bottom, b.bottom),
  };
}

function area(rect: Rect): number {
  return (rect.right - rect.left) * (rect.bottom - rect.top);
}

/** Diff image colours. */
const UNEXPLAINED = [255, 0, 64] as const;
const EXPLAINED = [255, 170, 0] as const;
const MASK_TINT = [40, 110, 255] as const;

/**
 * A picture of the comparison over the compared area: the reference faded to grey, masked areas
 * tinted blue, explained differences orange and unexplained ones red.
 */
export function diffPicture(reference: RgbImage, result: DiffResult, masks: readonly Mask[]): RgbImage {
  const { width, height, classes } = result;
  const masked = new Uint8Array(width * height);
  for (const { rect } of masks) {
    for (let y = Math.max(0, rect.top); y < Math.min(height, rect.bottom); y++) {
      masked.fill(
        1,
        y * width + Math.max(0, rect.left),
        y * width + Math.max(0, Math.min(width, rect.right)),
      );
    }
  }
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    const x = i % width;
    const y = (i - x) / width;
    const at = (y * reference.width + x) * 3;
    const out = i * 3;
    const cls = classes[i];
    if (cls === PixelClass.unexplained) {
      rgb.set(UNEXPLAINED, out);
    } else if (cls === PixelClass.explained) {
      rgb.set(EXPLAINED, out);
    } else {
      const grey =
        (reference.rgb[at]! * 77 + reference.rgb[at + 1]! * 150 + reference.rgb[at + 2]! * 29) >> 8;
      const faded = 160 + (grey * 95) / 255;
      for (let c = 0; c < 3; c++) {
        rgb[out + c] = masked[i] ? Math.round(faded * 0.6 + MASK_TINT[c]! * 0.4) : Math.round(faded);
      }
    }
  }
  return { width, height, rgb };
}
