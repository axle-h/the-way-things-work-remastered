import { describe, expect, it } from 'vitest';
import { TWTW_DISC } from '../src/main/identity.ts';
import { discContent, isRuntimeFile, MAX_APP_FILE_BYTES, problemsOf, type ScannedFile } from './disc-scan.ts';

const file = (path: string, options: Partial<ScannedFile> = {}): ScannedFile => ({
  path,
  size: options.head?.length ?? 10,
  head: new Uint8Array(10),
  sha256: '0'.repeat(64),
  inAsar: false,
  ...options,
});

/** Synthetic heads with the signatures the specs describe (no disc bytes). */
function head(length: number, write: (view: DataView, bytes: Uint8Array) => void): Uint8Array {
  const bytes = new Uint8Array(length);
  write(new DataView(bytes.buffer), bytes);
  return bytes;
}
const ascii = (bytes: Uint8Array, at: number, text: string): void => {
  for (let i = 0; i < text.length; i++) bytes[at + i] = text.charCodeAt(i);
};

describe('problemsOf', () => {
  it('passes our own files and Electron', () => {
    for (const path of [
      'resources/app.asar/web/index.html',
      'resources/app.asar/web/icons/icon-512.png',
      'resources/app.asar/main.js',
      'locales/en-GB.pak',
    ]) {
      expect(problemsOf(file(path, { inAsar: path.includes('.asar/') }))).toEqual([]);
    }
    expect(problemsOf(file('the-way-things-work', { size: 200e6 }))).toEqual([]);
    expect(problemsOf(file('resources/app.asar', { size: 300e3 }))).toEqual([]);
  });

  it.each([
    'resources/app.asar/ARTICLE1/AIRP/AIRP0M.DIB',
    'x/airp.ani',
    'SOUND.Wav',
    'disc.iso',
    'DKCODE/TWTW.PNG',
    'twtw.exe',
  ])('fails a disc file name: %s', (path) => {
    expect(problemsOf(file(path))).toContain('named like a disc file');
  });

  it('fails a data manifest anywhere', () => {
    expect(problemsOf(file('resources/app.asar/data/manifest.json', { inAsar: true }))).toContain(
      'a data manifest (manifest.json)',
    );
  });

  it("fails the disc's page database under any name", () => {
    expect(problemsOf(file('resources/data.bin', { sha256: TWTW_DISC.databaseSha256 }))).toEqual([
      "is the disc's DKCODE/TWTW.PNG",
    ]);
  });

  it('fails large files in the app, and large unknown files beside it', () => {
    const large = MAX_APP_FILE_BYTES + 1;
    expect(problemsOf(file('resources/app.asar/web/a.js', { size: large, inAsar: true }))[0]).toMatch(
      /inside the app/,
    );
    expect(problemsOf(file('resources/blob.dat', { size: large }))[0]).toMatch(/an unknown file/);
    expect(problemsOf(file('resources/small.dat', { size: MAX_APP_FILE_BYTES }))).toEqual([]);
  });
});

describe('isRuntimeFile', () => {
  it.each([
    'the-way-things-work',
    'the-way-things-work.exe',
    'libffmpeg.so',
    'libvulkan.so.1',
    'ffmpeg.dll',
    'resources.pak',
    'icudtl.dat',
    'v8_context_snapshot.bin',
    'LICENSES.chromium.html',
    'chrome_crashpad_handler',
    'The Way Things Work.app/Contents/MacOS/The Way Things Work',
    'The Way Things Work.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework',
    'The Way Things Work.app/Contents/Frameworks/Squirrel.framework/Versions/A/Resources/ShipIt',
  ])('knows %s', (path) => {
    expect(isRuntimeFile(path)).toBe(true);
  });

  it.each(['data.bin', 'resources/blob', 'web/picture.png', 'app.asar.unpacked/x.node'])('not %s', (path) => {
    expect(isRuntimeFile(path)).toBe(false);
  });
});

describe('discContent', () => {
  it('recognises the disc kinds by their first bytes', () => {
    expect(discContent(head(16, (_, b) => (ascii(b, 0, 'RIFF'), ascii(b, 8, 'WAVE'))))).toBe('a WAVE sound');
    expect(discContent(head(54, (v, b) => (ascii(b, 0, 'BM'), v.setUint32(14, 40, true))))).toBe(
      'a Windows bitmap (DIB)',
    );
    const pics = head(64, (v, b) => {
      v.setUint16(0, 1, true);
      v.setUint32(10, 16, true);
      ascii(b, 52, 'funky!');
    });
    expect(discContent(pics)).toBe('a PICS animation');
    expect(discContent(head(40 * 1024, (_, b) => ascii(b, 32 * 1024 + 1, 'CD001')))).toBe(
      'an ISO 9660 disc image',
    );
    const ne = head(256, (v, b) => (ascii(b, 0, 'MZ'), v.setUint32(0x3c, 0x80, true), ascii(b, 0x80, 'NE')));
    expect(discContent(ne)).toBe('a 16-bit Windows program');
  });

  it('passes other files, including 32-bit Windows programs and PNGs', () => {
    const pe = head(256, (v, b) => (ascii(b, 0, 'MZ'), v.setUint32(0x3c, 0x80, true), ascii(b, 0x80, 'PE')));
    expect(discContent(pe)).toBeNull();
    expect(discContent(Uint8Array.of(0x89, 0x50, 0x4e, 0x47))).toBeNull();
    expect(discContent(new TextEncoder().encode('<!doctype html>'))).toBeNull();
    expect(discContent(new Uint8Array(0))).toBeNull();
  });
});
