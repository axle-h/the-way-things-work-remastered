// How the framebuffer is scaled onto the screen, and the one place where pointer positions are
// turned back into framebuffer (page) coordinates (docs/architecture.md, "Scaling rules"). Pure maths
// in device pixels, so it is tested in Node.
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '@twtw/engine';

/** A rectangle of the framebuffer, in framebuffer pixels. */
export interface Area {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The whole 640×480 framebuffer. */
export const FRAMEBUFFER_AREA: Area = { x: 0, y: 0, width: SCREEN_WIDTH, height: SCREEN_HEIGHT };

/**
 * The original's main window client area under Windows 3.1: 638×459 at the framebuffer's
 * top-left, where the page is drawn (rendering.md). Nothing outside it is part of the program.
 */
export const CLIENT_AREA: Area = { x: 0, y: 0, width: 638, height: 459 };

/**
 * The part of the framebuffer that is shown, scaled and hit-tested. Set it to
 * {@link FRAMEBUFFER_AREA} to show the full 640×480 framebuffer instead.
 */
export const PRESENTED_AREA: Area = CLIENT_AREA;

/** `fill`: as large as fits (the app's default); `integer`: the largest whole scale that fits. */
export type ScaleMode = 'integer' | 'fill';

/**
 * How the scale was chosen: a whole number ≥ 1; a non-integer one for fill mode; or `shrink`,
 * smaller than native because even 1× does not fit (pixels are lost; noted in the debug overlay).
 */
export type Fit = 'integer' | 'fill' | 'shrink';

/** Where the presented area is drawn in the canvas's backing store, all in device pixels. */
export interface StageLayout {
  /** Backing store size: the canvas's size in device pixels. */
  readonly backingWidth: number;
  readonly backingHeight: number;
  /** The framebuffer rectangle shown. */
  readonly area: Area;
  readonly fit: Fit;
  /** Device pixels per framebuffer pixel (a whole number for `integer`). */
  readonly scale: number;
  /** Where the area's top-left lands, and its drawn size (whole device pixels; centred). */
  readonly offsetX: number;
  readonly offsetY: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Fits `area` into a backing store of `backingWidth × backingHeight` device pixels: the largest
 * whole scale k ≥ 1 that fits, centred with letterboxing; below 1×, or in fill mode, the largest
 * scale that fits, drawn with nearest neighbour all the same.
 */
export function computeLayout(
  backingWidth: number,
  backingHeight: number,
  mode: ScaleMode = 'integer',
  area: Area = PRESENTED_AREA,
): StageLayout {
  const largest = Math.max(0, Math.min(backingWidth / area.width, backingHeight / area.height));
  const whole = Math.floor(largest);
  let fit: Fit;
  let scale: number;
  if (largest < 1) {
    fit = 'shrink';
    scale = largest;
  } else if (mode === 'fill' && largest !== whole) {
    fit = 'fill';
    scale = largest;
  } else {
    fit = 'integer';
    scale = whole;
  }
  const width = Math.max(1, Math.floor(area.width * scale));
  const height = Math.max(1, Math.floor(area.height * scale));
  return {
    backingWidth,
    backingHeight,
    area,
    fit,
    scale,
    offsetX: Math.floor((backingWidth - width) / 2),
    offsetY: Math.floor((backingHeight - height) / 2),
    width,
    height,
  };
}

/** The canvas element's box on the page, in CSS pixels (`getBoundingClientRect`). */
export interface ClientBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** A framebuffer position, and whether it is inside the presented area. */
export interface StagePoint {
  readonly x: number;
  readonly y: number;
  readonly inside: boolean;
}

/**
 * The framebuffer pixel under a client (CSS pixel) position: client → backing store (device
 * pixels) → framebuffer, through the layout's offset and scale. Points off the presented area
 * (the letterbox) give coordinates outside it, with `inside` false.
 */
export function clientToFramebuffer(
  layout: StageLayout,
  box: ClientBox,
  clientX: number,
  clientY: number,
): StagePoint {
  const { area } = layout;
  const backingX = box.width > 0 ? ((clientX - box.left) * layout.backingWidth) / box.width : 0;
  const backingY = box.height > 0 ? ((clientY - box.top) * layout.backingHeight) / box.height : 0;
  const x = area.x + Math.floor(((backingX - layout.offsetX) * area.width) / layout.width);
  const y = area.y + Math.floor(((backingY - layout.offsetY) * area.height) / layout.height);
  const inside = x >= area.x && x < area.x + area.width && y >= area.y && y < area.y + area.height;
  return { x, y, inside };
}

/**
 * The cursor images' scale in CSS pixels, so that on screen they match the stage's scale (each
 * cursor pixel about as large as a picture pixel), at least 1, and at most what browsers accept
 * for a 32-pixel cursor (128 CSS pixels).
 */
export function cursorScale(layout: StageLayout, devicePixelRatio: number): number {
  const ratio = devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.min(4, Math.max(1, Math.round(layout.scale / ratio)));
}

/**
 * Whether to show the "turn your device sideways" screen instead of the stage: a phone held
 * upright, i.e. a portrait viewport whose short side is under 500 CSS pixels. Tablets in portrait
 * (short side 500 or more) still show the stage, letterboxed.
 */
export function isPortraitPhone(cssWidth: number, cssHeight: number): boolean {
  return cssHeight > cssWidth && cssWidth < PORTRAIT_PHONE_MAX_WIDTH;
}

export const PORTRAIT_PHONE_MAX_WIDTH = 500;

/** One line for the debug overlay. */
export function describeLayout(layout: StageLayout, devicePixelRatio: number): string {
  const scale = layout.fit === 'integer' ? `${layout.scale}×` : `${layout.scale.toFixed(3)}×`;
  const fit = {
    integer: 'integer',
    fill: 'fill (non-integer nearest neighbour)',
    shrink: 'BELOW NATIVE: shrunk with nearest neighbour, pixels are lost',
  }[layout.fit];
  const { area } = layout;
  return (
    `stage ${scale} ${fit} · ${area.width}×${area.height} → ${layout.width}×${layout.height}` +
    ` in ${layout.backingWidth}×${layout.backingHeight} device px @${devicePixelRatio}`
  );
}
