# Pictures (`*.DIB`) and the master palette

## DIB files [V]

All 1,698 `.DIB` files are standard Windows device-independent bitmaps: a `BITMAPFILEHEADER` followed by a 40-byte `BITMAPINFOHEADER`, 8 bits per pixel, compression `BI_RLE8` (1), and a 256-entry colour table. They decode with the public RLE8 algorithm:
- encoded runs (count, colour);
- escape 0 = end of line, 1 = end of bitmap, 2 = delta (dx, dy);
- otherwise an absolute run, padded to an even byte count.

Rows are stored bottom-up. A decoder should also accept uncompressed 8-bit (`BI_RGB`) for robustness.

Article text, labels and captions are part of the artwork. Apart from the cases listed in `program.md`, the program draws no text of its own.

Facts checked over all 1,698 files by the corpus test and an independent decode with Pillow (indices and colour table identical for every file) [V]:
- `bfSize` equals the file size, `bfOffBits` is 1,078 (14 + 40 + 256 × 4), and `biSizeImage` is exactly the length of the RLE data.
- Every RLE stream ends with an end-of-bitmap escape on its last two bytes; nothing follows it.
- No file uses the delta escape, and no row ends early: every pixel is written.
- 1,694 files have 2,835 pixels per metre and `biClrUsed` 0; 4 have 0 and 256. Neither field matters for decoding.
- Pixels use the artwork entries 10–245 plus 0 (black on screen, in 1,695 files) and 255 (white, 1,695 files). One picture, `ARTICLE3/WINW/WINW0M.DIB`, also uses entry 2 for 985 pixels: white in its own table but dark green (`008000`) in the screen palette. What the original shows there is still to be checked in a reference environment [H].

### Decoding rules in the remake
- Output is one palette index per pixel, top-down, `width × height`, with no row padding. Uncompressed rows are padded to 4 bytes; a negative `biHeight` means the rows are stored top-down (not allowed with RLE).
- Bitmaps can come with a `BITMAPFILEHEADER` (`.DIB` files) or without one: NE `RT_BITMAP` resources start with the `BITMAPINFOHEADER`, and the pixel data follows the colour table directly. Resource data may carry a few bytes of alignment padding at the end, which are ignored.
- Besides 8-bit RLE8 and uncompressed 8-bit, uncompressed 1- and 4-bit bitmaps are decoded (bits from the most significant end), because the program's own resources include them (`program.md`). RLE4, `BI_BITFIELDS` and other bit depths are rejected.
- The colour table has `biClrUsed` entries, or `2^biBitCount` when it is 0. Each entry is stored blue, green, red, reserved; the remake keeps it as RGB triplets plus the reserved bytes.
- RLE8 pixels that the stream never writes (skipped by a delta or an early end of line, or left when the data stops) are index 0. The public RLE8 description leaves them undefined (Windows in practice keeps what the destination held [H]), so 0 is just a defined value; the disc never relies on it (see above). Running out of data between two instructions ends the bitmap like an end-of-bitmap escape; running out inside an instruction is an error.
- A run or absolute run that would cross the right edge or go past the last row is an error, as is RLE data longer than the file.

## One palette for everything [V]

Every DIB carries the **same** 256-entry colour table (identical in all 256 entries across the disc), and the program insists on it (it reports "wrong palette" errors otherwise). The table in the files holds the artwork's 236 colours in entries 10–245. Entries 0–9 and 246–255 are black or white placeholders, not the screen colours: entry 0 and 246–254 are black, 1–9 and 255 white [V].

The program builds its screen palette from a custom `PALETTE` resource (id 200) in `TWTW.EXE`: a Windows `LOGPALETTE` (version `0x300`, 256 entries) with the same 236 colours, flagged `PC_NOCOLLAPSE` (4). Entries 0–9 and 246–255 are flagged `PC_EXPLICIT` (2), meaning "use system palette entry N": as in the public definition of `PC_EXPLICIT`, the entry's low word holds N (red byte = N, green byte = 0) [V]. On Windows those are the 20 standard static colours, so pixels with index 255, which the pictures use for white backgrounds, show as white. The resource is 1,040 bytes: the 4-byte header, 256 × 4 bytes of entries and 12 bytes of padding to the resource alignment [V].

Entries 10–245 of the resource equal those of the DIB colour table [V], so the master palette below is the same whichever source it is built from.

**Master palette for the remake:** entries 10–245 from any DIB (or the resource), plus the Windows static colours (public Windows constants):

| Index | RGB | Index | RGB |
|---|---|---|---|
| 0 | 000000 | 246 | FFFBF0 |
| 1 | 800000 | 247 | A0A0A4 |
| 2 | 008000 | 248 | 808080 |
| 3 | 808000 | 249 | FF0000 |
| 4 | 000080 | 250 | 00FF00 |
| 5 | 800080 | 251 | FFFF00 |
| 6 | 008080 | 252 | 0000FF |
| 7 | C0C0C0 | 253 | FF00FF |
| 8 | C0DCC0 | 254 | 00FFFF |
| 9 | A6CAF0 | 255 | FFFFFF |

Consistent with the reference environments: page backgrounds are white on real Windows 3.1 (DOSBox-X), and Wine shows the same once the resource carries these values. A pixel-exact comparison is still to do. Wine maps `PC_EXPLICIT` entries wrongly in true-colour mode, and backgrounds turn red (index 249), which is why `wine/patch_palette.py` exists.
