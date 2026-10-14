# PICS animations (`*.ANI`)

DK's own animation format. It is not the Windows animated-cursor format that shares the extension. Each file interleaves 8-bit PCM sound with packed image rectangles that are drawn over the page's background picture. Status: structure **[V]**: 495 of 497 files parse and decode completely. The two failures (`PRINCIPL\QLVR\QLVR0M0A.ANI` and `PRINCIPL\QLVR\QLVR.ANI`) have damaged headers and are never referenced by the page database: their first chunk header holds garbage and lacks the `funky!` filler. Decoded frames (composited in order), rectangles and soundtracks match the private oracle's output for all 495 files (18,337 frames). Timing **[H]**. Provenance: open `1018:6810`, read chunk `1018:7160`, unpack `1000:6eba`, play loop `1018:6d1a`/`6e0a`.

All integers are **little-endian**.

## Header

| Offset | Type | Field |
|---|---|---|
| 0 | `u16` | format marker, always 1 |
| 2 | `u32` | number of frame chunks |
| 6 | `u16` | pre-roll factor A |
| 8 | `u16` | pre-roll factor B |
| 10 | `u32` | size of the sound format block that follows (16) |
| 14 | WAVEFORMAT | `u16` tag (1 = PCM), `u16` channels, `u32` samples/s, `u32` bytes/s, `u16` block align, `u16` bits; every file is PCM, mono, 22,050 Hz, 8-bit unsigned |

Then A × B **pre-roll chunks**, followed by the frame chunks. B may be 0 (11 files have A = 3, B = 0, so no pre-roll). On the disc A × B ranges from 0 to 10 [V].

## Chunk

| Offset | Type | Field |
|---|---|---|
| 0 | `u16` | chunk type, always 1 |
| 2 | `u32` | sound byte count `s` |
| 6 | 4 × `i16` | rectangle: left, top, right, bottom (picture coordinates) |
| 14 | `u32` | unpacked image size; 0 = no new image in this chunk |
| 18 | `u32` | packed image byte count `p` |
| 22 | 6 bytes | ASCII `funky!` (constant filler) |
| 28 | `s` bytes | PCM samples |
| 28 + s | `p` bytes | packed image |

Pre-roll chunks carry sound only (unpacked and packed sizes 0 in all 3,878 of them [V]). They let the player buffer audio ahead of the pictures.

[V] over the 22,215 chunks on the disc:
- the chunk type is always 1;
- a chunk with unpacked size 0 always has `p` = 0, and its rectangle holds arbitrary values (apparently whatever was in memory), so it must be ignored;
- the first frame chunks may also lack an image (some files have one more sound-only chunk than A × B).

## Image packing

The unpacked image covers the rectangle, at width `w = right − left` and height `h = bottom − top` (right and bottom exclusive; checked on 14,132 of the 14,134 images on the disc, the other two being in the damaged files). Rows are stored top-down, each padded to an even width `(w + 1) & ~1`, so the unpacked size equals that stride × `h`. Each byte is an index into the master palette (see `dib-and-palette.md`); the file carries no palette.

The packing is a PackBits-style run-length code. Read a control byte `c`:
- if `c` has the top bit set, copy the next `c & 0x7F` bytes literally;
- otherwise repeat the next byte `c` times.

Continue until the unpacked size is reached. Control bytes `0x00` and `0x80` (zero-length operations) never occur on the disc.

[V] 14,121 of the 14,132 images consume their `p` packed bytes exactly. The other 11 end with 2 superfluous bytes after the image is complete: a one-byte literal (`0x81` and a value). The decoder stops at the unpacked size and ignores them; writing that byte would overrun the image buffer.

Each image is opaque and replaces that rectangle of the current picture. Animations start from the page's main picture: for example, `TITLE\TITL0M0A.ANI` draws over `TITLE\TITL0M.DIB`.

## Sound and timing

The full soundtrack is all chunks' PCM concatenated in order, pre-roll included.

Timing model [H] (fits every file, but not confirmed in code): let `P` = A × B be the number of pre-roll chunks. The `k`-th frame chunk (chunk index `P + k`, counting all chunks from 0) becomes visible when the PCM of chunk index `k` starts playing, i.e. at `(sum of sound bytes in chunks 0..k−1) / bytes per second`. So each picture appears `P` chunks before the sound stored alongside it, and the pre-roll exists so that sound is already buffered when pictures start. Typical chunks carry 0.2 s of audio (5 frames per second). Some carry 0.25 s, 1/3 s, 0.5 s or 1 s. Trailing chunks with silent audio let the picture catch up with the pre-roll, so sound and picture end together.

Checks of the model against the data [V]: it gives strictly increasing frame times in all 495 files, and the last frame never comes after the end of the soundtrack. Chunks without any sound (`s` = 0, 1,447 of them) occur only at the end of a file. In 4 files (`CALC0Z0A`, `HOIS0M0A`, `REFR0M0A`, `SUBM0M1A`) the trailing chunks carry no sound rather than silence, so their last frame appears exactly when the sound ends. The private oracle's frame times agree with the model, but they are not independent evidence of how the original schedules frames.

## Worked example

`ARTICLE1/AIRP/AIRP0M0A.ANI` (the Airplane propeller): 5 frame images drawn over `AIRP0M.DIB` (540×450) show the propeller turning. Decoding and compositing the frames gives a plausible propeller animation (checked visually; a frame-by-frame comparison against the reference environment is still to do).
