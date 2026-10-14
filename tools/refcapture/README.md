# tools/refcapture

`pnpm refcapture` drives the original program under Wine on a nested X server and saves reference screens for the pixel comparisons of later phases (`docs/PLAN.md` §5.4). Everything it writes stays under `vendor/` (gitignored); captures are never committed. How the reference environment works, and why the harness does what it does, is in `docs/reference-environments.md`.

## Requirements

- The Wine set-up made once by `wine/run.sh`: `vendor/cd` with its `.windows-label`, `vendor/patched/TWTW.EXE` (palette patch) and the prefix `vendor/wineprefix` with `TWTW.INI`. Run it once as `DISPLAY=:5 WAYLAND_DISPLAY= wine/run.sh` and close the program.
- `Xwayland` (a rootful nested X server; it opens a window on the desktop), `ffmpeg` with `x11grab`, `python3`.
- The harness creates its own Python environment, `vendor/venv`, with python-xlib on first use (`pip` needs the network once). Its X helper (`xhelper.py`) runs as `vendor/venv/bin/python3 -I`.

## Commands

```
pnpm refcapture env start|stop|status   # Xwayland on :5 ($TWTW_REF_DISPLAY)
pnpm refcapture page <page>...          # capture base pages
pnpm refcapture path <start> <step>...  # replay clicks, capture after each
pnpm refcapture popups <page>...        # a base page and every popup it opens
pnpm refcapture acceptance              # the Phase 2 acceptance set
pnpm refcapture crawl [--popups none|acceptance|all]
pnpm refcapture list [<page>]           # base pages, or a page's clickable objects as steps
pnpm refcapture index                   # rebuild vendor/ref/index.json
```

- **Pages** are heap offsets (`1538`, `0x602`), media directories (`'\ARTICLE1\AIRP\'`) or the names `title`, `workshop`, `az-machine`, `az-a` (the page the A–Z dial opens for "A") and `airplane`. Only base pages can be start pages.
- **Steps** are database object references, `page:panel:object`. `object` is the object's position in the panel's object list, because object ids repeat. The page must be the base page or the popup on top. `pnpm refcapture list 1538` prints the clickable objects of a page in this form. Example, the Airplane article's "Control column" label:

  ```
  pnpm refcapture path airplane 1538:1:11
  ```

- `page`, `path`, `popups`, `acceptance` and `crawl` start Xwayland when it is not running and stop it again at the end, unless `--keep-env` is given. They skip captures that exist; `--force` captures again. Other options: `--stable-ms`, `--advance-stable-ms`, `--timeout-ms`, `--launch-timeout-ms`, `--no-resize`, `--name` (file name of the last `path` capture), `--limit` (crawl). `pnpm refcapture --help` lists them.
- The crawl visits every base page reachable in the database (397). It is resumable: run it again and it continues where it stopped. A page whose launch or capture fails is retried once; failures are recorded in the index with the error.

## What one capture does

1. Writes a launch copy under `vendor/rc/run/`: the palette-patched `TWTW.EXE` and a copy of `TWTW.PNG` whose startup page is the start page.
2. Starts it with Wine on the nested display (`DISPLAY=:5`, no `WAYLAND_DISPLAY`) and waits for the window "The Way Things Work" in the X window tree to appear and stop moving.
3. Resizes that X window to 638×459, the Windows 3.1 client size; Wine's own frame metrics leave only 634×454 (see the reference-environments doc).
4. Parks the pointer at (5,5) and streams the client rectangle with `ffmpeg -f x11grab -draw_mouse 0` (10 frames per second). Popups are separate X windows inside that rectangle, so the grab includes them.
5. Waits for the **settled state**: no frame it has not already seen for 1.5 s (4 s for pages the database says move on by themselves), with a 30 s timeout. A screen that keeps cycling through known frames, such as the A–Z machine's blinking light, counts as settled; the kept frame is the last new one.
6. For a path, clicks each step at client origin + panel position + a point of the object's rectangle (its centre, or the nearest point not covered by another clickable object of the panel), then waits for the settled state again.
7. Closes the program with `WM_DELETE_WINDOW`. If it does not exit, the harness kills the `winevdm.exe` processes running its launch copy, and as a last resort runs `wineserver -k` for the prefix.

## Output

```
vendor/ref/<page>/startup.png            a base page, started through the startup patch
vendor/ref/<page>/startup.json
vendor/ref/<page>/path-<start>_<steps>.png   the screen after a path; <page> is the page on top
vendor/ref/index.json                    summary of all captures and failures
vendor/refcapture/                       Xwayland PID file and logs (xwayland.log, wine.log)
```

`<page>` is the heap offset of the page the database says is on top: the start page, or after a click the base page changed to or the popup opened. Path files are named after their steps, e.g. `vendor/ref/2534/path-1538_1538-1-1.png`.

Each PNG is the client area in RGB, 638×459 (or Wine's 634×454 with `--no-resize`). The JSON sidecar records:

| Field | Meaning |
|---|---|
| `page`, `pageType`, `directory` | the page shown, according to the database |
| `kind` | `startup` or `path` |
| `actionPath` | start page and steps; each step with object id and kind, its rectangle, the client and screen points clicked, whether the point was clear of other objects, and the effect the database predicts |
| `expectedState` | base page and open popups after the last step |
| `autoAdvance`, `expectedSettledPage`, `settledDiffersFromRequested` | the chain of pages an autostart animation's `finished` ChangePage leads to, and the page expected once settled |
| `settle` | `settled`, `timedOut`, frame counts, `msUntilStable`, `cycleFrames` (distinct frames still alternating) and `changingRect` (where they differ), plus the thresholds used |
| `clientRect`, `resizedFrom` | the client rectangle on the X screen, and Wine's size before the resize |
| `otherWindows` | other top-level X windows at capture time: popups, or an unexpected dialog |
| `capturedAt`, `timings` | when, and how long the launch and the settling took |
| `environment` | Wine version, display, screen size, and the palette and startup patches |

`index.json` lists every capture per page, counts (base pages captured, popups, time-outs, cycling screens, pages that did not reach the page they should move on to), failures with their error, and the timings of the last crawl.

## Tests

`pnpm test` covers the parts that need no X server: the startup-patch offset, page names and auto-advance chains, action paths to client coordinates, and the settle rule, all on a synthetic database built with `@twtw/formats/testing`. PNG encoding and decoding come from `@twtw/node`.
