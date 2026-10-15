# Architecture

How the remake is built and checked, and the decisions behind it. The formats and the original's behaviour are specified in `docs/formats/`; the clean-room rules are in `docs/CLEAN_ROOM.md`.

## Goal

Re-implement the engine of Dorling Kindersley's *The Way Things Work* (1994, Windows 3.1, 16-bit) in TypeScript, so the original CD content plays on modern devices, looking and behaving like the original screen by screen.

- **Web app**, responsive for tablets, desktops and phones in landscape, deployed on k3s (`k8s/README.md`). The hostname never appears in the repository.
- **Desktop app** (Electron, `apps/desktop`): "bring your own ISO", released on GitHub.
- **Fidelity first.** The original runs at 640×480 with 256 colours. Match it pixel for pixel, then add presentation (responsive scaling, touch, print, clipboard) on top without changing the content.
- **No smoothing.** Scaling never blurs or filters the artwork ("Scaling rules").

## Architecture decisions

| Decision | Choice | Why |
|---|---|---|
| Language | TypeScript (strict) | One codebase for browser, Node tests and the Electron app |
| Rendering | Plain `<canvas>`, no React and no game framework | The content is fixed 640×480 bitmaps, hotspots and popups. React may be used for dev tools or the desktop disc chooser only |
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

1. **Fill (the default).** Draw the presented area (the original's 638×459 client area; see Decisions) at the largest scale that fits the viewport, keeping its aspect ratio, using nearest-neighbour (`imageSmoothingEnabled = false`). The picture spans the full width or the full height, whichever limits it. Centre the result and letterbox the rest with a neutral colour. At a non-integer scale the pixels become slightly uneven, but nothing is blurred. Examples: a 1080p monitor gives 2.353× (1501×1080); a typical phone in landscape (about 2532×1170 device px) gives 2.549×.
2. **Smaller than native (scale < 1).** This is rare and only happens on very small or low-DPR viewports. Content must shrink, and shrinking cannot preserve every pixel. Use nearest-neighbour at the largest fractional scale that fits. Never use a smoothing filter. Log it in the debug overlay so it is noticed.
3. **Optional integer mode** (a user setting: "Fill the screen" off): the largest integer scale `k ≥ 1` that fits. Every source pixel becomes a k×k block, so pixels stay perfectly even. Examples: a 1080p monitor gives 2× (1276×918); a 4K monitor gives 4×; a typical phone in landscape gives 2×; an iPad gives 2× or 3×.
4. **Hit-testing** maps pointer coordinates back through the same transform. Pointer events are converted to framebuffer (page) coordinates in exactly one place.
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

## Repository layout

```
docs/                     architecture.md, CLEAN_ROOM.md, reference-environments.md
docs/formats/             format and behaviour specifications in our own words (implement from these)
packages/formats/         DOM-free decoders: page database, DIB/RLE8, PICS, MS-ADPCM WAV, palette,
                          NE resources, ISO 9660
packages/engine/          DOM-free engine: DataSource interface, page stack, actions, hit-testing,
                          timers, indexed framebuffer
apps/web/                 Vite app: canvas presenter + scaling, Web Audio, pointer/keyboard input,
                          cursors, fullscreen, print and clipboard
apps/server/              tiny static server: dist + /data, used locally and in the container
apps/desktop/             Electron shell: disc chooser, the user's ISO read in place, native clipboard
tools/data/               data prep: ISO → vendor/cd + manifest
tools/refcapture/         drives the original (Wine/DOSBox-X) to capture reference screens
tools/compare/            renders pages headlessly with the engine and diffs against references; HTML report
tools/cleanroom/          the clean-room identifier scan run by `pnpm lint`
tools/ghidra/             Ghidra headless helpers (decompile an address, read vtables)
tools/explore/            exploration scripts written from public format docs (e.g. NE resource dumper)
k8s/                      k3s manifests + apply/sync scripts (modelled on the Encarta project)
wine/, emu/               scripts to run the original
vendor/                   (gitignored) ISO, extracted disc, Wine prefix, DOSBox-X images, references
analysis/decompiled/      (gitignored) Ghidra project, decompiler output, dumps, private oracles
```

Data at runtime: the app fetches `/data/<path>` (e.g. `/data/ARTICLE1/AIRP/AIRP0M.DIB`, `/data/DKCODE/TWTW.PNG`) and resolves names through `/data/manifest.json`. Locally `/data` is `vendor/cd`; in k3s it is the data volume.

## Validation

Validation is a deliverable in its own right. Everything here compares against **data and behaviour**, never against the original's code (clean-room rule 4).

1. **Unit tests on synthetic data.** Each decoder gets small inputs built by hand in the tests (e.g. a 4×2 RLE8 DIB, a two-chunk PICS file, a three-page database). These run on GitHub CI.
2. **Corpus tests.** Vitest suites iterate over every DIB, ANI, WAV and page on the local disc (`vendor/cd`, or `$TWTW_CD`) and check structural invariants: everything parses, cross-references resolve, files are consumed exactly. They **skip with a clear message when the disc is absent** (as on CI). They never copy content into the repo.
3. **Oracle comparison.** The TS database parser's output is compared structurally with the private oracle's JSON (`analysis/decompiled/out/twtw_png.json`, regenerated by `analysis/decompiled/oracles/twtw_png.py`). The TS PICS decoder's frames and PCM are compared with `ani2png.py` output. DIBs are compared with an independent public decoder (e.g. Pillow). The ISO reader is compared with `7z` extraction. Only outputs are compared.
4. **Reference screens.** `tools/refcapture` launches the original under Wine, on a nested X server (see the reference-environments doc), and crawls it. The crawler uses our own database parser to find click targets (hotspot rects and page transitions), so it can reach pages systematically. For each reached screen it saves a 638×459 client-area capture and the action path that led there, to `vendor/ref/<page-offset>/…`. DOSBox-X spot checks confirm the Wine captures; Wine needs the palette patch, and anything Wine draws itself, such as list-box fonts, may differ.
5. **Pixel diffs.** `tools/compare` replays the same action path in the headless engine and diffs the framebuffer against the reference. It writes an HTML report (side by side, diff, percentage) under `vendor/`. Static screens should be exact; live-text screens (Index list, A–Z machine) get a tolerance and a manual check.
6. **Behavioural checks.** For sampled hotspots, the page reached by clicking in the original equals the page our engine navigates to.
7. **Device checks.** Playwright runs at desktop, tablet and phone-landscape viewports and DPRs. It asserts the scale chosen, that the canvas backing store matches device pixels, and that tapping a hotspot reaches the right page.
8. **Manual playtest checklist** per milestone, for animation timing, audio sync and feel, on a real tablet and phone.

## Decisions

Settled by Alex:
- responsive for tablet, desktop and phone landscape;
- scaling without smoothing that loses no detail;
- native browser printing, formatted for paper;
- clipboard copy;
- k3s deployment with public DNS and Let's Encrypt, as for Encarta. It is publicly reachable with no allow-list, and its hostname is never committed;
- Electron desktop app, bring-your-own-ISO, published on GitHub;
- public repository under a clean-room policy modelled on the Encarta project;
- MIT licence for the code (`LICENSE`);
- the web app presents the original's 638×459 client area, not the whole 640×480 framebuffer (2026-10-15). Checked: no base page draws outside it, and no popup in the 1,462 captured screens extends past it;
- printouts are centred on the sheet, not top-left as in the original (2026-10-15).
