# The original program (`DKCODE/TWTW.EXE`)

What the remake needs to know about the original engine's behaviour and the resources it carries. The remake reads this file only as an NE resource container, using the public NE format (see `docs/CLEAN_ROOM.md` rule 6).

## Overview [V]
- A Windows 3.1 NE executable (expected Windows version 3.10). It was built with Microsoft C/C++ 7 / Visual C++ 1.x as C++, with no MFC or OWL: DK used its own small class library. It has 8 code segments (about 430 KB).
- It is a **generic page engine**. Every screen, hotspot and navigation step comes from the page database (`page-database.md`). The program supplies drawing, sound and animation playback, input dispatch, printing and the CD/installation checks.
- It imports only core Windows modules: KERNEL, USER, GDI, MMSYSTEM (wave output, multimedia timers, RIFF I/O) and COMMDLG (print dialog). It uses no MCI and no AVI. Sound goes straight to wave output, with the ADPCM WAVs decoded by the ACM codec.

## Startup [C]
Provenance: entry `1018:8534`, window procedure `1018:8782`, database load `1010:58ea`.
1. Read `TWTW.INI` from the Windows directory (see below) and check for a previous instance.
2. Check that a wave output device works.
3. Create the main window and the 256-colour palette from the `PALETTE` resource (`dib-and-palette.md`).
4. Load the page database from `TWTW.PNG` in the program's own directory.
5. Open the startup page (the title screen).

A DK/Houghton Mifflin splash picture is shown while loading.

## Input [C]
The window passes mouse and keyboard input to the current page. Click handlers fire on **mouse button release**. The page with focus is the topmost popup, if one is open, otherwise the base page. The mouse cursor changes to the cursor named by the object under the pointer (`Hand`, `Arrow`, or `normal` for the default).

Menu/accelerator commands (`WM_COMMAND`): `0x66` print, `0x67` print setup, `0x68` copy picture to the clipboard, `0x69` "Go to page" dialog [C]. How each is reached from the UI, and whether "Go to page" needs a developer setting, has not been established.

## Text the program draws itself [C]
Article text is part of the bitmaps. The program draws text only in:
- the **Index** page list box (1,857 entries from the A–Z index, font "MS Serif"; `1030:5e00`);
- the **A–Z machine** letter strings;
- **printing** (a caption, font requested as "Ariel"; `1010:e936`);
- window captions.

## Printing and copying [C]
Printing (`1010:e936` and nearby) and copying exist. Exactly what they output (base picture, popup, caption) is still to be established, before Phase 8 of the plan.

## Configuration: `TWTW.INI` [C]
Read from the Windows directory (`1030:c762`). Section `[Directory]`, key `Data` = the data root, normally the CD drive (`D:`). Setup writes it as the root of the disc it was run from. Other keys the program recognises: `Pages`, `Memory`, `Logging`, `Display`, `CanScrunge`, `Developer`, `NetworkUser`, `TestSwitch`, `LogErrors`, `LogFile`. Their effects are unexplored; `Developer` and `TestSwitch` may expose debugging features. If `Data` is missing, the program offers to choose a directory.

## CD check [C]
Provenance: `1000:7cbc`–`7d30`. The program asks MSCDEX (INT 2Fh, AX=1500h, then AX=150Bh per drive) for CD-ROM drives. It accepts a disc whose volume label starts with `DKMM`. Network and fixed-disk data paths are allowed through a drive-type check. Error dialogs cover a missing drive, an open drive door and the wrong disc. The remake does not need any of this, but the desktop app validates a user's ISO in the same spirit (label `DKMMTWTW`).

## Resources [V]
Read with any NE resource parser:
- a custom-type `PALETTE` resource, id 200 (`dib-and-palette.md`);
- bitmaps named `LINEUP`, `LINEUPALT`, `LINEDOWN`, `LINEDOWNALT`, `THUMB`, `THUMBALT`, `THUMBTRACK` and `THUMBTRACKALT`, plus 29 numbered bitmaps (37 in all). The database refers to bitmap resources as `@NAME`; the named ones are the parts of the custom scroll bar;
- 2 cursor groups (ids 107 and 157: a pointing hand and an arrow, see Cursors below) and 1 icon (group 102);
- 8 string-table blocks (about 100 strings, mostly error messages), 9 dialogs (drive selection, CD error, printing, "Go to page", a resource monitor, and the "scrunging" dialog of the authoring build);
- a version resource (`RT_VERSION`, type 16, id 1).

The program can also play animations embedded as resources of type `WINPICS`, but this disc has none.

### Resource table (public NE layout) [V]
The MZ header's `e_lfanew` (u32 at `0x3C`) gives the NE header (`NE`). Relative to the NE header, the u16 at `+0x24` is the resource table offset and the u16 at `+0x26` the resident-name table offset, which also ends the resource table (equal offsets mean no resources). All values are little-endian.

| Part | Layout |
|---|---|
| Alignment | u16 shift; resource offsets and lengths are in units of `1 << shift` bytes. `TWTW.EXE` uses 4 (16 bytes) |
| Type block | type id u16 (0 ends the list), resource count u16, reserved u32 (0 in `TWTW.EXE`), then one entry per resource |
| Resource entry (12 bytes) | offset u16, length u16 (both in alignment units), flags u16, id u16, two reserved u16 (0 on disk) |
| Names | length-prefixed strings after the type list, ended by a zero byte |

A type or resource id with bit 15 set is an integer (the low 15 bits). Otherwise it is the offset, from the start of the resource table, of the name. Names are stored upper case and matched ignoring case. Integer types used here: 1 cursor, 2 bitmap, 3 icon, 5 dialog, 6 string table, 12 cursor group, 14 icon group, 16 version. The only named type is `PALETTE`.

`TWTW.EXE` holds 62 resources in 10 types. Lengths are rounded up to the 16-byte unit, so resource data may end with padding. Flags: `0x1C30` for most resources, `0x1C70` for six bitmaps (115–119 and 150), `0x0C30` for `PALETTE` and the version resource. `0x10` (moveable), `0x20` (pure) and `0x40` (preload) are the public flag bits; `0x1000` is the discardable bit in some public descriptions, and `0x0C00` is uninterpreted [H].

### Bitmaps [V]
Bitmap resources are DIBs without a `BITMAPFILEHEADER` (`dib-and-palette.md`); all 37 decode, and the decoder's output matches Pillow's for every one.
- The 8 scroll-bar parts are 16 pixels wide, uncompressed 8-bit with the shared 256-colour table; `THUMBTRACK`/`THUMBTRACKALT` are 270 pixels high, the others 16.
- Most numbered bitmaps are 8-bit (uncompressed or RLE8) with the shared table in entries 10–245; bitmap 124 is the exception, with a different table. Bitmap 121 is a 640×480 RLE8 picture (presumably the loading splash [H]).
- Bitmaps 2–6 and 10–12 are 16×16, 4-bit, with their own 16-colour tables; 150 and 153 are 8×8, 1-bit (black and white); 118 is 8-bit with a 13-colour table. Their indices refer to their own tables, not to the screen palette.

### Cursors [V]
A cursor group (type 12) is a directory: reserved u16 (0), type u16 (2 = cursor), count u16, then 14-byte entries: width u16, height u16 (twice the cursor height, as it covers both masks), planes u16, bit count u16, byte length u32, and the id u16 of the cursor (type 1) resource.

A cursor resource is the hotspot (x u16, y u16) followed by a monochrome DIB without a file header: a `BITMAPINFOHEADER` whose height is twice the cursor's, a 2-entry colour table (black, white), the XOR mask, then the AND mask. Both masks are 1 bit per pixel, bottom-up, rows padded to 4 bytes. Per pixel: AND 0 / XOR 0 = black, AND 0 / XOR 1 = white, AND 1 / XOR 0 = transparent, AND 1 / XOR 1 = inverted screen.

| Group | Cursor | Size | Hotspot | Shape |
|---|---|---|---|---|
| 107 | 2 | 32×32 | (6, 0) | pointing hand; fingertip at the hotspot |
| 157 | 3 | 32×32 | (0, 0) | arrow |

Each group has one image. The directory gives 308 bytes for cursor 3 (4 + 40 + 8 + 2 × 128) but 320 for cursor 2, whose last 12 bytes are zero. Which group the database's cursor names (`Hand`, `Arrow`, `normal`) select is not established [H].

## Installation [C]
`SETUP.EXE` runs a Microsoft Setup Toolkit script (`DKSTP/TWTW.MST`, plain text). It copies the program to the hard disk (default `C:\TWTW`), installs the ADPCM codec if needed, may switch the display driver to a 256-colour one, creates Program Manager items, and writes `TWTW.INI` with `Data=` set to the disc's root.
