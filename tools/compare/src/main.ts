// `pnpm compare [<filter>...]`: replay reference captures in the engine and diff them against the
// captures. See README.md in this directory.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { DATABASE_PATH } from '@twtw/engine';
import { DirectoryDataSource } from '@twtw/node';
import { Comparator, type CaptureResult, type MediaMode } from './compare.ts';
import { REASONS, type Reason } from './diff.ts';
import { defaultOutDir, discRoot, refRoot } from './paths.ts';
import { listReferences, matchesFilter } from './references.ts';
import { writeCapture, writeIndex, type ImageMode } from './report.ts';

const USAGE = `usage: pnpm compare [<filter>...] [options]

Replays each reference capture in ${refRoot} (or $TWTW_REF) with the engine, diffs it, and
writes an HTML report and results.json to ${defaultOutDir} (or $TWTW_COMPARE_OUT).

<filter> selects captures (any filter matches):
  1538                 a page: captures in vendor/ref/1538, or whose path starts there
  41*                  a page glob
  startup, path-*      a capture name (glob)
  1188/path-*          a glob over <page>/<name>

options:
  --out DIR            write the report here
  --images MODE        all (default), differing or none
  --media MODE         stall (default: animations that start with their page stall, as under
                       Wine) or settle (play everything out on a virtual clock; Wine's captures
                       will differ)
  --quiet              print only the summary
  --help
`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string' },
    images: { type: 'string', default: 'all' },
    media: { type: 'string', default: 'stall' },
    quiet: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
});

if (values.help) {
  process.stdout.write(USAGE);
  process.exit(0);
}
const images = values.images as ImageMode;
if (!['all', 'differing', 'none'].includes(images)) {
  process.stderr.write(`--images must be all, differing or none\n`);
  process.exit(2);
}
const mediaMode = values.media as MediaMode;
if (!['stall', 'settle'].includes(mediaMode)) {
  process.stderr.write(`--media must be stall or settle\n`);
  process.exit(2);
}
if (!existsSync(resolve(discRoot, ...DATABASE_PATH.split('/')))) {
  process.stderr.write(`no disc at ${discRoot}: extract it with \`pnpm data\` or set TWTW_CD\n`);
  process.exit(2);
}
const all = listReferences(refRoot);
if (all.length === 0) {
  process.stderr.write(
    `no reference captures under ${refRoot}: capture them with \`pnpm refcapture\` or set TWTW_REF\n`,
  );
  process.exit(2);
}
const selected =
  positionals.length === 0
    ? all
    : all.filter((ref) => positionals.some((filter) => matchesFilter(ref, filter)));
if (selected.length === 0) {
  process.stderr.write(`no capture matches ${positionals.join(' ')}\n`);
  process.exit(2);
}

const outDir = resolve(values.out ?? defaultOutDir);
const comparator = await Comparator.open(await DirectoryDataSource.open(discRoot), mediaMode);
const results: CaptureResult[] = [];
for (const reference of selected) {
  const comparison = await comparator.compare(reference);
  const result = writeCapture(outDir, reference, comparison, comparator.palette, images);
  results.push(result);
  if (!values.quiet) {
    const detail =
      result.error ??
      Object.entries(result.byReason)
        .map(([reason, pixels]) => `${reason} ${pixels}`)
        .join(', ');
    const unexplained = result.unexplained > 0 ? ` UNEXPLAINED ${result.unexplained}` : '';
    process.stdout.write(
      `${result.status.padEnd(11)} ${result.id.padEnd(40)} ${String(result.differing).padStart(7)}${unexplained}  ${detail}\n`,
    );
  }
}
const written = writeIndex(outDir, results, new Set(all.map((reference) => reference.id)), {
  refRoot,
  discRoot,
});

const count = (status: CaptureResult['status']) =>
  results.filter((result) => result.status === status).length;
process.stdout.write(
  `\n${results.length} captures: ${count('exact')} exact, ${count('explained')} explained, ` +
    `${count('unexplained')} unexplained, ${count('error')} errors\n`,
);
const byReason = new Map<Reason, number>();
for (const result of results) {
  for (const reason of Object.keys(result.byReason) as Reason[])
    byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
}
for (const [reason, captures] of byReason) {
  process.stdout.write(
    `  ${reason.padEnd(20)} ${String(captures).padStart(4)} captures  ${REASONS[reason]}\n`,
  );
}
process.stdout.write(
  `report: ${resolve(outDir, 'index.html')} (${written.captures.length} captures in results.json)\n`,
);
process.exit(count('unexplained') + count('error') > 0 ? 1 : 0);
