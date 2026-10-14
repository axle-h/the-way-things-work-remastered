/** The original runs at a fixed 640×480 in 256 colours. */
export const SCREEN_WIDTH = 640;
export const SCREEN_HEIGHT = 480;

/**
 * The original main window's client area on Windows 3.1 (docs/formats/rendering.md §1). Base pages
 * cover exactly this area, drawn at framebuffer (0,0). Pixels to the right and below it are not
 * part of the original client: the engine leaves them at index 0 unless a popup reaches into them,
 * and a presenter may crop them away.
 */
export const CLIENT_WIDTH = 638;
export const CLIENT_HEIGHT = 459;

/** An 8-bit indexed image: one palette index per pixel, row by row from the top, no padding. */
export interface IndexedImage {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
}

/** The engine's 640×480 indexed framebuffer. */
export type Framebuffer = IndexedImage;

export function createFramebuffer(width = SCREEN_WIDTH, height = SCREEN_HEIGHT): Framebuffer {
  return { width, height, pixels: new Uint8Array(width * height) };
}
