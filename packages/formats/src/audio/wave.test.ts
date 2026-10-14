import { describe, expect, it } from 'vitest';
import { FormatError } from '../reader.ts';
import {
  buildRiffWave,
  fmtChunk,
  msAdpcmExtension,
  STANDARD_MS_ADPCM_COEFFICIENTS,
} from '../testing/wave-builder.ts';
import { ByteWriter } from '../writer.ts';
import { decodePcm, int16ToFloat32, pcm8ToFloat32 } from './pcm.ts';
import { decodeWave, parseWave } from './wave.ts';

const u32 = (value: number): Uint8Array => new ByteWriter('le').u32(value).toBytes();
const ascii = (text: string): Uint8Array => Uint8Array.from(text, (c) => c.charCodeAt(0));

/** A mono MS-ADPCM fmt chunk with 16-byte blocks (20 samples per block). */
const adpcmFmt = (samplesPerBlock = 20): Uint8Array =>
  fmtChunk({
    formatTag: 2,
    channels: 1,
    samplesPerSecond: 22050,
    averageBytesPerSecond: 17640,
    blockAlign: 16,
    bitsPerSample: 4,
    extension: msAdpcmExtension(samplesPerBlock),
  });

/** One full 16-byte block (20 samples) and a 10-byte last block (8 samples). */
function adpcmData(): Uint8Array {
  const block = (newer: number, older: number, nibbleBytes: number): number[] => [
    ...new ByteWriter('le').u8(0).i16(16).i16(newer).i16(older).toBytes(),
    ...new Array<number>(nibbleBytes).fill(0x11),
  ];
  return new Uint8Array([...block(0, 0, 9), ...block(1, 2, 3)]);
}

describe('parseWave', () => {
  it('reads fmt, fact and data, and keeps unknown chunks with their pad bytes', () => {
    const bytes = buildRiffWave([
      { id: 'fmt ', data: adpcmFmt() },
      { id: 'LIST', data: [1, 2, 3] },
      { id: 'fact', data: u32(27) },
      { id: 'data', data: adpcmData() },
    ]);
    const wave = parseWave(bytes, 'TEST.WAV');
    expect(wave.chunks.map((c) => [c.id, c.offset, c.size])).toEqual([
      ['fmt ', 12, 50],
      ['LIST', 70, 3],
      ['fact', 82, 4],
      ['data', 94, 26],
    ]);
    expect([...(wave.chunks[1]?.data ?? [])]).toEqual([1, 2, 3]);
    expect(wave.riffSize).toBe(bytes.length - 8);
    expect(wave.trailingBytes).toBe(0);
    expect(wave.format).toMatchObject({
      formatTag: 2,
      channels: 1,
      samplesPerSecond: 22050,
      averageBytesPerSecond: 17640,
      blockAlign: 16,
      bitsPerSample: 4,
    });
    expect(wave.format.extension).toHaveLength(32);
    expect(wave.adpcm).toEqual({
      channels: 1,
      blockAlign: 16,
      samplesPerBlock: 20,
      coefficients: STANDARD_MS_ADPCM_COEFFICIENTS,
    });
    expect(wave.factSampleCount).toBe(27);
    expect(wave.data.byteOffset).toBe(102);
    expect(wave.data).toHaveLength(26);
  });

  it('tolerates a missing pad byte after an odd-sized last chunk, and reports trailing bytes', () => {
    const fmt = fmtChunk({
      formatTag: 1,
      channels: 1,
      samplesPerSecond: 22050,
      averageBytesPerSecond: 22050,
      blockAlign: 1,
      bitsPerSample: 8,
    });
    const padded = buildRiffWave([
      { id: 'fmt ', data: fmt },
      { id: 'data', data: [128, 255, 0] },
    ]);
    const unpadded = padded.slice(0, padded.length - 1);
    new DataView(unpadded.buffer).setUint32(4, unpadded.length - 8, true);
    expect([...parseWave(unpadded).data]).toEqual([128, 255, 0]);
    const withTrailer = new Uint8Array([...padded, 9, 9, 9]);
    expect(parseWave(withTrailer).trailingBytes).toBe(3);
  });

  describe('rejects malformed input with a FormatError', () => {
    const pcmFmt = fmtChunk({
      formatTag: 1,
      channels: 1,
      samplesPerSecond: 8000,
      averageBytesPerSecond: 8000,
      blockAlign: 1,
      bitsPerSample: 8,
    });
    const cases: [string, () => Uint8Array, RegExp][] = [
      ['not RIFF', () => ascii('RIFX\x04\x00\x00\x00WAVE'), /not a RIFF file/],
      ['not WAVE', () => ascii('RIFF\x04\x00\x00\x00AVI '), /not WAVE/],
      ['a RIFF size past the end', () => ascii('RIFF\x10\x00\x00\x00WAVE'), /RIFF size 16/],
      ['no fmt chunk', () => buildRiffWave([{ id: 'data', data: [1] }]), /no 'fmt ' chunk/],
      ['no data chunk', () => buildRiffWave([{ id: 'fmt ', data: pcmFmt }]), /no 'data' chunk/],
      [
        'a short fmt chunk',
        () =>
          buildRiffWave([
            { id: 'fmt ', data: [1, 0] },
            { id: 'data', data: [] },
          ]),
        /shorter/,
      ],
      [
        'a chunk past the end of the form',
        () => {
          const bytes = buildRiffWave([{ id: 'fmt ', data: pcmFmt }]);
          new DataView(bytes.buffer).setUint32(16, 1000, true);
          return bytes;
        },
        /chunk 'fmt ' of 1000 bytes/,
      ],
      [
        'stray bytes instead of a chunk header',
        () => {
          const bytes = new Uint8Array([...buildRiffWave([{ id: 'fmt ', data: pcmFmt }]), 1, 2, 3]);
          new DataView(bytes.buffer).setUint32(4, bytes.length - 8, true);
          return bytes;
        },
        /3 stray bytes/,
      ],
      [
        'an unsupported format tag',
        () =>
          buildRiffWave([
            { id: 'fmt ', data: fmtChunk({ ...fmtFields(), formatTag: 0x55 }) },
            { id: 'data', data: [] },
          ]),
        /unsupported format tag 85/,
      ],
      [
        'MS-ADPCM without an extension',
        () =>
          buildRiffWave([
            { id: 'fmt ', data: fmtChunk({ ...fmtFields(), formatTag: 2 }) },
            { id: 'data', data: [] },
          ]),
        /without an extension/,
      ],
      [
        'MS-ADPCM blocks too small for samplesPerBlock',
        () =>
          buildRiffWave([
            { id: 'fmt ', data: adpcmFmt(21) },
            { id: 'data', data: [] },
          ]),
        /cannot hold 21 samples/,
      ],
    ];
    for (const [name, build, message] of cases) {
      it(name, () => {
        expect(() => parseWave(build())).toThrow(FormatError);
        expect(() => parseWave(build())).toThrow(message);
      });
    }
  });
});

function fmtFields() {
  return {
    formatTag: 1,
    channels: 1,
    samplesPerSecond: 22050,
    averageBytesPerSecond: 11025,
    blockAlign: 16,
    bitsPerSample: 4,
  };
}

describe('decodeWave', () => {
  it('decodes MS-ADPCM, trimming to a smaller fact count', () => {
    const build = (fact: number | null): Uint8Array =>
      buildRiffWave([
        { id: 'fmt ', data: adpcmFmt() },
        ...(fact === null ? [] : [{ id: 'fact', data: u32(fact) }]),
        { id: 'data', data: adpcmData() },
      ]);
    const full = decodeWave(parseWave(build(null)));
    expect(full.sampleRate).toBe(22050);
    expect(full.length).toBe(28);
    // Last block: seeds 1 and 2 (older first), then +16 per code 1.
    expect([...full.channels[0]!.subarray(20)].map((v) => v * 32768)).toEqual([2, 1, 17, 33, 49, 65, 81, 97]);
    expect(decodeWave(parseWave(build(27))).length).toBe(27);
    // A fact count larger than the data holds (as on the disc for 23 files) does not add samples.
    expect(decodeWave(parseWave(build(29))).length).toBe(28);
  });

  it('decodes 8-bit and 16-bit PCM', () => {
    const pcm8 = buildRiffWave([
      {
        id: 'fmt ',
        data: fmtChunk({
          formatTag: 1,
          channels: 1,
          samplesPerSecond: 22050,
          averageBytesPerSecond: 22050,
          blockAlign: 1,
          bitsPerSample: 8,
        }),
      },
      { id: 'data', data: [0, 128, 255] },
    ]);
    expect(decodeWave(parseWave(pcm8)).channels).toEqual([new Float32Array([-1, 0, 127 / 128])]);
    const pcm16 = buildRiffWave([
      {
        id: 'fmt ',
        data: fmtChunk({
          formatTag: 1,
          channels: 2,
          samplesPerSecond: 44100,
          averageBytesPerSecond: 176400,
          blockAlign: 4,
          bitsPerSample: 16,
        }),
      },
      { id: 'data', data: new ByteWriter('le').i16(-32768).i16(16384).i16(0).i16(32767).toBytes() },
    ]);
    const decoded = decodeWave(parseWave(pcm16));
    expect(decoded.length).toBe(2);
    expect(decoded.channels).toEqual([new Float32Array([-1, 0]), new Float32Array([0.5, 32767 / 32768])]);
  });
});

describe('PCM conversion', () => {
  it('maps 8-bit unsigned PCM to −1 … 1', () => {
    expect(pcm8ToFloat32(new Uint8Array([0, 64, 128, 192, 255]))).toEqual(
      new Float32Array([-1, -0.5, 0, 0.5, 127 / 128]),
    );
  });

  it('maps 16-bit samples to −1 … 1', () => {
    expect(int16ToFloat32(new Int16Array([-32768, 0, 16384]))).toEqual(new Float32Array([-1, 0, 0.5]));
  });

  it('deinterleaves channels and ignores a partial frame', () => {
    expect(decodePcm(new Uint8Array([0, 255, 128, 128, 64]), 2, 8)).toEqual([
      new Float32Array([-1, 0]),
      new Float32Array([127 / 128, 0]),
    ]);
  });

  it('rejects unsupported sample sizes', () => {
    expect(() => decodePcm(new Uint8Array(4), 1, 24)).toThrow(FormatError);
  });
});
