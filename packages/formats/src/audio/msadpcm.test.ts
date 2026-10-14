import { describe, expect, it } from 'vitest';
import { FormatError } from '../reader.ts';
import { STANDARD_MS_ADPCM_COEFFICIENTS } from '../testing/wave-builder.ts';
import { ByteWriter } from '../writer.ts';
import { decodeMsAdpcm, msAdpcmBlockSamples, msAdpcmSampleCount, type MsAdpcmFormat } from './msadpcm.ts';

const coefficients = STANDARD_MS_ADPCM_COEFFICIENTS;
const mono = (blockAlign: number, samplesPerBlock = 2 + (blockAlign - 7) * 2): MsAdpcmFormat => ({
  channels: 1,
  blockAlign,
  samplesPerBlock,
  coefficients,
});

/** A mono block header: predictor, delta, newer seed, older seed. */
function monoHeader(predictor: number, delta: number, newer: number, older: number): ByteWriter {
  return new ByteWriter('le').u8(predictor).i16(delta).i16(newer).i16(older);
}

describe('decodeMsAdpcm, hand-computed', () => {
  it('outputs the older seed first, then predicts and adapts the step size', () => {
    // Predictor 1 (512, −256), delta 16, seeds 100 (newer) and 50 (older); codes 7 and 8 (= −8).
    //   (100·512 + 50·(−256)) / 256 = 150;  150 + 7·16 = 262;   delta = 614·16 >> 8 = 38
    //   (262·512 + 100·(−256)) / 256 = 424;  424 − 8·38 = 120;  delta = 768·38 >> 8 = 114
    const data = monoHeader(1, 16, 100, 50).u8(0x78).toBytes();
    const [samples] = decodeMsAdpcm(data, mono(8));
    expect([...(samples ?? [])]).toEqual([50, 100, 262, 120]);
  });

  it('keeps the step size at least 16 and truncates predictions toward zero', () => {
    // Predictor 5 (460, −208), delta 16, seeds −3 and 0; codes 0, 0.
    //   −3·460 / 256 = −5.39 → −5 (not −6);  delta = 230·16 >> 8 = 14 → 16
    //   (−5·460 + (−3)·(−208)) / 256 = −6.55 → −6
    const data = monoHeader(5, 16, -3, 0).u8(0x00).toBytes();
    const [samples] = decodeMsAdpcm(data, mono(8));
    expect([...(samples ?? [])]).toEqual([0, -3, -5, -6]);
  });

  it('clamps to 16 bits', () => {
    // Predictor 0 (256, 0): 32000 + 7·1000 → 32767; then −32768 + (−8)·delta stays at −32768.
    const high = monoHeader(0, 1000, 32000, 0).u8(0x70).toBytes();
    expect([...(decodeMsAdpcm(high, mono(8))[0] ?? [])]).toEqual([0, 32000, 32767, 32767]);
    const low = monoHeader(0, 1000, -32768, 0).u8(0x88).toBytes();
    expect([...(decodeMsAdpcm(low, mono(8))[0] ?? [])]).toEqual([0, -32768, -32768, -32768]);
  });

  it('decodes stereo: header fields per channel, nibbles alternating left and right', () => {
    // Left: predictor 0, delta 16, seeds 10/5, codes 1, 3 → 26, 74.
    // Right: predictor 0, delta 16, seeds −10/−5, codes 2, 0 → 22, 22.
    const data = new ByteWriter('le')
      .u8(0)
      .u8(0)
      .i16(16)
      .i16(16)
      .i16(10)
      .i16(-10)
      .i16(5)
      .i16(-5)
      .u8(0x12)
      .u8(0x30)
      .toBytes();
    const [left, right] = decodeMsAdpcm(data, {
      channels: 2,
      blockAlign: 16,
      samplesPerBlock: 4,
      coefficients,
    });
    expect([...(left ?? [])]).toEqual([5, 10, 26, 74]);
    expect([...(right ?? [])]).toEqual([-5, -10, 22, 22]);
  });

  it('resets the state at every block', () => {
    const block = monoHeader(0, 16, 100, 50).u8(0x11).toBytes();
    const [samples] = decodeMsAdpcm(new Uint8Array([...block, ...block]), mono(8));
    expect([...(samples ?? [])]).toEqual([50, 100, 116, 132, 50, 100, 116, 132]);
  });

  it('decodes a short last block by its byte length', () => {
    // 16-byte blocks hold 2 + 9·2 = 20 samples; a 10-byte last block holds 2 + 3·2 = 8.
    const format = mono(16);
    const full = monoHeader(0, 16, 0, 0).bytes(new Uint8Array(9).fill(0x11)).toBytes();
    const short = monoHeader(0, 16, 1, 2).bytes([0x11, 0x11, 0x11]).toBytes();
    const [samples] = decodeMsAdpcm(new Uint8Array([...full, ...short]), format);
    expect(samples).toHaveLength(28);
    expect([...samples!.subarray(20)]).toEqual([2, 1, 17, 33, 49, 65, 81, 97]);
    expect(msAdpcmSampleCount(26, format)).toBe(28);
    expect(msAdpcmBlockSamples(10, format)).toBe(8);
    expect(msAdpcmBlockSamples(7, format)).toBe(2);
  });

  it('caps a block at samplesPerBlock when blockAlign has room for more', () => {
    const data = monoHeader(0, 16, 0, 0).bytes([0x11, 0x11]).toBytes();
    expect(decodeMsAdpcm(data, mono(9, 3))[0]).toHaveLength(3);
  });

  it('rejects a fragment shorter than a block header, and unknown predictors', () => {
    const block = monoHeader(0, 16, 0, 0).u8(0).toBytes();
    expect(() => decodeMsAdpcm(new Uint8Array([...block, 0, 0]), mono(8))).toThrow(FormatError);
    expect(() => decodeMsAdpcm(new Uint8Array([...block, 0, 0]), mono(8))).toThrow(/2-byte fragment/);
    const bad = monoHeader(7, 16, 0, 0).u8(0).toBytes();
    expect(() => decodeMsAdpcm(bad, mono(8))).toThrow(/predictor 7 is outside the 7 coefficient pairs/);
  });

  it('returns no samples for no data', () => {
    expect(decodeMsAdpcm(new Uint8Array(0), mono(8))).toEqual([new Int16Array(0)]);
  });
});

describe('decodeMsAdpcm against a test encoder', () => {
  it('reproduces exactly what the encoder reconstructed, mono and stereo, with a short last block', () => {
    for (const channels of [1, 2]) {
      const blockAlign = 32 * channels;
      const samplesPerBlock = 2 + ((blockAlign - 7 * channels) * 2) / channels;
      const length = samplesPerBlock * 3 + 12;
      const input = Array.from({ length: channels }, (_, c) =>
        Array.from({ length }, (_, i) =>
          Math.round(12000 * Math.sin(i / (7 + 5 * c)) + 3000 * Math.sin(i / 2.3)),
        ),
      );
      const { data, reconstructed } = encodeMsAdpcm(input, blockAlign, samplesPerBlock);
      const decoded = decodeMsAdpcm(data, { channels, blockAlign, samplesPerBlock, coefficients });
      expect(decoded.map((s) => [...s])).toEqual(reconstructed);
      // And the codec is doing its job: the result follows the input.
      const error = decoded[0]!.reduce((max, v, i) => Math.max(max, Math.abs(v - input[0]![i]!)), 0);
      expect(error).toBeLessThan(4000);
    }
  });
});

/**
 * A small MS-ADPCM encoder for the test, written from the public description. Each block starts
 * from its first two input samples with delta 16 and, per channel, the predictor with the smallest
 * error; each code is the nearest step. It records the samples a decoder must reconstruct.
 */
function encodeMsAdpcm(
  input: number[][],
  blockAlign: number,
  samplesPerBlock: number,
): { data: Uint8Array; reconstructed: number[][] } {
  const adaptation = [230, 230, 230, 230, 307, 409, 512, 614, 768, 614, 512, 409, 307, 230, 230, 230];
  const channels = input.length;
  const length = input[0]!.length;
  const out = new ByteWriter('le');
  const reconstructed = input.map(() => [] as number[]);

  const encodeBlockChannel = (c: number, start: number, count: number, predictor: number) => {
    const [c1, c2] = coefficients[predictor]!;
    const samples = input[c]!;
    let older = samples[start]!;
    let newer = samples[start + 1]!;
    let delta = 16;
    const codes: number[] = [];
    const values = [older, newer];
    let error = 0;
    for (let i = start + 2; i < start + count; i++) {
      const prediction = Math.trunc((newer * c1 + older * c2) / 256);
      const code = Math.max(-8, Math.min(7, Math.round((samples[i]! - prediction) / delta)));
      const value = Math.max(-32768, Math.min(32767, prediction + code * delta));
      error += Math.abs(value - samples[i]!);
      codes.push(code & 0x0f);
      values.push(value);
      delta = Math.max(16, (adaptation[code & 0x0f]! * delta) >> 8);
      older = newer;
      newer = value;
    }
    return { codes, values, error };
  };

  for (let start = 0; start < length; start += samplesPerBlock) {
    const count = Math.min(samplesPerBlock, length - start);
    const best = Array.from({ length: channels }, (_, c) => {
      let chosen = { predictor: 0, ...encodeBlockChannel(c, start, count, 0) };
      for (let p = 1; p < coefficients.length; p++) {
        const attempt = encodeBlockChannel(c, start, count, p);
        if (attempt.error < chosen.error) chosen = { predictor: p, ...attempt };
      }
      return chosen;
    });
    for (const b of best) out.u8(b.predictor);
    for (let c = 0; c < channels; c++) out.i16(16);
    for (let c = 0; c < channels; c++) out.i16(input[c]![start + 1]!);
    for (let c = 0; c < channels; c++) out.i16(input[c]![start]!);
    const nibbles: number[] = [];
    for (let i = 0; i < count - 2; i++) for (const b of best) nibbles.push(b.codes[i]!);
    for (let i = 0; i < nibbles.length; i += 2) out.u8((nibbles[i]! << 4) | (nibbles[i + 1] ?? 0));
    if (count === samplesPerBlock) {
      while (out.length % blockAlign !== 0) out.u8(0);
    }
    best.forEach((b, c) => reconstructed[c]!.push(...b.values));
  }
  return { data: out.toBytes(), reconstructed };
}
