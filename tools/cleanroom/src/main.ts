// `pnpm check:cleanroom`: fails if any text file under the given directories (default: packages,
// apps and our TypeScript tools) contains a decompiler-generated identifier. See scan.ts.
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { scanText } from './scan.ts';

const repoRoot = resolve(import.meta.dirname, '../../..');
const defaultRoots = ['packages', 'apps', 'tools/data', 'tools/cleanroom', 'tools/refcapture'];
const skippedDirs = new Set(['node_modules', 'dist', 'coverage', '.vite']);
const binaryExtensions = /\.(?:png|jpe?g|gif|ico|webp|woff2?|ttf|otf|wasm|zip|gz|iso)$/i;

async function* textFiles(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!skippedDirs.has(entry.name)) yield* textFiles(path);
    } else if (entry.isFile() && !binaryExtensions.test(entry.name)) {
      yield path;
    }
  }
}

const roots = process.argv.length > 2 ? process.argv.slice(2) : defaultRoots;
let files = 0;
let problems = 0;
for (const root of roots) {
  for await (const path of textFiles(resolve(repoRoot, root))) {
    const bytes = await readFile(path);
    if (bytes.subarray(0, 8192).includes(0)) continue;
    files++;
    for (const { line, column, match } of scanText(bytes.toString('utf8'))) {
      console.error(`${relative(repoRoot, path)}:${line}:${column}: decompiler identifier "${match}"`);
      problems++;
    }
  }
}

if (problems > 0) {
  console.error(`\n${problems} decompiler identifier(s) found. See docs/CLEAN_ROOM.md.`);
  process.exitCode = 1;
} else {
  console.log(`Clean-room check: ${files} files, no decompiler identifiers.`);
}
