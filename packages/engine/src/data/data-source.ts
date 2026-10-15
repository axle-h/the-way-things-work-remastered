/**
 * Where the engine's bytes come from (docs/architecture.md, "Data access"). The engine never knows
 * whether files come over HTTP, from an ISO image or from a local directory.
 *
 * Paths are relative to the disc root, use `/` separators and are matched ignoring case: the page
 * database stores mixed-case names (`AIRC0j`), while the disc's files are upper case.
 */
export interface DataSource {
  /** The file's bytes. Rejects with {@link DataNotFoundError} if there is no such file. */
  read(path: string): Promise<Uint8Array>;
  /** Whether the file exists. */
  exists(path: string): Promise<boolean>;
}

/** The error a {@link DataSource} rejects with when a file does not exist. */
export class DataNotFoundError extends Error {
  readonly path: string;

  constructor(path: string) {
    super(`no such file on the disc: ${path}`);
    this.name = 'DataNotFoundError';
    this.path = path;
  }
}

/**
 * Normalises a disc path: `\` becomes `/`, and leading, trailing and repeated separators are
 * dropped (`\ARTICLE1\AIRP\` and `ARTICLE1/AIRP` are the same). Case is kept. Throws for `.` and
 * `..` segments and for an empty path, so a path can never leave the disc root.
 */
export function normalizeDataPath(path: string): string {
  const segments = path.split(/[\\/]+/).filter((segment) => segment !== '');
  if (segments.length === 0) throw new RangeError(`empty disc path: ${JSON.stringify(path)}`);
  for (const segment of segments) {
    if (segment === '.' || segment === '..' || segment.includes('\0')) {
      throw new RangeError(`invalid disc path: ${JSON.stringify(path)}`);
    }
  }
  return segments.join('/');
}
