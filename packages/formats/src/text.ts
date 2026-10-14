/**
 * Windows-1252 ("ANSI" on Western Windows 3.1) text decoding, without `TextDecoder`, which this
 * DOM- and Node-free package cannot assume.
 *
 * Bytes 0x80–0x9F map through the public Windows-1252 table. The five bytes that table leaves
 * undefined (0x81, 0x8D, 0x8F, 0x90, 0x9D), and every byte outside 0x80–0x9F, map to the code
 * point of the same value, as the WHATWG Encoding Standard does.
 */

// Code points for bytes 0x80–0x9F.
const HIGH_CONTROL_RANGE: readonly number[] = [
  0x20ac, 0x0081, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152,
  0x008d, 0x017d, 0x008f, 0x0090, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122,
  0x0161, 0x203a, 0x0153, 0x009d, 0x017e, 0x0178,
];

/** Decodes Windows-1252 bytes to a string. */
export function decodeWindows1252(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) {
    const codePoint = byte >= 0x80 && byte <= 0x9f ? (HIGH_CONTROL_RANGE[byte - 0x80] ?? byte) : byte;
    text += String.fromCharCode(codePoint);
  }
  return text;
}

/** Encodes a string as Windows-1252, the inverse of {@link decodeWindows1252}. Throws on unmappable characters. */
export function encodeWindows1252(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const codePoint = text.charCodeAt(i);
    const high = HIGH_CONTROL_RANGE.indexOf(codePoint);
    if (high >= 0) {
      bytes[i] = 0x80 + high;
    } else if (codePoint <= 0xff && !(codePoint >= 0x80 && codePoint <= 0x9f)) {
      bytes[i] = codePoint;
    } else {
      throw new RangeError(`cannot encode U+${codePoint.toString(16).padStart(4, '0')} as Windows-1252`);
    }
  }
  return bytes;
}
