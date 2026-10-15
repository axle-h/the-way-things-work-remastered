// The rules of the artefact check (check-no-disc-data.ts): a packaged app must hold Electron, our
// code and our icons, and nothing from the disc. Each file of a package, including each file inside
// its app.asar, is judged by its name, its first bytes, its SHA-256 and its size. Pure, so that it is
// unit-tested on synthetic files.
import { TWTW_DISC } from '../src/main/identity.ts';

/** How much of each file the rules look at: enough to reach an ISO 9660 volume descriptor. */
export const HEAD_BYTES = 40 * 1024;
/** Our own files are small (the whole web build is a few hundred KB); many disc files are larger. */
export const MAX_APP_FILE_BYTES = 1024 * 1024;
/** The whole app.asar: our code, the web build and the icons. */
export const MAX_ASAR_BYTES = 8 * 1024 * 1024;

export interface ScannedFile {
  /** `/`-separated, relative to the package; inside an asar, `…/app.asar/<member>`. */
  readonly path: string;
  readonly size: number;
  /** The first {@link HEAD_BYTES} bytes (fewer for a smaller file). */
  readonly head: Uint8Array;
  /** SHA-256, lower-case hex. */
  readonly sha256: string;
  /** Inside an app.asar: our own files, where nothing large belongs. */
  readonly inAsar: boolean;
}

/** File names of the disc's kinds, in any case. */
const DISC_NAMES = [/\.ani$/i, /\.dib$/i, /\.wav$/i, /\.iso$/i, /(^|\/)twtw\.png$/i, /(^|\/)twtw\.exe$/i];

/**
 * Electron's own large files, by name (Linux, Windows and macOS): the executables, shared libraries,
 * resource packs, ICU data, V8 snapshots and the Chromium licences.
 */
const RUNTIME_FILES = [
  /(^|\/)the-way-things-work(\.exe)?$/,
  /(^|\/)(chrome_crashpad_handler|chrome-sandbox)$/,
  /\.(so(\.\d+)*|dll|dylib|pak)$/i,
  /(^|\/)icudtl\.dat$/,
  /(^|\/)(snapshot_blob|v8_context_snapshot(\.arm64|\.x86_64)?)\.bin$/,
  /(^|\/)LICENSES\.chromium\.html$/,
  // macOS: the executables of the app and its helper apps, and the frameworks' binaries.
  /\.app\/Contents\/MacOS\/[^/]+$/,
  /\.framework\/Versions\/[^/]+\/[^/.]+$/,
  /\.framework\/Versions\/[^/]+\/(Helpers|Resources)\/[^/.]+$/,
];

export function isRuntimeFile(path: string): boolean {
  return RUNTIME_FILES.some((pattern) => pattern.test(path));
}

/** What is wrong with a file, if anything. */
export function problemsOf(file: ScannedFile): string[] {
  const problems: string[] = [];
  const name = file.path.slice(file.path.lastIndexOf('/') + 1);
  if (DISC_NAMES.some((pattern) => pattern.test(file.path))) problems.push('named like a disc file');
  if (name.toLowerCase() === 'manifest.json') problems.push('a data manifest (manifest.json)');
  const kind = discContent(file.head);
  if (kind !== null) problems.push(`contents look like ${kind}`);
  if (file.sha256 === TWTW_DISC.databaseSha256) problems.push(`is the disc's ${TWTW_DISC.databasePath}`);
  if (file.inAsar && file.size > MAX_APP_FILE_BYTES) {
    problems.push(`${file.size} bytes inside the app, over ${MAX_APP_FILE_BYTES}`);
  } else if (
    !file.inAsar &&
    file.size > MAX_APP_FILE_BYTES &&
    !/\.asar$/.test(name) &&
    !isRuntimeFile(file.path)
  ) {
    problems.push(`an unknown file of ${file.size} bytes, over ${MAX_APP_FILE_BYTES}`);
  }
  return problems;
}

/** Recognises the disc's file kinds by their first bytes, from the specs in docs/formats/. */
export function discContent(head: Uint8Array): string | null {
  const ascii = (at: number, text: string): boolean =>
    head.length >= at + text.length && [...text].every((char, i) => head[at + i] === char.charCodeAt(0));
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const u16 = (at: number): number => (head.length >= at + 2 ? view.getUint16(at, true) : -1);
  const u32 = (at: number): number => (head.length >= at + 4 ? view.getUint32(at, true) : -1);
  // RIFF WAVE (wav.md).
  if (ascii(0, 'RIFF') && ascii(8, 'WAVE')) return 'a WAVE sound';
  // A Windows bitmap file: BITMAPFILEHEADER, then a 40-byte BITMAPINFOHEADER (dib-and-palette.md).
  if (ascii(0, 'BM') && u32(14) === 40) return 'a Windows bitmap (DIB)';
  // PICS (pics.md): format marker 1, a 16-byte sound format, then a chunk with the `funky!` filler.
  if (u16(0) === 1 && u32(10) === 16 && ascii(52, 'funky!')) return 'a PICS animation';
  // ISO 9660: a volume descriptor at sector 16 (iso9660.md).
  if (ascii(32 * 1024 + 1, 'CD001')) return 'an ISO 9660 disc image';
  // A 16-bit Windows (NE) executable: `MZ`, and `NE` where the new header starts.
  if (ascii(0, 'MZ')) {
    const newHeader = u32(0x3c);
    if (newHeader > 0 && ascii(newHeader, 'NE')) return 'a 16-bit Windows program';
  }
  return null;
}
