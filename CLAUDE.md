# CLAUDE.md

This is a clean-room TypeScript re-implementation of the engine for DK's *The Way Things Work* (1994, Win16). It plays the original CD content in a browser.

- **Web app:** for Alex's kids, from a CD he owns. Deployed last to his k3s server.
- **Desktop app:** a bring-your-own-ISO Electron app, published on GitHub, built in the last phase.
- **The repository is public.**

Read first: `docs/PLAN.md` (plan, phases, status), `docs/CLEAN_ROOM.md` (rules for using reverse engineering), `docs/formats/` (specs to implement from) and `docs/reference-environments.md` (running the original).

## Hard rules

- **Clean room** (`docs/CLEAN_ROOM.md`):
  - Decompiler output, Ghidra exports and the prototype Python parsers live only in `analysis/decompiled/` (gitignored). Never copy from them into the repo.
  - Never write TypeScript with them open; implement from `docs/formats/`, and update the spec first.
  - No decompiler identifiers (`FUN_`, `DAT_`, `uVar`, `param_`, …) in `packages/` or `apps/`.
- **No disc bytes in git.** `vendor/` (gitignored) holds the ISO, the extracted disc (`vendor/cd`), the Wine prefix, the DOSBox-X disk images, patched binaries and reference captures. Tests, fixtures, snapshots and docs must not contain disc-derived content. Unit tests use synthetic data. Corpus tests read `vendor/cd` (or `$TWTW_CD`) and skip when it is absent.
- **The original program is data, never code**, in the remake. Parse `TWTW.EXE` as an NE resource container only. It runs only in the reference environments.
- **Git is read-only** unless Alex explicitly asks: no commit, reset, rebase, etc.
- **Follow the approved plan** (`docs/PLAN.md`): work through the phases in order, and check with Alex before changing scope or architecture.
- **Kill only processes you started.** `pkill -f winevdm` matches your own shell; use `pkill -f '[w]inevdm.exe'`.
- **Never publish the deployment hostname**, nor Alex's other hostnames or home IP. They must not appear anywhere in the repo, commit messages or CI output. `k8s/host.local` and `$TWTW_HOST` stay out of git.

## Conventions

- **Stack:** TypeScript strict, **pnpm** workspaces (never npm or yarn; follow PLAN §3 "Dependency policy": frozen lockfile, install scripts blocked unless allow-listed, minimum release age, exact versions), Vitest, Vite.
- **DOM-free core:** `packages/formats` and `packages/engine` must not use DOM APIs, so they run headless in Node for pixel tests.
- **Indexed rendering:** the engine renders into an 8-bit indexed 640×480 framebuffer; conversion to RGBA happens only in `apps/web` or the compare tool.
- **Original files only:** decode the original disc files at runtime and do not add asset conversion pipelines.
- **DataSource:** all file access goes through the `DataSource` interface (HTTP + manifest for the web app, ISO 9660 for the desktop app). Lookups ignore case, because database names are mixed case and disc files are upper case.
- **Scaling:** never let the browser resample, and never smooth. Use integer nearest-neighbour scaling in device pixels (PLAN §3 "Scaling rules").
- **Byte order:** the page database (`TWTW.PNG`) is big-endian; `.ANI`, `.DIB` and `.WAV` are little-endian.
- **Unknown fields:** keep them as `unknownN` values instead of dropping them.
- **Specs:** mark findings in `docs/formats/` as [V] verified, [C] read from code, or [H] hypothesis.

## Reverse engineering (private, for understanding only)

- **Ghidra project:** `analysis/decompiled/ghidra/`. Ghidra lives in `$GHIDRA_HOME`, default `~/ghidra`.
- **Read a decompiled function:**
  - `tools/ghidra/fn.sh 1018_8534` prints it from the first-pass export;
  - `tools/ghidra/dec.sh /tmp/out.c 1008:0b44` decompiles any address. Auto-analysis misses the virtual `Read` methods, so use `dec.sh` for those.
- **Addresses** are `segment:offset` with Ghidra selectors (`1000` = NE segment 1, `12c0` = DGROUP). They may appear in specs as provenance.
- **Oracle output:**
  - `python3 -I analysis/decompiled/oracles/twtw_png.py vendor/cd/DKCODE/TWTW.PNG --json OUT`;
  - `ani2png.py`.

  Compare only the outputs.

## Running and seeing the original

- **Launch:**
  - `wine/run.sh` (fast, needs a palette patch);
  - `emu/twtw.sh` (DOSBox-X: MS-DOS 6.22 and Windows 3.1, authentic).
- **Capture:** the desktop is GNOME Wayland, which blocks screen capture. Run apps on a nested `Xwayland :5`, capture with `ffmpeg -f x11grab`, and send input with `emu/xdrive.py` (XTEST via python-xlib, installed in a venv). Details are in `docs/reference-environments.md`.
- **Deployment model:** follows `~/projects/encarta` (`k8s/`, `Dockerfile`, `.github/workflows/container.yml`).
