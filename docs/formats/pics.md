# PICS animations (`*.ANI`)

DK's own animation format. It is not the Windows animated-cursor format that shares the extension. Each file interleaves 8-bit PCM sound with packed image rectangles that are drawn over the page's background picture. Status: structure **[V]**: 495 of 497 files parse and decode completely. The two failures (`PRINCIPL\QLVR\QLVR0M0A.ANI` and `PRINCIPL\QLVR\QLVR.ANI`) have damaged headers and are never referenced by the page database. Timing **[H]**. Provenance: open `1018:6810`, read chunk `1018:7160`, unpack `1000:6eba`, play loop `1018:6d1a`/`6e0a`.

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

Then A × B **pre-roll chunks**, followed by the frame chunks.

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

Pre-roll chunks carry sound only. They let the player buffer audio ahead of the pictures.

## Image packing

The unpacked image covers the rectangle, at width `w = right − left` and height `h = bottom − top` (right and bottom exclusive; checked on 14,132 of the 14,134 images on the disc, the other two being in the damaged files). Rows are stored top-down, each padded to an even width `(w + 1) & ~1`, so the unpacked size equals that stride × `h`. Each byte is an index into the master palette (see `dib-and-palette.md`); the file carries no palette.

The packing is a PackBits-style run-length code. Read a control byte `c`:
- if `c` has the top bit set, copy the next `c & 0x7F` bytes literally;
- otherwise repeat the next byte `c` times.

Continue until the unpacked size is reached.

Each image is opaque and replaces that rectangle of the current picture. Animations start from the page's main picture: for example, `TITLE\TITL0M0A.ANI` draws over `TITLE\TITL0M.DIB`.

## Sound and timing

The full soundtrack is all chunks' PCM concatenated in order, pre-roll included.

Timing model [H] (fits every file, but not confirmed in code): let `P` = A × B be the number of pre-roll chunks. The `k`-th frame chunk (chunk index `P + k`, counting all chunks from 0) becomes visible when the PCM of chunk index `k` starts playing, i.e. at `(sum of sound bytes in chunks 0..k−1) / bytes per second`. So each picture appears `P` chunks before the sound stored alongside it, and the pre-roll exists so that sound is already buffered when pictures start. Typical chunks carry 0.2 s of audio (5 frames per second). Some carry 0.25 s, 1/3 s or 1 s. Trailing chunks with silent audio let the picture catch up with the pre-roll, so sound and picture end together.

## Worked example

`ARTICLE1/AIRP/AIRP0M0A.ANI` (the Airplane propeller): 5 frame images drawn over `AIRP0M.DIB` (540×450) show the propeller turning. Decoding and compositing the frames gives a plausible propeller animation (checked visually; a frame-by-frame comparison against the reference environment is still to do).
