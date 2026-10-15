import type { Manifest } from '@twtw/engine';

/** Serialises a manifest deterministically, one file per line. */
export function formatManifest(manifest: Manifest): string {
  const lines = manifest.files.map((file) => `    ${JSON.stringify(file)}`);
  return `{\n  "version": ${manifest.version},\n  "files": [\n${lines.join(',\n')}\n  ]\n}\n`;
}
