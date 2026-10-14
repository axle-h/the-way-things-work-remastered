/**
 * The data manifest, `manifest.json` at the root of the extracted disc (written by `pnpm data`).
 *
 * It lists every file on the disc with its path relative to the disc root, using `/` separators
 * and the case found on the disc, sorted by path. The HTTP data source uses it to resolve names
 * case-insensitively without probing the server.
 */
export interface Manifest {
  readonly version: 1;
  readonly files: readonly ManifestFile[];
}

export interface ManifestFile {
  /** Path relative to the disc root, e.g. `DKCODE/TWTW.PNG`. */
  readonly path: string;
  /** Size in bytes. */
  readonly size: number;
}

export const MANIFEST_NAME = 'manifest.json';

/** Validates parsed JSON as a manifest, throwing a descriptive error if it is not one. */
export function parseManifest(json: unknown): Manifest {
  if (typeof json !== 'object' || json === null) throw new Error('manifest: not an object');
  const { version, files } = json as { version?: unknown; files?: unknown };
  if (version !== 1) throw new Error(`manifest: unsupported version ${String(version)}`);
  if (!Array.isArray(files)) throw new Error('manifest: files is not an array');
  const parsed = files.map((entry: unknown, i): ManifestFile => {
    const { path, size } = (entry ?? {}) as { path?: unknown; size?: unknown };
    if (typeof path !== 'string' || path === '' || path.startsWith('/') || path.includes('\\')) {
      throw new Error(`manifest: files[${i}].path is invalid`);
    }
    if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0) {
      throw new Error(`manifest: files[${i}].size is invalid`);
    }
    return { path, size };
  });
  return { version, files: parsed };
}
