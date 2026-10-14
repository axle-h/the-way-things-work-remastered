// Conversion of the engine's indexed framebuffer to RGBA happens here, at present time only
// (docs/PLAN.md §3, "Framebuffer").

/** Converts palette indices to RGBA through a palette of RGB triplets, into `out` (4 bytes per pixel). */
export function indexedToRgba(pixels: Uint8Array, palette: Uint8Array, out: Uint8ClampedArray): void {
  for (let i = 0, o = 0; i < pixels.length; i++, o += 4) {
    const p = pixels[i]! * 3;
    out[o] = palette[p]!;
    out[o + 1] = palette[p + 1]!;
    out[o + 2] = palette[p + 2]!;
    out[o + 3] = 255;
  }
}
