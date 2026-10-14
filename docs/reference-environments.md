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
  - That is smaller than the 638×459 client area under Windows 3.1 (`docs/formats/program.md`, Window), so Wine captures miss page columns 634–637 and rows 454–458. See "Client area size" below for the fix.
  - Find the rectangle from the X window tree (python-xlib) instead of hard-coding it. Page pixel (0,0) is the window's top-left.
  - Popups are separate top-level X windows on top of it, so grab the root window and crop.
- **Client area size** [V for the size, H for the repaint]: resize the main window's X window to 638×459 from outside (`XConfigureWindow`, e.g. python-xlib `window.configure(width=638, height=459)`), once it has appeared and stopped moving. Wine treats the window as managed and follows the ConfigureNotify: the program's client area grows to 638×459, it repaints the uncovered strips (the frame pieces at x 634–637 and y 454–458, and the bottom of the Help button), and the window stays where it was. `tools/refcapture` does this by default and records the size before and after in each sidecar. **Unconfirmed:** the repaint of the uncovered strips is not borne out by the reference set: in all 400 captures, columns 634–637 and rows 454–458 are black. Compare only 634×454 until the harness is fixed.
  - Registry metrics do not help. Wine gives a caption + dialog-frame window a fixed 3-pixel frame on each side, whatever `BorderWidth` or `PaddedBorderWidth` say, and the program sets its outer height to the product height + caption height − 20, so the client height stays 454 for any caption height. Tried and reverted in `HKCU\Control Panel\Desktop\WindowMetrics`: `BorderWidth` 0 with `CaptionHeight` 19 and 30 (the window only moved up or down; the client stayed 634×454), and `HKCU\Software\Wine` `Version` = `win31` (no change).
- **Popup geometry under Wine** [V]: a popup is a separate X window at client + (91, 1) + the popup page's origin, i.e. the content panel's position (94, 4) + origin − (3, 3). Wine draws an 8-pixel caption strip at its top; the picture starts 8 pixels down, at client + (91, 9) + origin, and a 4-pixel dithered drop shadow runs along its right and bottom edges. Measured on Airplane popups with origins (186, 122) and (151, 81). The Windows 3.1 placement is still to be checked.
- **Clicks while a popup is open** [V]: a click on the base page outside the popup closes the popup and does not reach the base page's hotspot. Sending the popup's X window `WM_DELETE_WINDOW` also closes it, and the base page is then pixel-identical to before.
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

**Settled state:** after loading or clicking, capture repeatedly until no new frame has appeared for a while (1.5 s). Pages with an autostart animation and an `on_finish` ChangePage move on by themselves; on a cold start that is the title chain into the Workshop. Use the database to know when to expect that. Some screens never stop changing: the A–Z machine blinks a light above its OK button (17×8 pixels, once a second), so treat a screen that only cycles through frames already seen as settled.

**Animations under Wine** [V]: with Wine 11 (staging) on this machine, PICS animations stop after about 2–3 seconds. The program plays the sound one buffer at a time ("WQ::Play" / "WQ::Stop" in its debug output, visible with `WINEDEBUG=fixme+module`) and stops queuing after roughly 7–12 buffers. The title animation (80 frames, 16 s) stops after four frame changes, and the Principles intro animations after about ten. So these pages never reach their `finished` ChangePage under Wine: a capture of the title shows a half-built title, not the still title page. It is not the window resize, the pointer position, input focus or the Wine audio driver (Pulse and ALSA behave the same, and the Pulse sink here is PipeWire's Dummy Output, which `paplay` drains in real time). Capture the page an animation leads to directly instead, and use DOSBox-X for animation behaviour. `tools/refcapture` flags such captures (`reachedExpectedSettledPage: false` in `vendor/ref/index.json`). In the reference set 23 pages stall this way; the title transition page (410962) does reach the Workshop, with leftovers of its animation (rendering.md §8). A likely cause [H]: the program advances an animation only when a wave buffer reports completion (`MM_WOM_DONE` to its window, docs/formats/playback.md §2); it hands the device A×B + 1 buffers at the start and one more per completion, so if completions stop arriving, playback stops once the buffers already handed over have played.

### Capture harness
`pnpm refcapture` (`tools/refcapture/README.md`) automates all of the above: the nested X server, the startup patch, window lookup and resize, clicks named by database object references, the settled state, and a resumable crawl of every base page into `vendor/ref/`. Its Python helper runs from its own venv, `vendor/venv`. It kills only the `winevdm.exe` processes running its own launch copy (`vendor/rc/run/TWTW.EXE`), and as a last resort runs `wineserver -k` for the prefix.

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
