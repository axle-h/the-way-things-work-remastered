/**
 * Linear PCM to floating point, for Web Audio (`AudioBuffer` channels hold `Float32Array`s in
 * −1 … 1). See docs/formats/wav.md and pics.md.
 */
import { FormatError } from '../reader.ts';

/** 8-bit unsigned PCM (silence = 128) to −1 … 127/128. */
export function pcm8ToFloat32(samples: Uint8Array): Float32Array {
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = ((samples[i] as number) - 128) / 128;
  return out;
}

/** Signed 16-bit samples to −1 … 32767/32768. */
export function int16ToFloat32(samples: Int16Array): Float32Array {
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = (samples[i] as number) / 32768;
  return out;
}

/**
 * Splits interleaved little-endian PCM (8-bit unsigned or 16-bit signed) into one `Float32Array`
 * per channel. A trailing partial frame is ignored.
 */
export function decodePcm(data: Uint8Array, channels: number, bitsPerSample: number): Float32Array[] {
  if (!Number.isInteger(channels) || channels < 1) throw new FormatError(`invalid channel count ${channels}`);
  if (bitsPerSample !== 8 && bitsPerSample !== 16) {
    throw new FormatError(`unsupported PCM sample size ${bitsPerSample} bits`);
  }
  const bytesPerFrame = channels * (bitsPerSample / 8);
  const frames = Math.floor(data.length / bytesPerFrame);
  const out = Array.from({ length: channels }, () => new Float32Array(frames));
  if (bitsPerSample === 8) {
    for (let f = 0; f < frames; f++) {
      for (let c = 0; c < channels; c++) {
        (out[c] as Float32Array)[f] = ((data[f * channels + c] as number) - 128) / 128;
      }
    }
  } else {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    for (let f = 0; f < frames; f++) {
      for (let c = 0; c < channels; c++) {
        (out[c] as Float32Array)[f] = view.getInt16((f * channels + c) * 2, true) / 32768;
      }
    }
  }
  return out;
}
