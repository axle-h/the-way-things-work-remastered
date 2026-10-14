# Sounds (`*.WAV`)

**[V]** Standard RIFF WAVE files with a `fmt ` chunk of format tag 2 (**Microsoft ADPCM**), mono, 22,050 Hz, 512-byte blocks, and a `data` chunk. MS-ADPCM is publicly documented: per block, a predictor index, an initial delta and two seed samples, followed by 4-bit nibbles using the standard coefficient table and adaptation table from the `fmt ` extension. Browsers do not decode MS-ADPCM, so the remake decodes it itself.

The original plays these through the Windows ACM codec it ships (`DKCODE/MSADPCM.ACM`). The remake does not need that codec.

Animation sound is not stored in WAV files; it is embedded as 8-bit PCM in the `.ANI` files (see `pics.md`).
