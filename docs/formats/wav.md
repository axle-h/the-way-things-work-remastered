# Sounds (`*.WAV`)

**[V]** Standard RIFF WAVE files. All 100 on the disc are mono, 22,050 Hz:
- **97 are Microsoft ADPCM** (format tag 2), with 512-byte blocks;
- **3 are plain 8-bit unsigned PCM** (format tag 1): `AZAZ/DIAL.WAV`, `NAV/RZM.WAV` and `NAV/ZM.WAV`.

MS-ADPCM is publicly documented (Microsoft Multimedia Standards Update). Browsers do not decode it, so the remake decodes it itself.

The original plays these through the Windows ACM codec it ships (`DKCODE/MSADPCM.ACM`). The remake does not need that codec.

Animation sound is not stored in WAV files; it is embedded as 8-bit PCM in the `.ANI` files (see `pics.md`).

## File layout [V]

A RIFF file is `RIFF`, a `u32` size of the rest of the file, `WAVE`, then chunks. Each chunk is a four-character id, a `u32` body size and the body, padded to an even length. All integers are little-endian. On the disc the RIFF size always matches the file length, and nothing follows the form.

| File kind | Chunks, in order |
|---|---|
| MS-ADPCM | `fmt ` (50 bytes), `fact` (4 bytes), `data` |
| PCM | `fmt ` (16 bytes), `data` |

Some `data` chunks have an odd length; the pad byte follows them.

`fmt ` holds a WAVEFORMAT: `u16` format tag, `u16` channels, `u32` samples per second, `u32` average bytes per second, `u16` block align, `u16` bits per sample. A WAVEFORMATEX continues with a `u16` extension size and that many bytes. The MS-ADPCM extension is 32 bytes: `u16` samples per block, `u16` number of coefficient pairs, then the pairs as two `i16` each, scaled by 256.

On the disc, every MS-ADPCM file has block align 512, 4 bits per sample, 11,179 average bytes per second, 1,012 samples per block and the 7 standard coefficient pairs from the public description: (256, 0), (512, −256), (0, 0), (192, 64), (240, 0), (460, −208), (392, −232).

`fact` holds a `u32` sample count.

## MS-ADPCM decoding

From the public description; checked against ffmpeg's independent decoder, which agrees sample for sample on all 97 files **[V]**.

The data is split into blocks of `block align` bytes. Each block is independent. It starts with a header of 7 bytes per channel, stored field by field with one value per channel for each field:
1. `u8` predictor index into the coefficient pairs;
2. `i16` initial step size ("delta");
3. `i16` first seed sample ("sample 1", the newer);
4. `i16` second seed sample ("sample 2", the older).

The block's first two output samples are sample 2, then sample 1. Every remaining byte holds two 4-bit codes, high nibble first. With two channels the codes alternate left, right. Each code, read as a signed value −8 … 7, gives the next sample of its channel:
- prediction = (sample 1 × coefficient 1 + sample 2 × coefficient 2) / 256, with the division truncating toward zero;
- new sample = prediction + code × delta, clamped to −32,768 … 32,767;
- delta = delta × adaptation[code as unsigned 0 … 15] / 256, rounded down and at least 16, using the adaptation table 230, 230, 230, 230, 307, 409, 512, 614, 768, 614, 512, 409, 307, 230, 230, 230;
- sample 2 = sample 1, and sample 1 = new sample.

So a full block holds `2 + (block align − 7 × channels) × 2 / channels` samples per channel (1,012 here), capped at the `fmt ` samples-per-block value.

### The last block [V]

The last block may be shorter. It holds `2 + (bytes − 7 × channels) × 2 / channels` samples per channel, counted from its byte length.

The `fact` count equals that decoded length in 74 files and exceeds it by one in 23. In those 23, `fact` implies an odd number of codes in the last block. The likely cause [H] is that the encoder rounded the half-used last byte down when it wrote the `data` length, so the last code is not inside the `data` chunk (for the odd-length chunks, it may sit in the pad byte). The remake, like ffmpeg, decodes the `data` chunk only. It treats `fact` as an upper bound: a smaller count trims the padding code of a last block, while a larger one is ignored.

## PCM

8-bit samples are unsigned, with silence at 128; the remake maps them to (byte − 128) / 128. 16-bit samples, not used on the disc, are signed and map to value / 32,768.
