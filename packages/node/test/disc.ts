/**
 * Access to the local disc and reference captures for corpus tests. Neither is ever in the
 * repository: tests read `vendor/cd` (or `$TWTW_CD`) and `vendor/ref` (or `$TWTW_REF`) and skip
 * with a clear message when they are absent, as on CI.
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '../../..');

/** Root of the extracted disc: `$TWTW_CD`, or `vendor/cd` in the repository. */
export const discRoot = resolve(process.env['TWTW_CD'] ?? join(repoRoot, 'vendor', 'cd'));

/** Reference captures (docs/reference-environments.md): `$TWTW_REF`, or `vendor/ref`. */
export const refRoot = resolve(process.env['TWTW_REF'] ?? join(repoRoot, 'vendor', 'ref'));

/** The "missing" message for {@link describeIfAvailable} when a disc file is absent. */
export function missingDiscFile(path: string): string | null {
  return existsSync(join(discRoot, ...path.split('/')))
    ? null
    : `${path} not found under ${discRoot} (extract the disc with \`pnpm data\` or set TWTW_CD)`;
}

/** `describe` that reports one skipped test with the message when something is missing. */
export function describeIfAvailable(name: string, missing: string | null, body: () => void): void {
  if (missing === null) {
    describe(name, body);
  } else {
    describe(name, () => {
      it.skip(`skipped: ${missing}`, () => {});
    });
  }
}
