/**
 * Access to the local disc for corpus tests. The disc is never in the repository: tests read
 * `vendor/cd` (or `$TWTW_CD`) and skip with a clear message when it is absent, as on CI.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

/** Root of the extracted disc: `$TWTW_CD`, or `vendor/cd` in the repository. */
export const discRoot: string = process.env.TWTW_CD ?? join(repoRoot, 'vendor', 'cd');

/** A path relative to the repository root. */
export function repoPath(...parts: string[]): string {
  return join(repoRoot, ...parts);
}

/** Absolute path of a file on the disc (disc-relative path with `/`), or `undefined` if absent. */
export function discFile(path: string): string | undefined {
  const file = join(discRoot, ...path.split('/'));
  return existsSync(file) ? file : undefined;
}

/**
 * Every file on the disc, as lower-case disc-relative paths with `/` separators, from
 * `manifest.json` when present, otherwise by walking the directory.
 */
export function discFileSet(): Set<string> {
  const manifest = discFile('manifest.json');
  if (manifest !== undefined) {
    const { files } = JSON.parse(readFileSync(manifest, 'utf8')) as { files: { path: string }[] };
    return new Set(files.map((file) => file.path.toLowerCase()));
  }
  const paths = new Set<string>();
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else paths.add(relative(discRoot, full).split(sep).join('/').toLowerCase());
    }
  };
  walk(discRoot);
  return paths;
}

/**
 * `describe` that runs only when nothing is missing. Pass `null` when every requirement is met,
 * or a message saying what is missing; the suite then reports a single skipped test with that
 * message instead of failing.
 */
export function describeIfAvailable(name: string, missing: string | null, body: () => void): void {
  if (missing === null) {
    describe(name, body);
  } else {
    describe(name, () => {
      it.skip(`skipped: ${missing}`, () => {});
    });
  }
}

/** The "missing" message for {@link describeIfAvailable} when a disc file is absent. */
export function missingDiscFile(path: string): string | null {
  return discFile(path) === undefined
    ? `${path} not found under ${discRoot} (extract the disc with \`pnpm data\` or set TWTW_CD)`
    : null;
}
