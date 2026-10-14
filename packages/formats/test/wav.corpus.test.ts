/**
 * Corpus test: parses and decodes every `*.WAV` on the disc, checking the invariants in
 * docs/formats/wav.md. A second suite compares our decoding with ffmpeg's, an independent public
 * decoder, when `ffmpeg` is installed. Only counts and invariants are asserted; no disc content
 * is stored in the repository.
 */
import { execFile, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { beforeAll, expect, it } from 'vitest';
import {
  decodeMsAdpcm,
  decodeWave,
  msAdpcmSampleCount,
  parseWave,
  WAVE_FORMAT_MS_ADPCM,
  WAVE_FORMAT_PCM,
  type WaveFile,
} from '../src/index.ts';
import { STANDARD_MS_ADPCM_COEFFICIENTS } from '../src/testing/index.ts';
import { describeIfAvailable, discFile, discFileSet, missingDiscFile } from './disc.ts';

const execFileAsync = promisify(execFile);

/** The three plain 8-bit PCM sounds; every other WAV is MS-ADPCM. */
const PCM_FILES = ['azaz/dial.wav', 'nav/rzm.wav', 'nav/zm.wav'];
const SAMPLE = 'WORKSHOP/WWWW0M0S.WAV';

const wavPaths = (): string[] => [...discFileSet()].filter((path) => path.endsWith('.wav')).sort();
const discBytes = (path: string): Uint8Array => readFileSync(discFile(path.toUpperCase()) ?? '');

describeIfAvailable('WAV corpus (disc)', missingDiscFile(SAMPLE), () => {
  let paths: string[];
  const waves = new Map<string, WaveFile>();

  beforeAll(() => {
    paths = wavPaths();
    for (const path of paths) waves.set(path, parseWave(discBytes(path), path));
  });

  it('parses all 100 files, consuming each exactly', () => {
    expect(paths).toHaveLength(100);
    for (const wave of waves.values()) {
      expect(wave.trailingBytes).toBe(0);
      expect(wave.format).toMatchObject({ channels: 1, samplesPerSecond: 22050 });
    }
  });

  it('has 97 MS-ADPCM files with 512-byte blocks and the standard coefficients', () => {
    const adpcm = [...waves].filter(([, wave]) => wave.format.formatTag === WAVE_FORMAT_MS_ADPCM);
    expect(adpcm).toHaveLength(97);
    for (const [, wave] of adpcm) {
      expect(wave.chunks.map((chunk) => chunk.id)).toEqual(['fmt ', 'fact', 'data']);
      expect(wave.format).toMatchObject({ blockAlign: 512, bitsPerSample: 4, averageBytesPerSecond: 11179 });
      expect(wave.adpcm).toEqual({
        channels: 1,
        blockAlign: 512,
        samplesPerBlock: 1012,
        coefficients: STANDARD_MS_ADPCM_COEFFICIENTS,
      });
    }
  });

  it('has 3 plain 8-bit PCM files without a fact chunk', () => {
    const pcm = [...waves].filter(([, wave]) => wave.format.formatTag === WAVE_FORMAT_PCM);
    expect(pcm.map(([path]) => path)).toEqual(PCM_FILES);
    for (const [, wave] of pcm) {
      expect(wave.chunks.map((chunk) => chunk.id)).toEqual(['fmt ', 'data']);
      expect(wave.format).toMatchObject({ bitsPerSample: 8, blockAlign: 1, extension: null });
    }
  });

  it('decodes every file; the fact count equals the decoded length, or exceeds it by one in 23 files', () => {
    const factMinusDecoded: Record<string, number> = {};
    for (const wave of waves.values()) {
      const decoded = decodeWave(wave);
      expect(decoded.channels).toHaveLength(1);
      expect(decoded.sampleRate).toBe(22050);
      for (const v of decoded.channels[0] ?? []) {
        if (!(v >= -1 && v < 1)) expect.fail(`sample ${v} out of range`);
      }
      if (wave.adpcm === null) {
        expect(decoded.length).toBe(wave.data.length);
        continue;
      }
      expect(decoded.length).toBe(msAdpcmSampleCount(wave.data.length, wave.adpcm));
      const key = String((wave.factSampleCount ?? NaN) - decoded.length);
      factMinusDecoded[key] = (factMinusDecoded[key] ?? 0) + 1;
    }
    expect(factMinusDecoded).toEqual({ '0': 74, '1': 23 });
  });
});

const ffmpegMissing = (): string | null => {
  const missing = missingDiscFile(SAMPLE);
  if (missing !== null) return missing;
  const probe = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  return probe.status === 0 ? null : 'ffmpeg is not installed';
};

describeIfAvailable('WAV decoding vs ffmpeg (disc)', ffmpegMissing(), () => {
  it('matches ffmpeg sample for sample on every file', { timeout: 60_000 }, async () => {
    const compare = async (path: string): Promise<string | null> => {
      const bytes = discBytes(path);
      const wave = parseWave(bytes, path);
      const ours =
        wave.adpcm === null
          ? Int16Array.from(wave.data, (byte) => (byte - 128) << 8)
          : (decodeMsAdpcm(wave.data, wave.adpcm)[0] ?? new Int16Array(0));
      const out = await ffmpegToS16(discFile(path.toUpperCase()) ?? '');
      const theirs = new Int16Array(out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength));
      const differing = ours.findIndex((v, i) => v !== theirs[i]);
      return theirs.length === ours.length && differing < 0
        ? null
        : `${path}: ${ours.length} vs ${theirs.length} samples, first difference at ${differing}`;
    };
    const paths = wavPaths();
    const mismatches: string[] = [];
    // A few ffmpeg processes at a time.
    for (let i = 0; i < paths.length; i += 8) {
      const results = await Promise.all(paths.slice(i, i + 8).map(compare));
      mismatches.push(...results.filter((result) => result !== null));
    }
    expect(paths).toHaveLength(100);
    expect(mismatches).toEqual([]);
  });
});

/** Decodes a file with ffmpeg to signed 16-bit little-endian mono samples. */
async function ffmpegToS16(file: string): Promise<Buffer> {
  const { stdout } = await execFileAsync(
    'ffmpeg',
    ['-v', 'error', '-i', file, '-f', 's16le', '-acodec', 'pcm_s16le', 'pipe:1'],
    { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 },
  );
  return stdout;
}
