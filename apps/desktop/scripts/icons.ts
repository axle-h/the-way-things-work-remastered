// Icon containers for the packaged app, made from the web app's PNG icons at package time: Windows
// `.ico` and macOS `.icns` both hold PNG images as they are.
//   ICO: a 6-byte header (0, type 1, count), a 16-byte entry per image (width and height, 0 for 256,
//        colours 0, reserved 0, planes 1, bits 32, size and offset as u32 LE), then the images.
//   ICNS: `icns` and the total length (u32 BE), then per image a type such as `ic09` (512×512 PNG)
//        and its length including that 8-byte header (u32 BE), then the PNG.

/** Width and height from a PNG's IHDR. */
export function pngSize(png: Uint8Array): { width: number; height: number } {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.length < 24 || !signature.every((byte, i) => png[i] === byte)) throw new Error('not a PNG');
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

export function icoFromPngs(pngs: readonly Uint8Array[]): Uint8Array {
  const header = 6 + 16 * pngs.length;
  const out = new Uint8Array(header + pngs.reduce((sum, png) => sum + png.length, 0));
  const view = new DataView(out.buffer);
  view.setUint16(2, 1, true);
  view.setUint16(4, pngs.length, true);
  let offset = header;
  pngs.forEach((png, i) => {
    const { width, height } = pngSize(png);
    if (width > 256 || height > 256)
      throw new Error(`an .ico image is at most 256×256, not ${width}×${height}`);
    const entry = 6 + 16 * i;
    out[entry] = width === 256 ? 0 : width;
    out[entry + 1] = height === 256 ? 0 : height;
    view.setUint16(entry + 4, 1, true);
    view.setUint16(entry + 6, 32, true);
    view.setUint32(entry + 8, png.length, true);
    view.setUint32(entry + 12, offset, true);
    out.set(png, offset);
    offset += png.length;
  });
  return out;
}

export function icnsFromPngs(images: readonly { type: string; png: Uint8Array }[]): Uint8Array {
  const length = 8 + images.reduce((sum, image) => sum + 8 + image.png.length, 0);
  const out = new Uint8Array(length);
  const view = new DataView(out.buffer);
  const ascii = (text: string, at: number): void => {
    if (!/^[ -~]{4}$/.test(text)) throw new Error(`bad icns type ${JSON.stringify(text)}`);
    for (let i = 0; i < 4; i++) out[at + i] = text.charCodeAt(i);
  };
  ascii('icns', 0);
  view.setUint32(4, length);
  let at = 8;
  for (const { type, png } of images) {
    pngSize(png);
    ascii(type, at);
    view.setUint32(at + 4, 8 + png.length);
    out.set(png, at + 8);
    at += 8 + png.length;
  }
  return out;
}
