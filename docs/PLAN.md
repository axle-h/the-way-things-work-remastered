# Plan: The Way Things Work — remastered engine

Status: **approved by Alex (2026-10-14). Work through the phases in order.**

## 1. Goal

Re-implement the engine of Dorling Kindersley's *The Way Things Work* (1994, Windows 3.1, 16-bit) in TypeScript, so the original CD content plays on modern devices. It must look and behave like the original, screen by screen.

Deliverables, in order:
1. **Web app.** Responsive for tablets, desktops/laptops and phones in landscape. Used by Alex's kids with Alex's own CD.
   - It runs locally during development.
   - It is finally deployed on Alex's k3s server with a public DNS name and a Let's Encrypt certificate, the same way as his Encarta project. The hostname never appears in the repository.
2. **Desktop app (Electron), last.** "Bring your own ISO": the user points it at their own disc image. Release builds are published on GitHub.

Constraints:
- **The repository is public, and the project is clean-room.** Follow `docs/CLEAN_ROOM.md`. In short:
  - Decompiler output stays private in `analysis/decompiled/`.
  - Formats are specified in our own words in `docs/formats/` before they are implemented.
  - Code is written from those specs.
  - No disc bytes are committed, ever.
- **Fidelity first.** The original runs at 640×480 with 256 colours. Match it pixel for pixel, then add presentation (responsive scaling, touch, print, clipboard) on top without changing the content.
- **No smoothing.** Scaling must never blur or filter the artwork (§3).

## 2. What we already know

Read `docs/formats/` before starting (start at its README). Summary:

- The original is one generic engine (`DKCODE/TWTW.EXE`) plus data. Everything screen-specific is data.
- `DKCODE/TWTW.PNG` is **not an image**. It is a compiled page database (big-endian) holding a string table, 7 templates, an A–Z index of 1,857 entries, and a heap of 1,657 pages. Pages contain panels, panels contain display objects (Bitmap, Hotspot, AnimHotspot, …), and objects carry event handlers (click, open, finished) with action lists. There are 13 action types: change page, open popup, play animation, play sound, and so on. See `page-database.md`.
- `.DIB` files (1,698) are 8-bit RLE8 bitmaps that all share **one palette**. Article text is baked into them. See `dib-and-palette.md`.
- `.ANI` files (497) are DK's "PICS" format: 8-bit 22 kHz PCM interleaved with run-length-packed dirty rectangles drawn over the page's background picture. See `pics.md`.
- `.WAV` files (~100) are MS-ADPCM. Browsers cannot play this format, so we decode it ourselves. See `wav.md`.
- The original also prints and copies the current picture. See `program.md`.
- Some fields remain unnamed or hypothetical (§8).

What exists already:
- **Private oracles.** Prototype Python parsers in `analysis/decompiled/oracles/` (gitignored) consume the whole database and decode the animations. They were written with the decompiler open, so under the clean-room rules they are used **only for their output**, never read while writing TypeScript. A full database dump is at `analysis/decompiled/out/twtw_png.json`.
- **Ghidra project and helpers.** The project is in `analysis/decompiled/ghidra/`. `tools/ghidra/` has helpers to decompile any address.
- **Reference environments** that run the original (`docs/reference-environments.md`):
  - Wine: `wine/run.sh`. Fast; needs a palette patch.
  - DOSBox-X with real MS-DOS 6.22 and Windows 3.1: `emu/twtw.sh`. Authentic.

## 3. Architecture decisions

| Decision | Choice | Why |
|---|---|---|
| Language | TypeScript (strict) | One codebase for browser, Node tests and the Electron app |
| Rendering | Plain `<canvas>`, no React and no game framework | The content is fixed 640×480 bitmaps, hotspots and popups. React may be used later for dev tools or the desktop ISO picker only |
| Framebuffer | Engine draws into an **8-bit indexed 640×480 `Uint8Array`** and converts to RGBA only at present time | Matches how the original draws, keeps palette behaviour exact, and lets the renderer run headless in Node for pixel tests |
| Data format | Read the **original disc files unchanged** and decode them in TypeScript at runtime | One decoder implementation shared by the app, tests and validation. No conversion pipeline. Required anyway for bring-your-own-ISO |
| Data access | A `DataSource` interface (`read(path) → bytes`, case-insensitive). Implementations: **HTTP + manifest** (web app, files from the extracted disc) and **ISO 9660 reader** (desktop app, reads the user's `.iso` directly) | The engine never knows where bytes come from. The ISO reader is DOM-free and lives in `packages/formats`, so it is testable in Node |
| Original program | `TWTW.EXE` is read only as an NE resource container (palette, cursors, scrollbar bitmaps); it is never executed | Clean-room rule 6 |
| Audio | Web Audio. Decode MS-ADPCM and 8-bit PCM to `AudioBuffer`s in TS | Precise scheduling; animation frames are synced to the audio clock |
| Scaling | See "Scaling rules" | Lose no detail; never smooth |
| Build/dev | Vite (app), Vitest (tests), **pnpm** workspaces | pnpm for supply-chain safety (see "Dependency policy"); Vite and Vitest are standard, fast and need little configuration |
| Serving | A small Node static server: `apps/web/dist` plus `/data` → the extracted disc. The same server runs locally (`pnpm serve`) and in the container | One code path for dev, LAN and k3s |
| Deployment | Container image on GHCR, built by GitHub Actions with no data in it. k3s with traefik + cert-manager (Let's Encrypt), and the disc data on a volume synced from this machine. The hostname is kept out of git. This mirrors the Encarta project's `k8s/` | Same proven setup as the Encarta deployment |
| Desktop | Electron, wrapping the same web build, with the ISO `DataSource` and native clipboard and print. Unsigned CI builds for Windows, macOS and Linux | Consistent Chromium rendering and audio everywhere; publishable without content |

Rejected: native C++/Rust + SDL (loses the browser, or needs Emscripten); pre-converting assets (a second pipeline, and impossible for bring-your-own-ISO without shipping a converter anyway); Tauri (system WebKitGTK on Linux has audio and timing quirks).

### Scaling rules

All decisions are made in **device pixels**, not CSS pixels:
- Size the canvas backing store from `ResizeObserver` `devicePixelContentBoxSize`, falling back to `clientWidth × devicePixelRatio`.
- Never rely on the browser to resample.

1. **Integer upscale.** Draw the 640×480 frame at the largest integer scale `k ≥ 1` that fits the viewport, using nearest-neighbour (`imageSmoothingEnabled = false`). Every source pixel becomes a k×k block, so no detail is lost and no filtering is applied. Centre the result and letterbox with a neutral colour. Examples: a 1080p monitor gives 2× (1280×960); a 4K monitor gives 4×; a typical phone in landscape (about 2532×1170 device px) gives 2×; an iPad gives 2× or 3×.
2. **Smaller than native (k would be < 1).** This is rare and only happens on very small or low-DPR viewports. Content must shrink, and shrinking cannot preserve every pixel. Use nearest-neighbour at the largest fractional scale that fits. Never use a smoothing filter. Log it in the debug overlay so it is noticed.
3. **Optional "fill" mode** (a user setting, default off): non-integer nearest-neighbour to fill more of the screen. Pixels become slightly uneven but nothing is blurred.
4. **Hit-testing** maps pointer coordinates back through the same transform. Pointer events are converted to 640×480 content coordinates in exactly one place.
5. **Portrait phones:** show a friendly "turn your device sideways" screen rather than a tiny 4:3 picture. Tablets in portrait still render (letterboxed).

### Dependency policy

**pnpm** only, never npm or yarn. Pin the pnpm version with `packageManager` in the root `package.json` (via Corepack). Keep the dependency tree small; this project needs few runtime dependencies.
- **Lockfile:** commit `pnpm-lock.yaml`. CI and the container build use `pnpm install --frozen-lockfile`.
- **Install scripts:** dependency lifecycle scripts stay blocked (pnpm's default). Allow-list only what genuinely needs a build step (e.g. `esbuild`, `electron`) in `pnpm-workspace.yaml`, and review each addition.
- **Release age:** set `minimumReleaseAge` (e.g. one week) in `pnpm-workspace.yaml`, so freshly published, possibly compromised versions are not picked up.
- **Exact versions:** add dependencies with exact versions (`save-exact`), and update them deliberately.
- **Audit:** run `pnpm audit` in CI.

### Responsive input

- **Pointer Events** for mouse, touch and pen. A tap behaves like a mouse click, and actions fire on release, as in the original.
- **No hover dependence.** The original only uses hover for cursor shape. On touch devices, hotspots get no special treatment by default. Optionally, add a brief highlight on tap-down as feedback, without changing the artwork. Desktop keeps the original cursors, scaled to match.
- Prevent the browser's default gestures on the stage (double-tap zoom, pinch, long-press menu, overscroll).
- Keyboard works as in the original on desktop.
- Fullscreen via the Fullscreen API where available. iPhone Safari has no element fullscreen, so use an installable web-app manifest with `display: fullscreen`/`standalone` ("Add to Home Screen") instead.

## 4. Target repository layout

```
docs/                     PLAN.md, CLEAN_ROOM.md, reference-environments.md
docs/formats/             format and behaviour specifications in our own words (implement from these)
packages/formats/         DOM-free decoders: page database, DIB/RLE8, PICS, MS-ADPCM WAV, palette,
                          NE resources, ISO 9660
packages/engine/          DOM-free engine: DataSource interface, page stack, actions, hit-testing,
                          timers, indexed framebuffer
apps/web/                 Vite app: canvas presenter + scaling, Web Audio, pointer/keyboard input,
                          cursors, fullscreen, print and clipboard
apps/server/              tiny static server: dist + /data, used locally and in the container
apps/desktop/             Electron shell (last phase): ISO picker, ISO DataSource, native clipboard/print
tools/data/               data prep: ISO → vendor/cd + manifest
tools/refcapture/         drives the original (Wine/DOSBox-X) to capture reference screens
tools/compare/            renders pages headlessly with the engine and diffs against references; HTML report
tools/ghidra/             Ghidra headless helpers (decompile an address, read vtables)
tools/explore/            exploration scripts written from public format docs (e.g. NE resource dumper)
k8s/                      k3s manifests + apply/sync scripts (modelled on the Encarta project)
wine/, emu/               scripts to run the original
vendor/                   (gitignored) ISO, extracted disc, Wine prefix, DOSBox-X images, references
analysis/decompiled/      (gitignored) Ghidra project, decompiler output, dumps, private oracles
```

Data at runtime: the app fetches `/data/<path>` (e.g. `/data/ARTICLE1/AIRP/AIRP0M.DIB`, `/data/DKCODE/TWTW.PNG`) and resolves names through `/data/manifest.json`. Locally `/data` is `vendor/cd`; in k3s it is the data volume.

## 5. Validation strategy

Validation is a deliverable in its own right. Everything here compares against **data and behaviour**, never against the original's code (clean-room rule 4).

1. **Unit tests on synthetic data.** Each decoder gets small inputs built by hand in the tests (e.g. a 4×2 RLE8 DIB, a two-chunk PICS file, a three-page database). These run on GitHub CI.
2. **Corpus tests.** Vitest suites iterate over every DIB, ANI, WAV and page on the local disc (`vendor/cd`, or `$TWTW_CD`) and check structural invariants: everything parses, cross-references resolve, files are consumed exactly. They **skip with a clear message when the disc is absent** (as on CI). They never copy content into the repo.
3. **Oracle comparison.** The TS database parser's output is compared structurally with the private oracle's JSON (`analysis/decompiled/out/twtw_png.json`, regenerated by `analysis/decompiled/oracles/twtw_png.py`). The TS PICS decoder's frames and PCM are compared with `ani2png.py` output. DIBs are compared with an independent public decoder (e.g. Pillow). The ISO reader is compared with `7z` extraction. Only outputs are compared.
4. **Reference screens.** `tools/refcapture` launches the original under Wine, on a nested X server (see the reference-environments doc), and crawls it. The crawler uses our own database parser to find click targets (hotspot rects and page transitions), so it can reach pages systematically. For each reached screen it saves a 640×480 client-area capture and the action path that led there, to `vendor/ref/<page-offset>/…`. DOSBox-X spot checks confirm the Wine captures; Wine needs the palette patch, and anything Wine draws itself, such as list-box fonts, may differ.
5. **Pixel diffs.** `tools/compare` replays the same action path in the headless engine and diffs the framebuffer against the reference. It writes an HTML report (side by side, diff, percentage) under `vendor/`. Static screens should be exact; live-text screens (Index list, A–Z machine) get a tolerance and a manual check.
6. **Behavioural checks.** For sampled hotspots, the page reached by clicking in the original equals the page our engine navigates to.
7. **Device checks.** Playwright runs at desktop, tablet and phone-landscape viewports and DPRs. It asserts the integer scale chosen, that the canvas backing store matches device pixels, and that tapping a hotspot reaches the right page.
8. **Manual playtest checklist** per milestone, for animation timing, audio sync and feel, on a real tablet and phone.

Investigate early: the original has a "Go to page" dialog (`WM_COMMAND` 0x69) and INI keys such as `Developer`/`TestSwitch` (`program.md`). If a developer mode exposes page jumping, the reference crawler gets much simpler.

## 6. Phases

Each phase ends with its acceptance criteria met, tests passing, and specs in `docs/formats/` updated **before or with** the code (clean-room checklist). Commit only when Alex asks.

### Phase 0 — Bootstrap
Status: **done** (2026-10-14).
- pnpm workspaces with the dependency policy from §3, TypeScript strict, Vitest, Vite, ESLint and Prettier (minimal config).
- `tools/data`: `pnpm data` extracts the ISO from `vendor/` to `vendor/cd` (via `7z` for now) if missing, then writes `vendor/cd/manifest.json`.
- The dev server serves `/data`.
- A lint rule or check that fails on decompiler identifiers (`FUN_`, `DAT_`, `uVar`, …) in `packages/` and `apps/`.
- **Done when:** `pnpm test` runs, `pnpm dev` shows a blank 640×480 canvas, and `/data/manifest.json` loads.

### Phase 1 — `packages/formats`
Status: **done** (2026-10-14). All decoders pass their synthetic, corpus and comparison tests over the whole disc: page database vs. the oracle JSON, PICS vs. the oracle's frames and sound, DIBs vs. Pillow, WAVs vs. ffmpeg, and the ISO reader vs. the 7z extraction. `pnpm data` now uses the ISO reader.
Implement from `docs/formats/`, with unit tests on synthetic data first, then corpus and oracle tests:
- Big-endian stream reader; page database with a typed model (product, templates, A–Z index, pages, panels, objects, handlers, actions). Keep unknown fields as `unknownN`; never drop data.
- DIB (RLE8 and uncompressed 8-bit) → `{width, height, indices, palette}`.
- The master palette (`dib-and-palette.md`).
- PICS → header, sound format, chunks (rect, PCM, unpacked indices), and timing.
- WAV: RIFF parser, MS-ADPCM decoder, 8-bit PCM → Float32.
- NE resource reader for `TWTW.EXE` (palette, cursors, bitmaps for `@NAME` references), written from the public NE format documentation.
- ISO 9660 reader (primary volume descriptor, directories, file extents). Then switch `pnpm data` to it and drop the `7z` dependency.
- **Done when:** §5.1–5.3 pass over the whole disc.

### Phase 2 — Reference capture harness
Status: **done** (2026-10-14). `pnpm refcapture` (`tools/refcapture/README.md`) captured the acceptance set and all 397 base pages into `vendor/ref/` at the Windows 3.1 client size of 638×459. Under Wine, animations stop after 2–3 s, so 23 of the 24 pages that should move on by themselves stall (the title transition reaches the Workshop, with leftovers) (`docs/reference-environments.md`, "Animations under Wine"). "Go to page" is dead in this release (`program.md`); the harness uses the startup-page patch instead.
- `tools/refcapture` on top of `wine/run.sh`, using a nested Xwayland server, `ffmpeg x11grab` and XTEST input (`docs/reference-environments.md`). Locate and crop the 640×480 client area automatically.
- Crawl strategy driven by the database; record action paths; capture a defined "settled" state (animations finished).
- Investigate the "Go to page" / developer-mode shortcut.
- **Done when:** references exist for the title, the Workshop, the A–Z machine, the A–Z list for "A", the Airplane article and one Airplane popup. Then aim for every base page.

### Phase 3 — Static rendering
Status: **done** (2026-10-14). `pnpm compare` (`tools/compare`) replays every capture headlessly and diffs it: 351 of 400 match exactly in the 634×454 area Wine paints, and the other 49 differ only for stated reasons (Wine's animation stall, playing movies, the A–Z lamp, Wine caption colours, transition leftovers). Windows 3.1 popup chrome is still unverified (no DOSBox-X captures yet). Since 2026-10-15 the captures cover the full 638×459 client (refcapture sets `WM_STATE`; sidecars record `wineClient`).
- `DataSource` interface + HTTP implementation. Engine: load the database; instantiate a page with its template and panels (navigation bar and frame via shared panels); draw Bitmap objects; compose popups at their origin. Present at a fixed 1× for now.
- `tools/compare` headless renderer and HTML diff report.
- **Done when:** the Phase 2 reference set matches pixel-exactly, or the residual differences are explained.

### Phase 4 — Interaction and navigation
- Hit-testing (panel-relative rects; topmost object wins; popups take input before the base page), cursors from the EXE resources, event dispatch, and the change page, open popup and close popup actions.
- Pointer Events from the start (tap = click, fire on release).
- Back/history and the page link block (meaning is [H]; confirm it by observing the original).
- Keyboard handling as in the original.
- **Done when:** the behavioural checks pass for a broad hotspot sample and every base page is reachable from the title by clicking.

### Phase 5 — Media
- Sound playback and stop, animation playback (and its unused variants), AnimHotspot, AnimationControl, autostart flags, and the "finished" event.
- Schedule frames against the Web Audio clock using the timing model in `pics.md`. Confirm the model by observing the original (frame captures with timestamps), then update the spec.
- Browsers block audio until a user gesture, so add a "tap to start" gate before the title.
- **Done when:** the title animation, Airplane animations and Workshop sounds play in sync, and the playtest checklist passes.

### Phase 6 — Special screens and the long tail
Status: **done** (2026-10-15). `pnpm compare` over all 1473 reference captures (397 base pages, every popup opener, nav-button paths): 362 exact, 1111 explained, 0 unexplained. Reasons: Wine caption colours, popups whose picture Wine lost (`wineWhitePopup`), playing movies, the animation stall, the A–Z lamp, Index text and transition leftovers. Every type is implemented or consciously dropped (`special-screens.md` §8). Found along the way: a caption redrawn after the picture leaves its bottom border on the picture's first row (the Index; a popup's caption turning inactive); Wine's inactive caption is `808080`.
- A–Z machine (AZDial panel, AZ hotspots), the Index page (list box of the A–Z index; the original uses "MS Serif", so approximate with a canvas or bitmap font and accept a tolerance), WordBox, the custom scroll bar (must also work by touch drag), CancelButton, product options 1–3 (Options screen), the one SendMessage use (181, 59), Help pages, and transitions (`zoom`, `wipeleft`, `wiperight`) if used.
- **Done when:** a full crawl comparison shows no unexplained diffs, and every action and object type is implemented or consciously dropped (noted in the spec).

### Phase 7 — Responsive presentation
Status: **implemented** (2026-10-15); the manual playtest on the kids' tablet and phone is still to do. Integer nearest-neighbour scaling of the 638×459 client area (Alex: as the original), portrait screen, fullscreen and manifest, prefetching, settings menu, Index soft keyboard. `pnpm test:devices` (Playwright) checks 9 viewports.
- The scaling rules and responsive input from §3, the portrait-phone screen, fullscreen and installable web-app manifest, preloading/caching for snappy navigation, and a small settings menu (fill mode, volume) outside the original's frame.
- **Done when:** the device checks (§5.7) pass, and the kids can use it locally on a tablet, a laptop and a phone in landscape without help.

### Phase 8 — Print and copy (last web-app feature phase)
Status: **implemented** (2026-10-15). Copy puts a 2× PNG of the captioned picture on the clipboard (fallback: an overlay with Save picture); Print uses the browser's dialog with a 4× picture, centred (Alex's decision). Copy and Printer Setup confirmed under Wine. Still to check by hand: Safari and Firefox print preview, real paper, copy on iPad Safari.
- First establish, by observing the original in the reference environment, what it prints and copies (base picture, popup, caption, layout). Write it into `program.md`.
- **Copy:** put the same picture on the clipboard as PNG, at native 640×480 or an integer upscale, via `navigator.clipboard.write` with a `ClipboardItem`. This requires a secure context, which `localhost` and the HTTPS deployment both provide. Fallback when unavailable: show the picture as an `<img>` so long-press/right-click "Copy image" works, plus a "Save picture" download.
- **Print:** use the browser's native print dialog (`window.print()`). Build a print-only DOM (hidden on screen) and a print stylesheet:
  - the picture as an integer-upscaled, nearest-neighbour PNG large enough for a sharp printout (e.g. 4× = 2560×1920), sized to fit the paper with `image-rendering: pixelated`;
  - the title or caption as the original prints it;
  - `@page` margins and orientation chosen per picture aspect;
  - all UI and letterboxing hidden.

  Check output in Chrome, Safari and Firefox print preview, and on paper.
- Expose Print and Copy in the settings menu and keep the original shortcuts on desktop.
- **Done when:** copy works (or falls back gracefully) on desktop and tablet browsers, and printouts look good on A4 and Letter.

### Phase 9 — Deployment on k3s
Model this on the Encarta project (`~/projects/encarta/k8s/`, `.github/workflows/container.yml`, `Dockerfile`); read those first.
- **Image:** a `Dockerfile` building `apps/web` and `apps/server` into a small image that runs as non-root on a read-only root filesystem and serves `/data` from a mounted volume. A GitHub Actions workflow builds it on every push, smoke-tests it against an **empty** `/data` (health endpoint plus the SPA), and on `main` pushes to `ghcr.io/axle-h/…` tagged `latest` and with the commit. The image and CI contain no disc data.
- **Manifests in `k8s/`:**
  - a namespace;
  - a Deployment, Service and PVC (`local-path`);
  - an HTTP→HTTPS redirect middleware;
  - an ingress template using the traefik ingress class and cert-manager's `letsencrypt-production` ClusterIssuer;
  - `apply.sh`, which takes the public hostname from `$TWTW_HOST` or the gitignored `k8s/host.local`;
  - `sync-data.sh`, which mirrors `vendor/cd` onto the volume through a temporary loader pod with rsync over `kubectl exec`.
- **Access:** public, with no IP restriction (Alex's decision, as for Encarta). The only protection is that the hostname is not published anywhere. It must never appear in the repository, CI logs, commit messages, docs or screenshots: `apply.sh` reads it from `$TWTW_HOST` or the gitignored `k8s/host.local`, and the ingress is a template with a placeholder. Serve a `robots.txt` that disallows everything, and add `X-Robots-Tag: noindex`.
- **Done when:** the app is reachable at its HTTPS hostname from the kids' devices, Copy works there (secure context), and `git grep` for the hostname finds nothing.

### Phase 10 — Desktop app (Electron, bring your own ISO)
- `apps/desktop`: Electron loading the same web build. On first run, ask the user to choose their `.iso` (or a mounted disc), validate it (volume label `DKMMTWTW` plus a checksum of `DKCODE/TWTW.PNG`), and remember the path. Serve data from the ISO through the ISO `DataSource`, so no extraction is needed. Use native clipboard and print through Electron APIs.
- CI builds unsigned Windows, macOS and Linux packages and attaches them to GitHub releases. A CI step scans the artefacts and fails if any disc-derived file is found. The README explains that users must supply their own disc image.
- **Done when:** a fresh machine with only the release download and an ISO runs the app.

## 7. Working rules for agents

- Read `CLAUDE.md`, `docs/CLEAN_ROOM.md`, this plan and `docs/formats/` first.
- **Never write TypeScript with decompiler output or the oracle source open.** If a spec is unclear, investigate (decompile with `tools/ghidra/dec.sh`, observe the original, measure the data), write the answer into `docs/formats/` in your own words, then implement from the spec.
- Mark findings as [V] verified, [C] read from code, or [H] hypothesis.
- Prefer observing the original over guessing.
- Keep `packages/formats` and `packages/engine` free of DOM APIs so they run in Node.

## 8. Known unknowns

- Unnamed fields: sound and animation action parameters, AnimationControl extras. (Solved: the NavPanel's nine `i16` values, the template flag blocks and the object flags; see `page-database.md` and `rendering.md`.)
- ~~The page link block.~~ Solved: the four links replace the targets of four navigation buttons (`page-database.md`).
- ~~The exact PICS frame timing rule.~~ Read from the code (`pics.md`, `playback.md`); a measured check against the original is still to do.
- ~~What WordBox (660 instances) does.~~ Nothing: every WordBox has an empty rectangle and no handlers (`behaviour.md`).
- ~~Where the transitions are used.~~ Found: ChangePage's `u16` is a panel transition id (always 0 on the disc), OpenPage's `u16` selects the zoom effect (`page-database.md`).
- ~~How the Index page and Options behave.~~ Read from the code (`docs/formats/special-screens.md`); captures still to do.
- ~~What exactly the original prints and copies.~~ Read from the code: the target page's picture with a 40-row copyright band, printed top-left at 640-pixels-to-the-width scale (`special-screens.md` §4); to confirm in DOSBox-X before Phase 8.

## 9. Decisions

Settled by Alex:
- responsive for tablet, desktop and phone landscape;
- scaling without smoothing that loses no detail;
- native browser printing, formatted for paper, as the last web-app feature;
- clipboard copy;
- k3s deployment with public DNS and Let's Encrypt, as for Encarta, done after the web app. It is publicly reachable with no allow-list, and its hostname is never committed;
- Electron desktop app last, bring-your-own-ISO, published on GitHub;
- public repository under a clean-room policy modelled on the Encarta project;
- MIT licence for the code (`LICENSE`).
- the web app presents the original's 638×459 client area, not the whole 640×480 framebuffer (2026-10-15). Checked: no base page draws outside it, and no popup in the 1,462 captured screens extends past it;
- printouts are centred on the sheet, not top-left as in the original (2026-10-15).

No open questions at present.
