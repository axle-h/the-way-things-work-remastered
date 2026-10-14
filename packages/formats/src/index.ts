// Decoders for the original disc formats, implemented from docs/formats/.
// This package is DOM-free so that it runs in Node as well as the browser.
export { ByteReader, FormatError, formatOffset, type ByteOrder, type ByteReaderOptions } from './reader.ts';
export { decodeWindows1252, encodeWindows1252 } from './text.ts';
export * from './pagedb/index.ts';
export * from './audio/index.ts';
export * from './pics/index.ts';
