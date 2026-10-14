# Reference environments: running the original

Two ways to run the unmodified 1994 app. They give us ground truth for validating the remake (clean-room rule 3, black-box behaviour). Both keep all generated state, including every capture, under `vendor/` (gitignored). Captures are private and never committed.

## Wine (fast; used for automated captures)

```
wine/run.sh
```

First run: extracts the ISO to `vendor/cd`, writes a patched EXE to `vendor/patched/`, and creates a prefix in `vendor/wineprefix`. Requirements and gotchas:

- **Win16 support:** Wine must be able to run 16-bit Windows programs. Fedora's wine 11 (WoW64 build) still ships `winevdm`/`krnl386.exe16`; some distributions' builds may not.
- **CD check:** the app uses MSCDEX (INT 2Fh) and requires a volume label starting with `DKMM`. The script maps `D:` → `vendor/cd`, sets the drive type to `cdrom` in the registry, and writes `vendor/cd/.windows-label` = `DKMMTWTW`. Wine caches the label: run `wineserver -k` after changing it.
- **Data path:** `C:\WINDOWS\TWTW.INI` must contain `[Directory]` / `Data=D:`.
- **Page file:** the app loads `TWTW.PNG` from the directory containing the EXE, so the patched EXE sits next to a symlink to it.
- **Palette patch:** the EXE's `PALETTE` resource marks entries 0–9 and 246–255 as `PC_EXPLICIT`. Wine resolves these wrongly in true colour, so every page background (index 255) draws bright red. `wine/patch_palette.py` replaces those entries with the standard Windows static colours, and nothing else changes. Remember this when comparing Wine captures with DOSBox-X.
- **Window and crop:**
  - With no window manager on the nested server, the X window named "The Way Things Work" (a direct child of the root) is exactly the app's client area. On a 1024×768 screen it is **634×454 at (195,195)**.
  - That is smaller than the 638×459 client area under Windows 3.1 (`docs/formats/program.md`, Window), so Wine captures miss page columns 634–637 and rows 454–458.
  - Find the rectangle from the X window tree (python-xlib) instead of hard-coding it. Page pixel (0,0) is the window's top-left.
  - Popups are separate top-level X windows on top of it, so grab the root window and crop.
- **Run every Wine command on the nested display:** set `DISPLAY=:5 WAYLAND_DISPLAY=` before the wineserver starts, including for `winepath`. If the wineserver comes up on the desktop display, the app centres itself for that screen and lands off-screen on `:5`, e.g. at (1603,891).
- **Paths:** winevdm could not start the EXE from a long scratch path containing `-` ("file not found"). Keep launch copies under `vendor/`.
- **Cursor:** Wine uses X cursors, so they are never in the window's pixels. `ffmpeg x11grab` draws the pointer unless you pass `-draw_mouse 0`; `emu/xdrive.py shot` does not pass it. Park the pointer outside the window (e.g. at (5,5)) before capturing.
- **Quit:** Alt+F4 closes the app at once, with no confirmation.

### Starting at any base page (reference captures)
The original has no working "Go to page" and no command-line or INI start page (`docs/formats/program.md`). To capture a page directly, give a private copy of the app a page database whose **startup page** is the target:
1. Copy `vendor/patched/TWTW.EXE` into a short directory under `vendor/` (gitignored).
2. Next to it, write a copy of `vendor/cd/DKCODE/TWTW.PNG` with the product record's startup `pageref` replaced by the target page's heap offset. That field is a big-endian `u32` at file offset `8 + string-table length + 18`; the string-table length is the `u32` at offset 4 (`docs/formats/page-database.md`). The original value is the title page.
3. Start Wine on that EXE (all commands on `DISPLAY=:5`). The target page is on screen within about 2 seconds, with the window in the usual place. This was checked with the Airplane article.

Only base pages work. A popup page as the startup page gives an empty white client area. Open popups by clicking their hotspot on the base page: client origin + panel position + object rectangle, from our own database parser. Restart with `pkill -f '[w]inevdm.exe'` and `wineserver -w` between pages. Navigation history starts empty, because the title was skipped.

**Settled state:** after loading or clicking, capture repeatedly until frames stay identical for a while (e.g. 1.5 s). Pages with an autostart animation and an `on_finish` ChangePage move on by themselves; on a cold start that is the title chain into the Workshop. Use the database to know when to expect that.

## DOSBox-X: real MS-DOS 6.22 + Windows 3.1 (authentic)

```
emu/twtw.sh            # boot DOS 6.22 → Windows 3.1 → the game
emu/twtw.sh --win      # stop at Program Manager (--dos: DOS prompt)
emu/twtw.sh --builtin  # DOSBox-X's built-in DOS with the same disk image
emu/twtw.sh --nested   # run on nested X server :6 for scripted capture
```

- Machine: 486, 16 MB, S3 Trio64 (2 MB) with the Windows 3.1 S3 driver 1.70.04 at 640×480×256. Sound Blaster 16 at 220/IRQ7/DMA1 with Windows' "Sound Blaster 1.5" driver. The ISO is attached as an IDE CD-ROM (real DOS uses FreeDOS UDVD2.SYS + MSCDEX). The mouse uses the vmwmouse driver for absolute pointing. The game is installed in `C:\DKMM\TWTW`.
- The disk image `vendor/emu/hdd.img` was **built by hand**. Nothing in it is in git, and there is no script that rebuilds it from scratch. It holds:
  - MS-DOS 6.22 and Windows 3.1, from your own floppy images;
  - three free third-party drivers: the S3 Trio64 Windows 3.1 driver 1.70.04 (vogonsdrivers.com), FreeDOS's UDVD2.SYS CD-ROM driver, and the open-source vmwmouse driver;
  - the game, installed by its own setup.

  Snapshots live in `vendor/emu/snapshots/` when you have built them: `01-…` is DOS + Windows only, and `02-final-…` is the full install. Restore from a snapshot rather than rebuilding.
- Before booting, `twtw.sh` rewrites `C:\AUTORUN.BAT` inside the image (with mtools) to choose the target.
- The Windows startup sound is disabled. Otherwise the game can start while it is still playing and report "sound unable to play".
- Helpers: `emu/dbx.sh start|stop|shot|key|type|click` runs one tracked instance on the nested display. `emu/xdrive.py` sends input. `emu/inied.py` edits Windows INI files. `emu/szdd.py` expands compressed files from the Windows disks.

## Seeing and driving GUIs on this machine (GNOME Wayland)

GNOME Wayland blocks screen capture: `ffmpeg x11grab` of `:0` returns black. Use a rootful nested X server instead:

```
Xwayland :5 -geometry 1024x768 -noreset &       # opens a window on the desktop
DISPLAY=:5 WAYLAND_DISPLAY= wine/run.sh          # wine: unset WAYLAND_DISPLAY
DISPLAY=:6 SDL_VIDEODRIVER=x11 SDL_VIDEO_DRIVER=x11 WAYLAND_DISPLAY= dosbox-x …   # SDL needs both vars
ffmpeg -loglevel error -y -f x11grab -video_size 1024x768 -i :5 -frames:v 1 shot.png
```

Input goes through XTEST using python-xlib (`emu/xdrive.py`; install python-xlib in a venv, since `xdotool` is not available).

**Gotcha:** `pkill -f winevdm` also kills the shell that runs it, because the pattern appears in the shell's own command line. Use `pkill -f '[w]inevdm.exe'` instead, and only kill processes you started.
