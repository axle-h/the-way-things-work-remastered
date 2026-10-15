// What The Way Things Work disc looks like, for the check before it is used (disc.ts) and for the
// artefact check (scripts/disc-scan.ts). A hash is not disc content: it identifies the file without
// containing any of it.

export interface DiscIdentity {
  /** The ISO 9660 volume label. A folder has none to check. */
  readonly volumeLabel: string;
  /** The page database, whose hash identifies the edition. */
  readonly databasePath: string;
  /** Its SHA-256, lower-case hex. */
  readonly databaseSha256: string;
}

/** The 1994 disc (docs/formats/iso9660.md). */
export const TWTW_DISC: DiscIdentity = {
  volumeLabel: 'DKMMTWTW',
  databasePath: 'DKCODE/TWTW.PNG',
  databaseSha256: '3327c1497c717392ab7f95ec763d17b92779a0ec61916944221a117027b147a2',
};
