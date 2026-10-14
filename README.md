# The Way Things Work: remastered

A clean-room TypeScript re-implementation of the engine behind Dorling Kindersley's *The Way Things Work* CD-ROM (1994, Windows 3.1). It plays the original disc content in a modern browser, on tablets, desktops and phones in landscape. A desktop app is planned.

**This repository contains no DK or Microsoft code or content. You need your own copy of the CD.**

- **Status:** planning. The data formats are reverse engineered and specified, and the original runs in two reference environments. The engine itself is not written yet.
- **Plan:** [docs/PLAN.md](docs/PLAN.md), the step-by-step roadmap.
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
- **Desktop app (planned):** will read your ISO directly.

Correctness is checked screen by screen against the original program, which is run automatically under Wine or DOSBox-X (Windows 3.1) to capture reference screenshots. Those captures stay private.

## Layout

```
docs/                    plan, clean-room policy, reference environments
docs/formats/            format specifications
tools/ghidra/            Ghidra headless helpers
tools/explore/           exploration scripts (NE resource dumper)
wine/                    run the original under Wine (with a palette fix)
emu/                     run the original in DOSBox-X on MS-DOS 6.22 + Windows 3.1
vendor/                  your disc image, extracted files, emulator disks  (gitignored)
analysis/decompiled/     Ghidra project and output                       (gitignored, never committed)
```

## Requirements

- Your disc image in `vendor/`, e.g. `vendor/Way Things Work, The (1994)(Dorling Kindersley).iso`.
- Node.js 22+ for the remake (once implemented).
- `7z` to extract the ISO, and `python3`.
- Optional, for the reference environments: Wine with Win16 support (e.g. Fedora's wine 11), `dosbox-x`, `mtools`, `ffmpeg`, `Xwayland`. Ghidra for further analysis.

## Running the original today

```
wine/run.sh     # under Wine
emu/twtw.sh     # under DOSBox-X: MS-DOS 6.22 + Windows 3.1 (you build the disk image yourself; see docs/reference-environments.md)
```

## Licence

The code and documentation in this repository are under the [MIT licence](LICENSE). *The Way Things Work* and its content are © 1994 Dorling Kindersley and Houghton Mifflin, and are not part of this project.
