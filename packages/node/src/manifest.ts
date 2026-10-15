import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { MANIFEST_NAME, type Manifest, type ManifestFile } from '@twtw/engine';

/**
 * Lists every regular file under root as a manifest, sorted by path. Hidden entries (names starting
 * with `.`, such as the Wine drive label) and the root `manifest.json` are left out.
 */
export async function buildManifest(root: string): Promise<Manifest> {
  const files: ManifestFile[] = [];
  async function walk(dir: string, prefix: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const path = prefix + entry.name;
      if (entry.isDirectory()) {
        await walk(join(dir, entry.name), `${path}/`);
      } else if (entry.isFile() && path !== MANIFEST_NAME) {
        files.push({ path, size: (await stat(join(dir, entry.name))).size });
      }
    }
  }
  await walk(root, '');
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { version: 1, files };
}
