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
| `*.ANI` | 497 | DK "PICS" animation: interleaved PCM + packed dirty rectangles | [pics.md](pics.md), [playback.md](playback.md) | [V] structure, [C] timing |
| `*.WAV` | 100 | RIFF WAVE: 97 MS-ADPCM, 3 plain 8-bit PCM | [wav.md](wav.md) | [V] |
| `DKCODE/MSACM.DRV`, `MSADPCM.ACM` | 2 | Windows ACM driver and ADPCM codec shipped for the original | n/a | not needed |
| `SETUP.EXE`, `DKSETUP/`, `DKSTP/` | | Microsoft Setup Toolkit installer (`.MST` scripts are readable text) | [program.md](program.md) §Installation | [C] |
| `DKCODE/README.TXT` | 1 | Plain text, user notes | n/a | |

How the original draws pages from these files (client area, panels, objects at rest, popup windows with caption strip and drop shadow, the palette at runtime) is in [rendering.md](rendering.md): [C], with the base-page, popup and A–Z machine compositions [V] against Wine captures.

How it behaves: mouse routing and hit-testing, events and action lists, page actions, popups, the navigation bar and its history, cursors and keyboard are in [behaviour.md](behaviour.md) [C], with some [V]. Sound and animation playback (players, frame timing against the sound, queueing, stopping, AnimHotspot and AnimationControl) is in [playback.md](playback.md) [C]. The special screens (the Index page with its list box, the scroll bars of the Help pages, the Options popup with copy, print and printer setup, Help placement) and the list of which object and action types the remake implements or drops are in [special-screens.md](special-screens.md) [C].

Content directories: `TITLE`, `WORKSHOP`, `NAV`, `AZAZ` (A–Z dial), `ARTICLE1`–`3` (machines, one folder per four-letter topic code), `PRINCIPL` (principles of science), `INVENTOR`, `TIMELINE` (history), `GLOS` (glossary), `RELA` (related-topic pictures), `HELP`, `INDEX`, `OPTIONS`.

File naming [H]: `<TOPC><n><kind>[<m><A|S>]`, where `TOPC` is the topic code and `n` the picture number. Kinds: `M` = main picture; `J`, `N`, `Z`, `X`, `R` = popup picture kinds. The suffix `A` marks an animation and `S` a sound for picture `m`. Example: `AIRP0M0A.ANI` is the first animation for the Airplane main picture.
