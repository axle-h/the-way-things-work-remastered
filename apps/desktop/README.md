# @twtw/desktop

The desktop app (docs/PLAN.md Phase 10): Electron around the web app's own build, reading **your own disc image** of *The Way Things Work* (Dorling Kindersley, 1994). Unsigned builds for Windows, macOS and Linux are attached to the GitHub releases.

**The app contains no DK content. You need your own copy of the CD**, as a disc image (`.iso`) or the CD itself in a drive. The app reads it where it is: nothing is extracted, copied or sent anywhere.

## Using it

1. Download the archive for your computer from the release and unpack it:
   - **Windows:** `the-way-things-work-<version>-windows-x64.zip`. Run `the-way-things-work.exe`. The build is unsigned, so SmartScreen may warn: *More info → Run anyway*.
   - **macOS:** `…-macos-arm64.zip` (Apple silicon) or `…-macos-x64.zip` (Intel). The app is unsigned (ad-hoc signed only), so Gatekeeper blocks the first start: right-click *The Way Things Work.app → Open*, or run `xattr -dr com.apple.quarantine "The Way Things Work.app"`.
   - **Linux:** `…-linux-x64.tar.gz`. Run `./the-way-things-work` in the unpacked folder. Where unprivileged user namespaces are restricted (Ubuntu 24.04 and later) Electron's sandbox cannot start from an unpacked folder; give its helper the setuid bit once: `sudo chown root:root chrome-sandbox && sudo chmod 4755 chrome-sandbox`.
2. On the first start the app asks for the disc: **Choose a disc image…** (an `.iso` of the CD) or **Choose the CD drive or folder…** (the CD in its drive, or a folder holding a copy of its files).
3. It checks that this is the disc it knows: the image's volume label is `DKMMTWTW`, and the SHA-256 of `DKCODE/TWTW.PNG` matches. Anything else is turned down with the reason (not a CD image, another CD, another edition).
4. The app remembers the disc (`config.json` in the app's user data folder) and starts with it next time. **Settings (the gear) → Change disc…** chooses another one. If the remembered disc has moved, the chooser says so.

The app then behaves as the web app does (`apps/web/README.md`), with three differences: there is no "tap to start" (the title starts at once, with sound, as the original did), **Copy picture** puts the picture on the system clipboard, and the settings have **Change disc…**. **Print** opens the system print dialog with the same print layout as the browser.

## Building and running

From the repository root, with Node 24+ and pnpm:

```
pnpm install                 # frozen lockfile on CI
pnpm desktop                 # build the web app and dist/app, then run it in Electron
pnpm desktop:package         # build, package for this computer in dist/release, check the artefacts
```

Or step by step in this package: `pnpm --filter @twtw/desktop build`, `… start`, `… run package [--arch x64|arm64]` and `… check:artefacts [paths…]`. Packaging is for the computer's own platform; `--platform win32|darwin|linux` packages for another one (without the macOS signature), which is how the artefact check was tried on all three from Linux.

Electron's binary is downloaded the first time it is used (`pnpm desktop`, the tests, or packaging), from Electron's GitHub releases, and checked against the SHA-256 sums shipped in the `electron` npm package.

**Tests.**
- Unit tests (`pnpm test` at the root): the `app:` routes and CSP, the config, the disc checks on synthetic disc images and folders, the artefact rules and the icon containers. `src/main/disc.corpus.test.ts` checks the real disc against the desktop's checks when it is there (`$TWTW_ISO` or the only `.iso` in `vendor/`, and `vendor/cd` or `$TWTW_CD`), and skips otherwise.
- Smoke tests: `pnpm --filter @twtw/desktop test:e2e` (Playwright's Electron driver, on the built `dist/app`). Without a disc: the chooser on the first run, refusing a text file, another CD's image, a look-alike with the right label, and an empty folder; a remembered disc that has gone. With the disc image: the title starts without a tap, a hotspot on the Airplane page reaches its page, Copy puts the 2× picture on the system clipboard, the next start goes straight to the app, and Change disc… goes to the chooser and back. The system file dialog is replaced, in the main process, by one answering with the test's path. Electron needs a display: on Linux without one, run under `xvfb-run -a` or a nested X server; set `TWTW_SCREENSHOTS=<dir>` to save screenshots (they show disc content: keep them out of git).

## How it works

```
dist/app/                 what is packaged (into app.asar)
  main.js                 main process (src/main), bundled with @twtw/engine, formats and node
  preload.cjs             the bridge (src/preload.ts)
  desktop/                the disc chooser page (src/picker)
  web/                    apps/web/dist, unchanged
  package.json
```

- **One build of the web app.** The window loads `app://twtw/`, a custom protocol served by the main process (`src/main/routes.ts`): `/data/manifest.json` and `/data/<path>` are the user's disc, `/desktop/…` the chooser, anything else the web build. So the web app finds the disc at `/data/`, as in a browser, and its HTTP data source, prefetching and cache work unchanged.
- **The seam in the web app** is `apps/web/src/host.ts`: it finds the desktop bridge (`window.twtwDesktop`, typed in `apps/web/src/desktop-bridge.ts`) and then takes the clipboard and Change disc from it, and starts without the gate. Without the bridge it is the browser, as before.
- **The disc** (`src/main/disc.ts`): a disc image is opened through a file handle and read with the project's ISO 9660 reader (`IsoDataSource` in `@twtw/engine`, over `openIso` in `@twtw/formats`): each request reads just that file's bytes, so the 280 MB image is never loaded whole. A folder is read with `DirectoryDataSource` (`@twtw/node`), names matched ignoring case (a CD mounted on Linux may show lower-case names).
- **Copy:** the web app makes the PNG (2× the captioned picture, as in the browser) and hands its bytes over the bridge; the main process checks that it is a PNG that decodes (`nativeImage`) and writes it with `clipboard.write` and a `ClipboardItem` (Electron 44 replaced `clipboard.writeImage` with these).
- **Print:** `window.print()` as in the browser. Electron shows the system print dialog and prints with the web app's print stylesheet; checked on Linux (GTK dialog, *Print to File*: one landscape A4 page with the centred picture and its copyright line).

## Security

- Every page runs with `contextIsolation`, `sandbox` and no Node integration; `app.enableSandbox()` sandboxes every renderer. The pages get exactly the bridge's six members (`DesktopBridge`), each one IPC message; the main process answers only messages from our own window and origin, and checks their arguments. The file dialogs are the main process's own, so a page cannot name a file to read.
- **Content-Security-Policy** on every response: `default-src 'none'`, scripts, styles, pictures and fetches from our origin only (plus `data:`/`blob:` pictures and inline styles, which the web app's print and cursors use). No inline or evaluated script.
- **Nothing remote:** every request that is not `app:`, `data:`, `blob:` or DevTools is cancelled; navigation away from `app://twtw`, new windows and `<webview>` are refused; the only permission a page may have is full screen; the spell checker (which downloads dictionaries) is off. DevTools exist only in unpackaged runs.
- **Fuses** (`scripts/package.ts`, `@electron/fuses`): no running as Node (`ELECTRON_RUN_AS_NODE`), no `NODE_OPTIONS`, no `--inspect`, code only from `app.asar`, no extra `file:` privileges, cookie encryption on. Embedded asar integrity validation is left off until it has been tried on Windows and macOS.

## Packaging, CI and the artefact check

**Packager.** `@electron/packager`, Electron's own packaging library (the step Electron Forge runs before its makers), with archives made by the system's `tar`, `zip` or `ditto`. It was the smallest of the options, measured by resolving each into an empty project under the same pnpm policy:

| Option | Packages in the lockfile |
|---|---|
| `electron` alone | 13 |
| `@electron/packager` | 48 |
| `@electron-forge/cli` (before any maker) | 126 |
| `electron-builder` | 264 |

electron-builder also downloads further tools at build time (`app-builder-bin`, NSIS, AppImage tooling); Forge adds its CLI, plugin system and a dependency per maker. Packager does one auditable thing: copy Electron's release, put the app in an asar, rename and set icons and metadata (`resedit` on Windows, `plist` on macOS). The costs: no installers (zip and tar.gz instead), no AppImage, and no auto-update (none is wanted). `@electron/fuses` (no dependencies) flips the fuses and re-signs macOS builds ad hoc, which Apple silicon requires.

**CI** (`.github/workflows/desktop.yml`): on a `v*` tag, or by hand, it builds on Ubuntu, Windows and macOS (arm64 and x64), checks the artefacts, runs the smoke tests on Linux under `xvfb-run`, and uploads them; on a tag it attaches them with `SHA256SUMS.txt` to the tag's release, creating it as a draft if there is none. Actions are pinned by commit SHA. No disc data is involved anywhere.

**Artefact check** (`scripts/check-no-disc-data.ts`, rules in `scripts/disc-scan.ts`): unpacks each archive and every `app.asar` in it, and fails on:
- a disc file name, in any case: `.ANI`, `.DIB`, `.WAV`, `.ISO`, `TWTW.PNG`, `TWTW.EXE`;
- a `manifest.json` anywhere;
- contents that start like a disc file: a RIFF WAVE, a Windows bitmap file, a PICS animation, an ISO 9660 image, a 16-bit (NE) Windows program;
- the disc's `TWTW.PNG` under any name (by its SHA-256);
- inside the app, any file over 1 MiB or more than 8 MiB in all; beside it, any file over 1 MiB that is not one of Electron's own (executables, libraries, `.pak`, ICU data, V8 snapshots, the Chromium licences, macOS frameworks and helpers).
