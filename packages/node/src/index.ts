// Node-only helpers for tests, tools and the desktop app's main process (never imported by the web
// app): data sources over a directory or a disc image file, the directory manifest, and PNG encoding
// and decoding for rendered frames and captures.
export { DirectoryDataSource } from './fs-source.ts';
export { openFileSource, type FileBlockSource } from './file-source.ts';
export { buildManifest } from './manifest.ts';
export { decodePng, encodeIndexedPng, encodeRgbPng, indexedToRgb, type RgbImage } from './png.ts';
