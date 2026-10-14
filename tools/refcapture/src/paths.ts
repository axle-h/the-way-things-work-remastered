import { join, resolve } from 'node:path';

export const repoRoot = resolve(import.meta.dirname, '../../..');
export const vendorDir = join(repoRoot, 'vendor');

/** The extracted disc: `$TWTW_CD`, or `vendor/cd`. */
export const cdDir = resolve(process.env['TWTW_CD'] ?? join(vendorDir, 'cd'));
export const databasePath = join(cdDir, 'DKCODE', 'TWTW.PNG');

/** Where references are written: `$TWTW_REF`, or `vendor/ref`. */
export const refDir = resolve(process.env['TWTW_REF'] ?? join(vendorDir, 'ref'));

/** PID files and logs of the processes the harness starts. */
export const runDir = join(vendorDir, 'refcapture');

/** The launch copy of the program: a short path under vendor/ (winevdm rejects some long ones). */
export const launchDir = join(vendorDir, 'rc', 'run');

/** Wine set-up made by wine/run.sh: the prefix and the palette-patched program. */
export const winePrefix = resolve(process.env['WINEPREFIX'] ?? join(vendorDir, 'wineprefix'));
export const patchedExe = join(vendorDir, 'patched', 'TWTW.EXE');

/** The harness's own Python environment with python-xlib. */
export const venvDir = join(vendorDir, 'venv');
export const venvPython = join(venvDir, 'bin', 'python3');
export const xHelperScript = join(repoRoot, 'tools', 'refcapture', 'xhelper.py');
