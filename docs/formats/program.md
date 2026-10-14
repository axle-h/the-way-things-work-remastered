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

The program ignores its command line [C], so nothing selects a start page from outside. The startup page always comes from the product record of the page database (`page-database.md`).

On a cold start the title is a chain of base pages [V]: the title animation page moves on to a still title page when its animation finishes (`on_finish`) or on a click. A click there opens a third title page, which plays a transition animation into the Workshop picture and then changes to the Workshop page on `on_finish`. Some pages therefore look settled while an animation is still due to move them on.

## Window [C][V]
Provenance: window class registration `1018:86ce`, creation and placement `1010:4714`.
- One top-level window titled "The Way Things Work", with style caption + system menu + minimise box (`0x02CA0000`). It has no thick frame (not resizable), no maximise box and **no menu bar**. The program has no menu or accelerator resources, imports no menu APIs and does not change the system menu, so the system menu is the standard Windows one.
- After the database loads, the window is moved so that it is centred on the screen. Its outer width is the product width (640). Its outer height is the product height plus the caption height minus 20, which is 480 under Windows 3.1, where the caption is 20 pixels tall.
- **Windows 3.1** (DOSBox-X capture) [V]: outer window 640×480, with a 1-pixel border and a caption bar showing the system-menu box and the minimise arrow. The **client area is 638×459**. This size also appears in the data: the one full-screen base template is 638×459, and the title page's full-screen hotspot is (0,0)–(638,459). Page pixel (0,0) is client (0,0).
- **Wine** [V]: Wine computes the size from its own system metrics, so the client area is only **634×454**. Columns 634–637 and rows 454–458 of the page are cut off; for example, the bottom of the navigation bar's Help button is missing. Page pixel (0,0) is still client (0,0): a Wine capture lines up with the DOSBox-X capture at offset (0,0).
- The window class's background brush is white, but the window procedure swallows `WM_ERASEBKGND`, so the background is never erased; the page's panels cover the whole client area [C].
- Popups (and the index page) are separate top-level windows placed over the main window [V]. They are borderless `WS_POPUP` windows. The thin caption strip with its system-menu box and the stippled drop shadow that Wine shows around the picture are drawn by the program itself, not by Windows, so Windows 3.1 shows them too, in its own system colours [C][V]. Position, size and pixel layout are in `rendering.md` §7. Popups can be dragged by their caption strip: the window procedure runs its own drag loop with a focus rectangle (`1018:8782`, `WM_NCLBUTTONDOWN`) [C].
- While the database loads, EXE bitmap 121 is shown as a splash in a borderless window centred on the screen (`1010:4714`) [C].

## Input [C]
The window passes mouse and keyboard input to the current page. Click handlers fire on **mouse button release**. The page with focus is the topmost popup, if one is open, otherwise the base page. The mouse cursor changes to the cursor named by the object under the pointer (`Hand`, `Arrow`, or `normal` for the default). Under Wine the cursor is an X cursor and never appears in the window's pixels [V].

### Keyboard
- `WM_KEYDOWN`: the program forwards only the function keys F1–F24, as numbers 1–24, to the focused page. Backspace, digits and letters are left for `WM_CHAR`, and other keys go to Windows' default handling. `WM_CHAR` characters are forwarded to the focused page [C].
- On the Workshop, F1, F2, `a`, Esc, Backspace, Tab, Page Up and Left have no visible effect. Esc and Enter do not close the Options popup [V]. No keyboard navigation has been found on ordinary pages.
- The Index page installs a keyboard hook (`1030:58d0`). Tab moves focus between its two controls, and Esc, Page Up, Page Down, Up and Down are passed on to the program (as private message `0x403`) [C].
- Alt+F4 closes the program at once, with no confirmation [V].

### Commands (`WM_COMMAND`) [C]
The window procedure handles four command ids (`1018:93d0`): `0x66` print, `0x67` print setup, `0x68` copy, `0x69` "Go to page". **None of them can be reached from the UI.** There is no menu, no accelerator table and no system-menu item. The program never sends `WM_COMMAND` to itself: the only `0x0111` constant in the code is the window procedure's own comparison. Only another program posting the message could trigger them.

Print, print setup and copy are reached from the data instead: the **Options popup** (`\OPTIONS\`, opened by the navigation bar's Options button) has hotspots whose action is ProductOption (`TWTWOPTION`, `1030:1f84`) [C][V]:

| Option | Label on screen [V] | Effect [C] |
|---|---|---|
| 1 | COPY ACTIVE WINDOW | copy the current page's picture to the clipboard (`1028:5836`) |
| 2 | PRINT ACTIVE WINDOW | print the current page (`1028:5800`) |
| 3 | PRINTER SETUP… | the common print-setup dialog (`1028:6a7e`) |

The popup's fourth item, "MAMMOTH MOVIES…", is an ordinary ChangePage. For copy and print, the "current page" is the topmost window, so a popup if one is open [H]. What they output is for Phase 8.

**"Go to page" is dead in this release** [C][V]:
- Command `0x69` calls `DialogBox` with dialog template **109**, but the EXE has no dialog 109; its dialogs are `PRINTDLG`, 10, 103–107, 400 and 2600 [V]. The call therefore fails and nothing appears.
- Its dialog procedure (`1018:97d8`) is a password prompt, not a page selector. It compares the text against a fixed string and closes with success on a match, but the caller ignores the result.
- The resource that is titled "Go to page..." (dialog 104: one edit control, id 3002, with OK and Cancel) is never referenced by the code.

So the original has no way to jump to a page by name or number. (`docs/reference-environments.md` describes a data-patch alternative for reference captures.)

## Text the program draws itself [C]
Article text is part of the bitmaps. The program draws text only in:
- the **Index** page list box (1,857 entries from the A–Z index, font "MS Serif"; `1030:5e00`);
- the **A–Z machine** letter strings;
- **printing** (a caption, font requested as "Ariel"; `1010:e936`);
- window captions.

## Printing and copying [C]
Printing (`1010:e936` and nearby) and copying exist, reached from the Options popup (see Commands above). Exactly what they output (base picture, popup, caption) is still to be established, before Phase 8 of the plan.

## Configuration: `TWTW.INI` [C]
Read once at startup from the Windows directory (`1030:c762`, via `1018:8738`). The file name (string 2000) and the section name (string 27) come from the string table. **All keys are in section `[Directory]`.** Integer keys use `GetPrivateProfileInt`, so any non-zero value means on.

| Key | Default | Effect |
|---|---|---|
| `Data` | (none) | Data root, normally the CD drive (`D:`). Setup writes the root of the disc it was run from. If it is missing, the program offers to choose a directory |
| `Developer` | 0 | Developer mode; see below |
| `LogErrors` | 0 | Error logging; see below |
| `LogFile` | `error.log` | Log file name, read only when `LogErrors` is on. A relative name is relative to the current directory [H] |
| `NetworkUser` | 1 | Read and stored, but never used [C] |
| `TestSwitch` | 0 | Read and stored, but never used [C] |

`Pages`, `Memory`, `Logging`, `Display` and `CanScrunge` exist only as string-table entries (strings 28 and 49–52). No code loads them, so in this release they are not INI keys [C]; they are probably left over from the authoring ("scrunging") build. Setting `Developer=1`, `LogErrors=1`, `LogFile=C:\…` and `TestSwitch=1` under Wine changes nothing visible on screen [V].

## Developer features [C]
`Developer` and `LogErrors` are the only switches that do anything. There is no developer menu, no page jumping and no log of page changes or actions.
- **`Developer=1`:**
  - At startup the program skips the up-front scan of the CD-ROM drives (MSCDEX) and only validates the data path. The usual scan is `1030:6fc6`; the developer path is `1030:6dcc`.
  - When a file cannot be opened, it asks whether to look for it and then shows a common "Find File %s" open dialog to locate it (`1008:73a6`, `1018:11e6`). This was meant for running from a hard-disk copy of the data.
- **`LogErrors=1`:**
  - At startup the program creates or truncates the log file (`OpenFile` with `OF_CREATE`). Under Wine, an empty file appears at once [V].
  - Error messages are then appended to it (`1008:6d22`). Errors reported by string id are written **only** to the log, with no message box (`1008:6d78`); errors reported as free text are logged and still shown (`1008:7022`).
  - This keeps some error boxes from blocking an unattended run. It logs no page changes.
- The sound and animation code also writes diagnostics (e.g. `WQ::Play`, `PlayPICS/ReadFrame`) to the Windows debug output (`KERNEL._DebugOutput`), and only on errors. Wine can show these through its debug channels; they are not a navigation trace.

## CD check [C]
Provenance: `1000:7cbc`–`7d30`. The program asks MSCDEX (INT 2Fh, AX=1500h, then AX=150Bh per drive) for CD-ROM drives. It accepts a disc whose volume label starts with `DKMM`. Network and fixed-disk data paths are allowed through a drive-type check. Error dialogs cover a missing drive, an open drive door and the wrong disc. The remake does not need any of this, but the desktop app validates a user's ISO in the same spirit (label `DKMMTWTW`).

## Resources [V]
Read with any NE resource parser:
- a custom-type `PALETTE` resource, id 200 (`dib-and-palette.md`);
- bitmaps named `LINEUP`, `LINEUPALT`, `LINEDOWN`, `LINEDOWNALT`, `THUMB`, `THUMBALT`, `THUMBTRACK` and `THUMBTRACKALT`, plus 29 numbered bitmaps (37 in all). The database refers to bitmap resources as `@NAME`; the named ones are the parts of the custom scroll bar;
- 2 cursor groups (ids 107 and 157: a pointing hand and an arrow, see Cursors below) and 1 icon (group 102);
- 8 string-table blocks (about 100 strings, mostly error messages), 9 dialogs (drive selection, CD error, printing, an unreferenced "Go to page", a resource monitor, and the "scrunging" dialog of the authoring build);
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
- Most numbered bitmaps are 8-bit (uncompressed or RLE8) with the shared table in entries 10–245; bitmap 124 is the exception, with a different table. Bitmap 121 is a 640×480 RLE8 picture, the loading splash [C].
- Bitmaps 2–6 and 10–12 are 16×16, 4-bit, with their own 16-colour tables; 150 and 153 are 8×8, 1-bit (black and white); 118 is 8-bit with a 13-colour table. The program ignores every bitmap's colour table and treats pixel values as master-palette indices (`dib-and-palette.md`) [C]; 150 and 153 are used only as a monochrome pattern.
- Uses found in the drawing code [C] (`rendering.md`):

  | Bitmaps | Use |
  |---|---|
  | 101, 115–120, 159 | AnimationControl strip parts |
  | 121 | loading splash |
  | 150, 153 | 50% checkerboard pattern for popup drop shadows |
  | 170, 171 | CancelButton ("Cancel"), normal and probably pressed |
  | 172, 173 | A–Z machine lamp, on and off |
  | 168, 169 | drawn by the Index page's window code (`1030:4b68`), chosen by an item's selected state (Phase 6) |
  | 352 | drawn by the A–Z dial code (`1020:abf2`), not at rest |
  | 2–6, 10–12 | loaded into a table at `1030:ca56` (the end of the second range is [H]); use not followed |

  No use was found for 124, 174 and 175.

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
