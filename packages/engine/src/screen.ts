/** The original runs at a fixed 640×480 in 256 colours. */
export const SCREEN_WIDTH = 640;
export const SCREEN_HEIGHT = 480;

/** An 8-bit indexed framebuffer: one palette index per pixel, row by row from the top. */
export interface Framebuffer {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
}

export function createFramebuffer(width = SCREEN_WIDTH, height = SCREEN_HEIGHT): Framebuffer {
  return { width, height, pixels: new Uint8Array(width * height) };
}
