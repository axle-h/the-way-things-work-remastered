# Clean-room policy

This project rebuilds Dorling Kindersley's *The Way Things Work* (1994) on a modern stack. It does so by **understanding** the disc's data formats and the original program's behaviour, then writing original code that reads the data. We never copy DK's or Microsoft's code into the project. The repository is public.

## What belongs to whom

| Theirs (never committed, never shipped) | Ours (this repository) |
|---|---|
| The disc image and every file on it: `TWTW.EXE`, `TWTW.PNG`, bitmaps, animations, sounds, DLLs, setup scripts | Format specifications written in our own words (`docs/formats/`) |
| Anything derived mechanically from their code: decompiler or disassembler output, segment and resource dumps, the Ghidra project | TypeScript decoders, engine, web app and desktop app written from those specifications |
| Content extracted or converted from the disc: images, audio, page dumps, string tables | Generic tooling: Ghidra helper scripts, NE resource explorer, data-prep and capture harnesses |
| Captures from the original program (screenshots, recordings) | Synthetic test data we create ourselves |
| MS-DOS, Windows 3.1, and the third-party drivers used in the reference environment | Scripts that set up and drive the reference environments |

Each user supplies their own copy of the disc. The project distributes code only.

## Where knowledge may come from

1. **Observing the data**: hex dumps, statistics, trial parsing, comparing files.
2. **Public documentation** of shared formats: Windows NE executables and resources, BMP/DIB with RLE8, RIFF WAVE, MS-ADPCM, ISO 9660, and Windows palette semantics. Also open-source libraries under compatible licences.
3. **Black-box behaviour** of the original program in the reference environments (Wine, or DOSBox-X with MS-DOS 6.22 and Windows 3.1; see `reference-environments.md`): what it displays and how it responds.
4. **Static and dynamic analysis** (Ghidra) of `TWTW.EXE`, to learn *what* a format contains and *how* the engine behaves. This is allowed only for understanding, under the rules below.

## Rules

1. **Decompiler output and anything written alongside it live only in `analysis/decompiled/`**, which is gitignored. That includes the Ghidra project, function exports, segment and resource dumps, private notes, and the prototype Python parsers in `analysis/decompiled/oracles/` (they were written with the decompiler open). None of it leaves that folder. It is never pasted into the repo, and never machine-translated into TypeScript.
2. **Specification first.** Before a format or behaviour is implemented, it is written up in `docs/formats/<topic>.md` in our own words: field tables, offsets, bit layouts, algorithm descriptions in prose or short pseudocode, and worked examples taken from the data.
   - **Allowed:**
     - function addresses (e.g. `1018:6810`), as provenance pointers;
     - constants and small tables that interoperability depends on (magic values, enum numbers, field widths), recorded as facts together with how they were confirmed against the data.
   - **Not allowed:** decompiled function bodies, or copied code structure.
3. **Implement from the specification.** TypeScript code is written from `docs/formats/`, not with decompiler output side by side. It uses our own names, types and structure. If the spec turns out to be wrong or incomplete, fix the spec first, then the code.
4. **Validate against the data and the original's behaviour, not its code.** Validation means:
   - decoding the whole disc (structural invariants, cross-references that agree);
   - comparing our output with the private oracles' output on the same disc;
   - comparing rendered screens with captures from the reference environments.

   Oracle *outputs* are used for comparison. Oracle *code* is never consulted while writing TypeScript.
5. **No disc bytes in git.** `.gitignore` excludes the ISO, extracted data, decompiler output, emulator disk images, captures and private fixtures, with a safety net of disc file extensions. Unit tests use synthetic data we build ourselves. Integration tests read the local disc (`vendor/cd` or `$TWTW_CD`) and skip when it is absent.
6. **The original executable is data at runtime, never code.** The remake may parse `TWTW.EXE` from the user's disc as an NE resource container (palette, cursors, scrollbar bitmaps). That format is public. It never executes, links, emulates or redistributes it. The original program runs only inside the reference environments, as a source of ground truth.
7. **Reference environments are private.** The MS-DOS and Windows disk images and any patched copies of `TWTW.EXE` (e.g. the Wine palette fix) live under `vendor/`. The scripts that build or drive them are ours and may be committed, but they must not embed their bytes.
8. **Secrets stay out.** Public hostnames for the deployment, tokens and similar values are read from gitignored local files or the environment, never committed.

## Review checklist (every change touching a decoder or engine behaviour)
- [ ] The spec in `docs/formats/` was updated in the same change, or before it.
- [ ] No decompiler identifiers (`FUN_`, `DAT_`, `LAB_`, `uVar`, `iVar`, `param_`, …) in `packages/` or `apps/`.
- [ ] Control flow and naming are our own, not a transliteration.
- [ ] No disc-derived bytes in tests, fixtures, snapshots or docs, beyond the small interoperability facts allowed by rule 2.
