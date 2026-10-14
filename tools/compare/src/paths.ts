// Where the comparison reads and writes. Everything lives under the gitignored vendor/.
import { join, resolve } from 'node:path';

export const repoRoot = resolve(import.meta.dirname, '../../..');

/** The extracted disc: `$TWTW_CD`, or `vendor/cd`. */
export const discRoot = resolve(process.env['TWTW_CD'] ?? join(repoRoot, 'vendor', 'cd'));

/** Reference captures written by `pnpm refcapture`: `$TWTW_REF`, or `vendor/ref`. */
export const refRoot = resolve(process.env['TWTW_REF'] ?? join(repoRoot, 'vendor', 'ref'));

/** The report: `$TWTW_COMPARE_OUT`, or `vendor/compare`. */
export const defaultOutDir = resolve(process.env['TWTW_COMPARE_OUT'] ?? join(repoRoot, 'vendor', 'compare'));
