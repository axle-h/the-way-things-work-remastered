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
- 2 cursor groups (ids 107 and 157, two cursor images; presumably the hand cursors the database names) and 1 icon (group 102);
- 8 string-table blocks (about 100 strings, mostly error messages), 9 dialogs (drive selection, CD error, printing, "Go to page", a resource monitor, and the "scrunging" dialog of the authoring build).

The program can also play animations embedded as resources of type `WINPICS`, but this disc has none.

## Installation [C]
`SETUP.EXE` runs a Microsoft Setup Toolkit script (`DKSTP/TWTW.MST`, plain text). It copies the program to the hard disk (default `C:\TWTW`), installs the ADPCM codec if needed, may switch the display driver to a 256-colour one, creates Program Manager items, and writes `TWTW.INI` with `Data=` set to the disc's root.
