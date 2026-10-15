// `pnpm refcapture <command>`: drive the original under Wine on a nested X server and capture
// reference screens into vendor/ref/. See README.md in this directory.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { parsePageDatabase, type PageDatabase } from '@twtw/formats';
import { NAV_BUTTONS, locatePanels, parseStep, type ActionPath } from './action-path.ts';
import { checkWineSetup, killWineServer, ourProgramProcesses, stopProgram } from './app.ts';
import {
  DEFAULT_OPTIONS,
  Harness,
  STARTUP_NAME,
  hasCapture,
  type CaptureOptions,
  type CaptureRecord,
} from './capture.ts';
import { acceptancePopup, crawl, type PopupMode } from './crawl.ts';
import { DEFAULT_DISPLAY, ensureVenv, startXServer, stopXServer, xServerStatus } from './env.ts';
import { databasePath } from './paths.ts';
import { writeIndex } from './summary.ts';
import { PAGE_NAMES, autoAdvanceChain, basePages, namedPage, popupOpeners, resolvePage } from './targets.ts';
import { XHelper } from './x.ts';

const USAGE = `usage: pnpm refcapture <command> [options]

  env start|stop|status     the nested Xwayland server (${DEFAULT_DISPLAY}, or $TWTW_REF_DISPLAY)
  page <page>...            start at each base page and capture it (vendor/ref/<page>/startup.png)
  path <start> <step>...    start at a base page, click each step (page:panel:object), capture each
  popups <page>...          capture a base page and every popup its objects open
  acceptance                the acceptance set (${PAGE_NAMES.join(', ')} and an Airplane popup)
  crawl                     every base page; --popups none|acceptance|all (default acceptance)
  list [<page>]             base pages, or a page's clickable objects as steps
  index                     rebuild vendor/ref/index.json from the sidecars

<page> is a heap offset, a media directory such as '\\ARTICLE1\\AIRP\\', or one of: ${PAGE_NAMES.join(', ')}.

options:
  --force                   capture again even if the files exist
  --stable-ms N             frames must stay identical this long (default ${DEFAULT_OPTIONS.stableMs})
  --advance-stable-ms N     the same for pages that move on by themselves (default ${DEFAULT_OPTIONS.advanceStableMs})
  --timeout-ms N            settle timeout (default ${DEFAULT_OPTIONS.timeoutMs})
  --launch-timeout-ms N     wait this long for the main window (default ${DEFAULT_OPTIONS.launchTimeoutMs})
  --no-resize               keep Wine's own client size instead of resizing to 638×459
  --name NAME               file name (without .png) for the last capture of 'path'
  --popups MODE             crawl: none, acceptance or all
  --limit N                 crawl: stop after N pages
  --keep-env                leave the X server running when this command started it
`;

function loadDatabase(): { db: PageDatabase; bytes: Uint8Array } {
  const bytes = new Uint8Array(readFileSync(databasePath));
  return { db: parsePageDatabase(bytes), bytes };
}

async function withHarness<T>(
  values: Record<string, string | boolean | undefined>,
  run: (harness: Harness) => Promise<T>,
): Promise<T> {
  checkWineSetup();
  const display = process.env['TWTW_REF_DISPLAY'] ?? DEFAULT_DISPLAY;
  const started = await startXServer(display);
  if (started) console.log(`Started Xwayland on ${display}`);
  const { db, bytes } = loadDatabase();
  const number = (key: string, fallback: number) =>
    values[key] === undefined ? fallback : Number(values[key]);
  const options: CaptureOptions = {
    display,
    stableMs: number('stable-ms', DEFAULT_OPTIONS.stableMs),
    advanceStableMs: number('advance-stable-ms', DEFAULT_OPTIONS.advanceStableMs),
    timeoutMs: number('timeout-ms', DEFAULT_OPTIONS.timeoutMs),
    launchTimeoutMs: number('launch-timeout-ms', DEFAULT_OPTIONS.launchTimeoutMs),
    resize: values['no-resize'] !== true,
    force: values['force'] === true,
    fps: DEFAULT_OPTIONS.fps,
  };
  const x = new XHelper(display);
  const harness = new Harness(db, bytes, x, options);
  const interrupt = () => {
    console.warn('Interrupted; closing the program');
    void harness.close().finally(() => process.exit(130));
  };
  process.once('SIGINT', interrupt);
  try {
    return await run(harness);
  } finally {
    process.off('SIGINT', interrupt);
    await harness.close();
    x.dispose();
    if (started && values['keep-env'] !== true) {
      killWineServer(display);
      await stopXServer();
      console.log(`Stopped Xwayland on ${display}`);
    }
  }
}

function report(record: CaptureRecord): void {
  const { sidecar } = record;
  const settle = sidecar.settle.timedOut ? 'timed out' : `stable after ${sidecar.settle.msUntilStable} ms`;
  const elsewhere = sidecar.settledDiffersFromRequested
    ? `; moves on by itself, expected to settle on page ${sidecar.expectedSettledPage}`
    : '';
  const others = sidecar.otherWindows.length > 0 ? `; ${sidecar.otherWindows.length} other window(s)` : '';
  console.log(`${record.png} (${sidecar.width}×${sidecar.height}, ${settle}${elsewhere}${others})`);
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      force: { type: 'boolean' },
      'stable-ms': { type: 'string' },
      'advance-stable-ms': { type: 'string' },
      'timeout-ms': { type: 'string' },
      'launch-timeout-ms': { type: 'string' },
      'no-resize': { type: 'boolean' },
      name: { type: 'string' },
      popups: { type: 'string' },
      limit: { type: 'string' },
      'keep-env': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const [command, ...args] = positionals;
  if (values.help === true || command === undefined) {
    console.log(USAGE);
    return;
  }
  const display = process.env['TWTW_REF_DISPLAY'] ?? DEFAULT_DISPLAY;

  switch (command) {
    case 'env': {
      const action = args[0] ?? 'status';
      if (action === 'start') {
        ensureVenv();
        const started = await startXServer(display);
        console.log(
          started ? `Started Xwayland on ${display}` : `An X server is already running on ${display}`,
        );
      } else if (action === 'stop') {
        const program = await stopProgram(null, display);
        if (program !== 'none') console.log('Stopped the program');
        killWineServer(display);
        console.log(
          (await stopXServer()) ? `Stopped Xwayland on ${display}` : 'No Xwayland of ours was running',
        );
      } else {
        const status = xServerStatus(display);
        console.log(
          `X server on ${display}: ${status.running ? 'running' : 'not running'}${status.pid !== null ? ` (Xwayland PID ${status.pid}, ours)` : ''}`,
        );
        console.log(`Program: ${ourProgramProcesses().length > 0 ? 'running' : 'not running'}`);
      }
      return;
    }
    case 'list': {
      const { db } = loadDatabase();
      if (args.length === 0) {
        for (const page of basePages(db)) {
          const chain = autoAdvanceChain(db, page.ref);
          console.log(
            `${page.ref}\t${page.directory ?? ''}${chain.length > 0 ? `\tmoves on to ${chain.join(' → ')}` : ''}`,
          );
        }
        return;
      }
      const page = db.getPage(resolvePage(db, args[0]!));
      console.log(`page ${page.ref} (${page.pageType}) ${page.directory ?? ''}`);
      for (const { panel } of locatePanels(db, page)) {
        panel.objects.forEach((object, index) => {
          if (panel.kind === 'navPanel' && object.kind === 'navHotspot') {
            const button = NAV_BUTTONS[panel.buttonIds.indexOf(object.id)] ?? '?';
            console.log(
              `  ${page.ref}:${panel.id}:${index}\tnav button ${button} ${JSON.stringify(object.rect)}`,
            );
            return;
          }
          if (!('handlers' in object) || object.handlers.length === 0) return;
          const actions = object.handlers.flatMap((h) =>
            h.actions.map((a) => ('page' in a ? `${a.kind} ${a.page}` : a.kind)),
          );
          console.log(
            `  ${page.ref}:${panel.id}:${index}\t${object.kind} ${JSON.stringify(object.rect)}\t${actions.join(', ')}`,
          );
        });
      }
      return;
    }
    case 'index': {
      const { db } = loadDatabase();
      const index = writeIndex(db, new Map());
      console.log(JSON.stringify(index.counts, null, 2));
      return;
    }
    case 'page': {
      if (args.length === 0) throw new Error('page: give at least one page');
      await withHarness(values, async (harness) => {
        for (const spec of args) {
          const ref = resolvePage(harness.db, spec);
          if (!harness.options.force && hasCapture(ref, STARTUP_NAME)) {
            console.log(`page ${ref}: already captured (use --force)`);
            continue;
          }
          report(await harness.capturePage(ref));
        }
        writeIndex(harness.db, new Map());
      });
      return;
    }
    case 'path': {
      const [start, ...steps] = args;
      if (start === undefined || steps.length === 0)
        throw new Error('path: give a start page and at least one step');
      await withHarness(values, async (harness) => {
        const path: ActionPath = { start: resolvePage(harness.db, start), steps: steps.map(parseStep) };
        for (const record of await harness.capturePath(path, values.name)) report(record);
        writeIndex(harness.db, new Map());
      });
      return;
    }
    case 'popups': {
      if (args.length === 0) throw new Error('popups: give at least one base page');
      await withHarness(values, async (harness) => {
        for (const spec of args) {
          const ref = resolvePage(harness.db, spec);
          console.log(`page ${ref}: ${popupOpeners(harness.db.getPage(ref)).length} popup(s)`);
          const { records, errors } = await harness.capturePageWithPopups(ref, 'all');
          records.forEach(report);
          errors.forEach((error) => console.warn(error));
        }
        writeIndex(harness.db, new Map());
      });
      return;
    }
    case 'acceptance': {
      await withHarness(values, async (harness) => {
        for (const name of PAGE_NAMES) {
          const ref = namedPage(harness.db, name);
          if (!harness.options.force && hasCapture(ref, STARTUP_NAME)) {
            console.log(`${name} (page ${ref}): already captured`);
            continue;
          }
          console.log(`${name} (page ${ref}):`);
          report(await harness.capturePage(ref));
        }
        const { base, popup } = acceptancePopup(harness);
        console.log(`Airplane popup (page ${popup}):`);
        const { records } = await harness.capturePageWithPopups(base, [popup]);
        records.forEach(report);
        writeIndex(harness.db, new Map());
      });
      return;
    }
    case 'crawl': {
      const popups = (values.popups ?? 'acceptance') as PopupMode;
      if (!['none', 'acceptance', 'all'].includes(popups))
        throw new Error('--popups is none, acceptance or all');
      await withHarness(values, async (harness) => {
        const run = await crawl(harness, {
          popups,
          attempts: 2,
          ...(values.limit !== undefined ? { limit: Number(values.limit) } : {}),
        });
        console.log(JSON.stringify(run, null, 2));
      });
      return;
    }
    default:
      throw new Error(`unknown command ${command}\n\n${USAGE}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
