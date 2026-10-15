// The database-driven crawl: every base page through the startup patch, optionally with popups.
import { performance } from 'node:perf_hooks';
import type { PageRef } from '@twtw/formats';
import { pathName } from './action-path.ts';
import { STARTUP_NAME, hasCapture, type Harness } from './capture.ts';
import { writeIndex, type CrawlRun, type Failure } from './summary.ts';
import { basePages, namedPage, popupOpeners } from './targets.ts';

export type PopupMode = 'none' | 'acceptance' | 'all';

export interface CrawlOptions {
  readonly popups: PopupMode;
  /** Only the first N base pages still to capture (for trying it out). */
  readonly limit?: number;
  /** Attempts per page before it is recorded as failed. */
  readonly attempts: number;
}

/** The acceptance popup: the first popup the Airplane article opens. */
export function acceptancePopup(harness: Harness): { base: PageRef; popup: PageRef } {
  const base = namedPage(harness.db, 'airplane');
  const opener = popupOpeners(harness.db.getPage(base))[0];
  if (opener === undefined) throw new Error('the Airplane article opens no popup');
  return { base, popup: opener.popup };
}

export async function crawl(harness: Harness, options: CrawlOptions): Promise<CrawlRun> {
  const startedAt = new Date();
  const failures = new Map<PageRef, Failure>();
  const acceptance = options.popups === 'acceptance' ? acceptancePopup(harness) : null;
  const pages = basePages(harness.db);
  let attempted = 0;
  let captured = 0;
  let skipped = 0;
  let pageTime = 0;

  for (const [n, page] of pages.entries()) {
    const popups: 'all' | PageRef[] =
      options.popups === 'all' ? 'all' : acceptance?.base === page.ref ? [acceptance.popup] : [];
    const wanted =
      popups === 'all' ? popupOpeners(page) : popupOpeners(page).filter((o) => popups.includes(o.popup));
    const popupsDone = wanted.every((opener) =>
      hasCapture(
        opener.popup,
        pathName(page.ref, [{ page: page.ref, panel: opener.panel, object: opener.object }]),
      ),
    );
    if (!harness.options.force && hasCapture(page.ref, STARTUP_NAME) && popupsDone) {
      skipped++;
      continue;
    }
    if (options.limit !== undefined && attempted >= options.limit) break;
    attempted++;
    const begin = performance.now();
    const label = `[${n + 1}/${pages.length}] page ${page.ref} ${page.directory ?? ''}`;
    let ok = false;
    for (let attempt = 1; attempt <= options.attempts && !ok; attempt++) {
      try {
        if (wanted.length > 0) {
          const { records, errors } = await harness.capturePageWithPopups(page.ref, popups);
          if (errors.length > 0) console.warn(`${label}: ${errors.join('; ')}`);
          console.log(`${label}: ${records.length} capture(s)`);
        } else {
          const record = await harness.capturePage(page.ref);
          const { settle, expectedSettledPage } = record.sidecar;
          const note = settle.timedOut ? ' (timed out)' : '';
          const elsewhere = expectedSettledPage !== page.ref ? ` → expected ${expectedSettledPage}` : '';
          console.log(`${label}: stable after ${settle.msUntilStable} ms${note}${elsewhere}`);
        }
        ok = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`${label}: attempt ${attempt} failed: ${message}`);
        failures.set(page.ref, { error: message, at: new Date().toISOString(), attempts: attempt });
      } finally {
        await harness.close();
      }
    }
    if (ok) {
      captured++;
      failures.delete(page.ref);
    }
    pageTime += performance.now() - begin;
    if (attempted % 10 === 0) writeIndex(harness.db, failures);
  }

  const finishedAt = new Date();
  const run: CrawlRun = {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    attempted,
    captured,
    skipped,
    failed: attempted - captured,
    meanPageMs: attempted === 0 ? 0 : Math.round(pageTime / attempted),
    popups: options.popups,
  };
  writeIndex(harness.db, failures, run);
  return run;
}
