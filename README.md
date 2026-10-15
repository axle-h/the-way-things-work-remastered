# The Way Things Work: remastered

A clean-room TypeScript re-implementation of the engine behind Dorling Kindersley's *The Way Things Work* CD-ROM (1994, Windows 3.1). It plays the original disc content in a modern browser, on tablets, desktops and phones in landscape, and in a desktop app for Windows, macOS and Linux.

**This repository, and every build and release made from it, contains no DK or Microsoft code or content. You need your own copy of the CD**: the web app serves an extracted copy of it, and the desktop app reads your disc image (`.iso`) or the CD itself.

- **Status:** all phases implemented (2026-10-15). The web app plays the whole disc and is deployed on k3s; the desktop app (bring your own ISO) builds for Linux, Windows and macOS. Still to do by hand: playtests on real tablets and phones, Safari/Firefox printing, and running the Windows and macOS desktop builds.
- **Architecture:** [docs/architecture.md](docs/architecture.md), how it is built and checked, and the decisions behind it.
- **Clean-room policy:** [docs/CLEAN_ROOM.md](docs/CLEAN_ROOM.md), how the formats are learned without copying code.
- **Format specifications:** [docs/formats/](docs/formats/README.md), every format on the disc and its status.

## How it works

The original is a small generic engine (`TWTW.EXE`) driven entirely by data on the disc:

- a compiled page database (`TWTW.PNG`, despite the name);
- 8-bit bitmaps (`.DIB`);
- DK's own animation format (`.ANI`);
- MS-ADPCM sounds (`.WAV`).

The remake decodes those original files directly, in TypeScript, from specifications written in our own words. It draws them to a `<canvas>` at the original 640×480 in 256 colours, scaled up by whole pixels without smoothing.

- **Web app:** serves an extracted copy of the disc.
- **Desktop app:** reads your disc image directly, without extracting it.

Correctness is checked screen by screen against the original program, which is run automatically under Wine or DOSBox-X (Windows 3.1) to capture reference screenshots. Those captures stay private.

## Layout

```
docs/                    plan, clean-room policy, reference environments
docs/formats/            format specifications
packages/formats/        DOM-free decoders for the disc formats
packages/engine/         DOM-free engine (indexed framebuffer, data manifest)
apps/web/                Vite web app (canvas)
apps/server/             tiny static server: the built app plus /data
apps/desktop/            Electron desktop app around the same web build: bring your own disc image
tools/data/              `pnpm data`: extract the ISO and write the data manifest
tools/cleanroom/         `pnpm check:cleanroom`: rejects decompiler identifiers
tools/ghidra/            Ghidra headless helpers
tools/explore/           exploration scripts (NE resource dumper)
k8s/                     k3s deployment: manifests, apply and data-sync scripts
wine/                    run the original under Wine (with a palette fix)
emu/                     run the original in DOSBox-X on MS-DOS 6.22 + Windows 3.1
vendor/                  your disc image, extracted files, emulator disks  (gitignored)
analysis/decompiled/     Ghidra project and output                       (gitignored, never committed)
```

## Requirements

- Your disc image in `vendor/`, e.g. `vendor/Way Things Work, The (1994)(Dorling Kindersley).iso`.
- Node.js 24+ and pnpm (the version pinned in `package.json`, e.g. via `corepack enable`). Use pnpm, never npm or yarn.
- `python3`, for the reference environments and exploration scripts. `pnpm data` needs only Node.
- Optional, for the reference environments: Wine with Win16 support (e.g. Fedora's wine 11), `dosbox-x`, `mtools`, `ffmpeg`, `Xwayland`. Ghidra for further analysis.

## Usage

```
pnpm install       # dependencies (CI uses --frozen-lockfile)
pnpm data          # extract the ISO to vendor/cd if needed, write vendor/cd/manifest.json
pnpm dev           # dev server at http://localhost:5173, with /data served from vendor/cd
pnpm test          # all unit tests; corpus tests read vendor/cd (or $TWTW_CD) and skip without it
pnpm test:devices  # Playwright device checks (Chromium, viewports and DPRs; apps/web/README.md); skip without the disc
pnpm lint          # ESLint and the clean-room identifier check
pnpm typecheck
pnpm format        # Prettier
pnpm build && pnpm serve   # production build, served at http://127.0.0.1:8080 (PORT, HOST)
pnpm desktop       # the desktop app, run from source (asks for your disc image on the first start)
pnpm desktop:package   # package the desktop app for this computer in apps/desktop/dist/release
```

`$TWTW_CD` points the tools and servers at an extracted disc elsewhere; `$TWTW_ISO` picks the image when `vendor/` holds more than one.

## Deployment

The web app ships as a container image with no disc data in it: `Dockerfile`, built, checked and pushed to GHCR by `.github/workflows/container.yml`. On k3s the extracted disc lives on a volume, synced from `vendor/cd`. See [k8s/README.md](k8s/README.md).

## Desktop app

`apps/desktop` wraps the same web build in Electron. On the first start it asks for your disc image (`.iso`) or the CD in its drive, checks that it is *The Way Things Work* (volume label `DKMMTWTW` and a checksum of `DKCODE/TWTW.PNG`), remembers it, and reads it in place. Copy and Print use the system clipboard and print dialog. Unsigned builds for Windows, macOS and Linux are built by `.github/workflows/desktop.yml` on a version tag and attached to the GitHub release, after a check that no artefact holds disc data. **The releases contain no disc content: you need your own disc image.** See [apps/desktop/README.md](apps/desktop/README.md) for using, building and the security model.

## Running the original today

```
wine/run.sh     # under Wine
emu/twtw.sh     # under DOSBox-X: MS-DOS 6.22 + Windows 3.1 (you build the disk image yourself; see docs/reference-environments.md)
```

## Licence

The code and documentation in this repository are under the [MIT licence](LICENSE). *The Way Things Work* and its content are © 1994 Dorling Kindersley and Houghton Mifflin, and are not part of this project.
