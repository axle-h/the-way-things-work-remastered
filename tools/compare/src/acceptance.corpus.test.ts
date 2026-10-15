/**
 * Corpus test: the Phase 2 acceptance set of Wine reference captures matches the engine's
 * rendering, with every difference explained. Reads the disc (`vendor/cd` or `$TWTW_CD`) and the
 * captures (`vendor/ref` or `$TWTW_REF`), and skips when either is absent, as on CI.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DATABASE_PATH } from '@twtw/engine';
import { DirectoryDataSource } from '@twtw/node';
import { beforeAll, describe, expect, it } from 'vitest';
import { Comparator } from './compare.ts';
import { discRoot, refRoot } from './paths.ts';
import { listReferences, type Reference } from './references.ts';

/** Title still page, Workshop, A–Z machine, A–Z "A" list, Airplane. */
const ACCEPTANCE_PAGES = [410886, 438408, 57508, 8124, 1538];
const AIRPLANE = 1538;
/** The shared navigation bar's panel id: nav-button paths are not part of the acceptance set. */
const NAV_PANEL = 849;

const missing = !existsSync(join(discRoot, ...DATABASE_PATH.split('/')))
  ? `${DATABASE_PATH} not found under ${discRoot} (extract the disc with \`pnpm data\` or set TWTW_CD)`
  : !existsSync(refRoot)
    ? `no reference captures at ${refRoot} (capture them with \`pnpm refcapture acceptance\` or set TWTW_REF)`
    : null;

if (missing !== null) {
  describe('the acceptance set against Wine references (disc)', () => {
    it.skip(`skipped: ${missing}`, () => {});
  });
} else {
  describe('the acceptance set against Wine references (disc)', () => {
    let comparator: Comparator;
    let references: Reference[];

    beforeAll(async () => {
      comparator = await Comparator.open(await DirectoryDataSource.open(discRoot));
      references = listReferences(refRoot);
    });

    function find(predicate: (reference: Reference) => boolean, what: string): Reference[] {
      const found = references.filter(predicate);
      expect(found, `no capture of ${what} under ${refRoot}`).not.toHaveLength(0);
      return found;
    }

    it.each(ACCEPTANCE_PAGES)('page %i matches, every difference explained', async (page) => {
      for (const reference of find((r) => r.page === page && r.name === 'startup', `page ${page}`)) {
        const { result } = await comparator.compare(reference);
        expect(result.error, reference.id).toBeUndefined();
        expect(result.unexplained, `${reference.id}: ${JSON.stringify(result.unexplainedBoxes)}`).toBe(0);
      }
    });

    it('the Airplane popup paths match, every difference explained', async () => {
      // Popups whose picture Wine lost (white) are a Wine artifact (reference-environments.md).
      const paths = find(
        (r) =>
          r.sidecar.kind === 'path' &&
          r.sidecar.actionPath.start === AIRPLANE &&
          r.sidecar.actionPath.steps.every((step) => step.panel !== NAV_PANEL) &&
          (r.sidecar.whitePopups ?? []).length === 0,
        'a path from the Airplane article',
      );
      expect(paths.some((r) => r.sidecar.pageType === 'popup')).toBe(true);
      for (const reference of paths) {
        const { result } = await comparator.compare(reference);
        expect(result.error, reference.id).toBeUndefined();
        expect(result.unexplained, `${reference.id}: ${JSON.stringify(result.unexplainedBoxes)}`).toBe(0);
      }
    });
  });
}
