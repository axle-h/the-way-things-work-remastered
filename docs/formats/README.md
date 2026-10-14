# Format specifications

These are our own descriptions of the disc's formats and the original program's behaviour, written under `docs/CLEAN_ROOM.md`. Implement from these documents, and update them first when something turns out differently.

Status markers:
- **[V]** verified against the whole disc by a parser that consumes the data exactly;
- **[C]** observed in the original program's code but not yet exercised;
- **[H]** hypothesis.

Addresses such as `1018:6810` are provenance pointers into `TWTW.EXE` (Ghidra `segment:offset`; selector `1000` = NE segment 1, `12c0` = DGROUP).

## Disc inventory

The disc is ISO 9660 (level 1, no Joliet or Rock Ridge), volume label `DKMMTWTW`, 2,337 files: see [iso9660.md](iso9660.md) [V].

| Files | Count | Format | Spec | Status |
|---|---|---|---|---|
| `DKCODE/TWTW.EXE` | 1 | Win16 NE executable: the engine. We only read its resources | [program.md](program.md) | resources [V], behaviour [C]/[H] |
| `DKCODE/TWTW.PNG` | 1 | Compiled page database (not an image) | [page-database.md](page-database.md) | [V] structure, some fields unnamed |
| `*.DIB` | 1,698 | 8-bit BMP/DIB, RLE8-compressed, one shared palette | [dib-and-palette.md](dib-and-palette.md) | [V] |
| `*.ANI` | 497 | DK "PICS" animation: interleaved PCM + packed dirty rectangles | [pics.md](pics.md) | [V] structure, [H] timing |
| `*.WAV` | 100 | RIFF WAVE: 97 MS-ADPCM, 3 plain 8-bit PCM | [wav.md](wav.md) | [V] |
| `DKCODE/MSACM.DRV`, `MSADPCM.ACM` | 2 | Windows ACM driver and ADPCM codec shipped for the original | n/a | not needed |
| `SETUP.EXE`, `DKSETUP/`, `DKSTP/` | | Microsoft Setup Toolkit installer (`.MST` scripts are readable text) | [program.md](program.md) §Installation | [C] |
| `DKCODE/README.TXT` | 1 | Plain text, user notes | n/a | |

Content directories: `TITLE`, `WORKSHOP`, `NAV`, `AZAZ` (A–Z dial), `ARTICLE1`–`3` (machines, one folder per four-letter topic code), `PRINCIPL` (principles of science), `INVENTOR`, `TIMELINE` (history), `GLOS` (glossary), `RELA` (related-topic pictures), `HELP`, `INDEX`, `OPTIONS`.

File naming [H]: `<TOPC><n><kind>[<m><A|S>]`, where `TOPC` is the topic code and `n` the picture number. Kinds: `M` = main picture; `J`, `N`, `Z`, `X`, `R` = popup picture kinds. The suffix `A` marks an animation and `S` a sound for picture `m`. Example: `AIRP0M0A.ANI` is the first animation for the Airplane main picture.
