# Pictures (`*.DIB`) and the master palette

## DIB files [V]

All 1,698 `.DIB` files are standard Windows device-independent bitmaps: a `BITMAPFILEHEADER` followed by a 40-byte `BITMAPINFOHEADER`, 8 bits per pixel, compression `BI_RLE8` (1), and a 256-entry colour table. They decode with the public RLE8 algorithm:
- encoded runs (count, colour);
- escape 0 = end of line, 1 = end of bitmap, 2 = delta (dx, dy);
- otherwise an absolute run, padded to an even byte count.

Rows are stored bottom-up. A decoder should also accept uncompressed 8-bit (`BI_RGB`) for robustness.

Article text, labels and captions are part of the artwork. Apart from the cases listed in `program.md`, the program draws no text of its own.

## One palette for everything [V]

Every DIB carries the **same** 256-entry colour table, and the program insists on it (it reports "wrong palette" errors otherwise). The table in the files holds the artwork's 236 colours in entries 10–245. Entries 0–9 and 246–255 are white placeholders.

The program builds its screen palette from a custom `PALETTE` resource (id 200) in `TWTW.EXE`: a Windows `LOGPALETTE` (version `0x300`, 256 entries) with the same 236 colours, flagged `PC_NOCOLLAPSE`. Entries 0–9 and 246–255 are flagged `PC_EXPLICIT`, meaning "use system palette entry N". On Windows those are the 20 standard static colours, so pixels with index 255, which the pictures use for white backgrounds, show as white.

**Master palette for the remake:** entries 10–245 from any DIB (or the resource), plus the Windows static colours:

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
