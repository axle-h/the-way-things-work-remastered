/**
 * The disc content the engine needs before it can show anything: the page database, the original
 * program's resources (read as data only, docs/CLEAN_ROOM.md rule 6) and the screen palette.
 */
import {
  buildMasterPalette,
  parsePageDatabase,
  readNeResources,
  readPaletteResource,
  type NeResources,
  type PageDatabase,
} from '@twtw/formats';
import type { DataSource } from './data/data-source.ts';

/** The page database (page-database.md). */
export const DATABASE_PATH = 'DKCODE/TWTW.PNG';
/** The original program, read only as an NE resource container (program.md). */
export const PROGRAM_PATH = 'DKCODE/TWTW.EXE';

export interface DiscContent {
  readonly database: PageDatabase;
  readonly program: NeResources;
  /**
   * The master palette (dib-and-palette.md): 256 RGB triplets, 768 bytes. The engine works in
   * palette indices; presenters convert through this palette.
   */
  readonly palette: Uint8Array;
}

export async function loadDiscContent(source: DataSource): Promise<DiscContent> {
  const [databaseBytes, programBytes] = await Promise.all([
    source.read(DATABASE_PATH),
    source.read(PROGRAM_PATH),
  ]);
  const database = parsePageDatabase(databaseBytes, DATABASE_PATH);
  const program = readNeResources(programBytes, PROGRAM_PATH);
  const palette = buildMasterPalette(readPaletteResource(program).colors);
  return { database, program, palette };
}
