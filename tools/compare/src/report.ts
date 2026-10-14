/**
 * The comparison report under vendor/compare (gitignored): results.json, an index page with a
 * filterable, sortable table, and one page per capture with the reference, our rendering and the
 * diff side by side. Dependency-free HTML; images are PNG files next to the pages.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Rect } from '@twtw/formats';
import { encodeIndexedPng, encodeRgbPng } from '@twtw/node';
import { totals, type CaptureComparison, type CaptureResult, type Totals } from './compare.ts';
import { REASONS, type Reason } from './diff.ts';
import type { Reference } from './references.ts';

export interface Results {
  readonly version: 1;
  readonly generatedAt: string;
  readonly presentation: 'wine';
  readonly refRoot: string;
  readonly discRoot: string;
  readonly reasons: typeof REASONS;
  readonly totals: Totals;
  readonly captures: readonly CaptureResult[];
}

/** Which captures get image files: all, only those that differ, or none. */
export type ImageMode = 'all' | 'differing' | 'none';

/** Writes one capture's images and page; returns the result. */
export function writeCapture(
  outDir: string,
  reference: Reference,
  comparison: CaptureComparison,
  palette: Uint8Array,
  mode: ImageMode,
): CaptureResult {
  const { result, images } = comparison;
  const base = join(outDir, 'captures', result.id);
  mkdirSync(dirname(base), { recursive: true });
  const write =
    images !== undefined && (mode === 'all' || (mode === 'differing' && result.status !== 'exact'));
  if (write) {
    copyFileSync(reference.png, `${base}.ref.png`);
    writeFileSync(`${base}.ours.png`, encodeIndexedPng(images.ours, palette));
    writeFileSync(`${base}.diff.png`, encodeRgbPng(images.diff));
  }
  writeFileSync(`${base}.html`, capturePage(result, write));
  return result;
}

/**
 * Merges new results into results.json (results of captures not compared this time are kept while
 * their reference exists) and rewrites the index page. Returns everything written.
 */
export function writeIndex(
  outDir: string,
  results: readonly CaptureResult[],
  existing: ReadonlySet<string>,
  roots: { refRoot: string; discRoot: string },
): Results {
  const path = join(outDir, 'results.json');
  const fresh = new Set(results.map((result) => result.id));
  let kept: CaptureResult[] = [];
  if (existsSync(path)) {
    try {
      const previous = JSON.parse(readFileSync(path, 'utf8')) as Results;
      if (previous.version === 1) {
        kept = previous.captures.filter((result) => !fresh.has(result.id) && existing.has(result.id));
      }
    } catch {
      // unreadable: start again
    }
  }
  const captures = [...kept, ...results].sort((a, b) => a.page - b.page || a.name.localeCompare(b.name));
  const all: Results = {
    version: 1,
    generatedAt: new Date().toISOString(),
    presentation: 'wine',
    ...roots,
    reasons: REASONS,
    totals: totals(captures),
    captures,
  };
  mkdirSync(outDir, { recursive: true });
  writeAtomically(path, JSON.stringify(all, null, 2) + '\n');
  writeAtomically(join(outDir, 'index.html'), indexPage(all));
  return all;
}

function writeAtomically(path: string, text: string): void {
  writeFileSync(`${path}.tmp`, text);
  renameSync(`${path}.tmp`, path);
}

// ---------------------------------------------------------------------------------------------
// HTML

const STYLE = `
:root { color-scheme: light dark; --bg: #fff; --fg: #1d1d1f; --muted: #6b6b70; --line: #d9d9de;
  --exact: #1f7a3a; --explained: #a86400; --unexplained: #c0002a; --error: #7a1fa8; --row: #f6f6f8; }
@media (prefers-color-scheme: dark) { :root { --bg: #18181b; --fg: #ececf0; --muted: #a0a0a8;
  --line: #3a3a40; --exact: #5fd07f; --explained: #f0a840; --unexplained: #ff5a78; --error: #c58af0; --row: #222227; } }
body { margin: 0; padding: 16px; background: var(--bg); color: var(--fg); font: 14px/1.4 system-ui, sans-serif; }
h1 { font-size: 20px; margin: 0 0 8px; } h2 { font-size: 16px; margin: 20px 0 8px; }
a { color: inherit; } .muted { color: var(--muted); }
table { border-collapse: collapse; width: 100%; }
th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { cursor: pointer; user-select: none; position: sticky; top: 0; background: var(--bg); }
th[data-dir="asc"]::after { content: " ▲"; } th[data-dir="desc"]::after { content: " ▼"; }
tbody tr:hover { background: var(--row); }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
.status { font-weight: 600; } .s-exact { color: var(--exact); } .s-explained { color: var(--explained); }
.s-unexplained { color: var(--unexplained); } .s-error { color: var(--error); }
.controls { display: flex; gap: 8px; flex-wrap: wrap; margin: 12px 0; }
input, select { font: inherit; padding: 4px 6px; }
.summary { display: flex; gap: 24px; flex-wrap: wrap; }
.summary div b { display: block; font-size: 22px; }
.images { display: flex; gap: 12px; flex-wrap: wrap; }
.images figure { margin: 0; } .images img { image-rendering: pixelated; display: block; border: 1px solid var(--line); max-width: 100%; }
figcaption { color: var(--muted); margin-top: 4px; }
code { font-size: 13px; }
`;

function escape(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function rect(r: Rect): string {
  return `(${r.left},${r.top})–(${r.right},${r.bottom}) ${r.right - r.left}×${r.bottom - r.top}`;
}

function reasonList(byReason: Partial<Record<Reason, number>>): string {
  return Object.entries(byReason)
    .map(([reason, pixels]) => `${reason}: ${pixels}`)
    .join(', ');
}

function htmlDocument(title: string, body: string, script = ''): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<style>${STYLE}</style>
</head>
<body>
${body}
${script === '' ? '' : `<script>${script}</script>`}
</body>
</html>
`;
}

function indexPage(results: Results): string {
  const { totals: t } = results;
  const reasons = (Object.keys(REASONS) as Reason[])
    .filter((reason) => t.byReason[reason] !== undefined)
    .map(
      (reason) =>
        `<tr><td><code>${reason}</code></td><td class="num">${t.byReason[reason]!.captures}</td>` +
        `<td class="num">${t.byReason[reason]!.pixels}</td><td>${escape(REASONS[reason])}</td></tr>`,
    )
    .join('\n');
  const rows = results.captures
    .map((r) => {
      const href = `captures/${r.id}.html`;
      return (
        `<tr data-status="${r.status}">` +
        `<td><a href="${escape(href)}">${escape(r.id)}</a></td>` +
        `<td>${escape(r.directory ?? '')}</td>` +
        `<td>${escape(r.steps.join(' '))}</td>` +
        `<td class="status s-${r.status}">${r.status}</td>` +
        `<td class="num">${r.differing}</td>` +
        `<td class="num">${r.differingPercent.toFixed(3)}</td>` +
        `<td class="num">${r.unexplained}</td>` +
        `<td>${escape(r.error ?? reasonList(r.byReason))}</td>` +
        `<td>${escape(r.unexplainedBoxes.slice(0, 3).map(rect).join('; '))}</td>` +
        `</tr>`
      );
    })
    .join('\n');
  const body = `
<h1>Engine vs. Wine references</h1>
<p class="muted">${escape(results.generatedAt)} · presentation <code>wine</code> · references <code>${escape(results.refRoot)}</code></p>
<div class="summary">
  <div><b>${t.captures}</b>captures</div>
  <div class="s-exact"><b>${t.exact}</b>exact</div>
  <div class="s-explained"><b>${t.explained}</b>explained</div>
  <div class="s-unexplained"><b>${t.unexplained}</b>unexplained</div>
  <div class="s-error"><b>${t.error}</b>errors</div>
</div>
<h2>Expected differences</h2>
<table><thead><tr><th>Reason</th><th class="num">Captures</th><th class="num">Pixels</th><th>Why</th></tr></thead>
<tbody>${reasons}</tbody></table>
<h2>Captures</h2>
<div class="controls">
  <input id="filter" type="search" placeholder="Filter (id, directory, steps, reason)" size="40">
  <select id="status"><option value="">all statuses</option><option>exact</option><option>explained</option>
  <option>unexplained</option><option>error</option></select>
  <span id="count" class="muted"></span>
</div>
<table id="captures"><thead><tr>
<th>Capture</th><th>Directory</th><th>Steps</th><th>Status</th><th class="num" data-type="num">Differing</th>
<th class="num" data-type="num">%</th><th class="num" data-type="num">Unexplained</th><th>Reasons</th><th>Unexplained areas</th>
</tr></thead>
<tbody>
${rows}
</tbody></table>`;
  const script = `
const table = document.getElementById('captures');
const rows = [...table.tBodies[0].rows];
const filter = document.getElementById('filter');
const status = document.getElementById('status');
const count = document.getElementById('count');
function apply() {
  const text = filter.value.toLowerCase();
  let shown = 0;
  for (const row of rows) {
    const visible = (!status.value || row.dataset.status === status.value) &&
      (!text || row.textContent.toLowerCase().includes(text));
    row.hidden = !visible;
    if (visible) shown++;
  }
  count.textContent = shown + ' of ' + rows.length;
}
filter.addEventListener('input', apply);
status.addEventListener('change', apply);
for (const [index, th] of [...table.tHead.rows[0].cells].entries()) {
  th.addEventListener('click', () => {
    const dir = th.dataset.dir === 'asc' ? 'desc' : 'asc';
    for (const other of table.tHead.rows[0].cells) delete other.dataset.dir;
    th.dataset.dir = dir;
    const numeric = th.dataset.type === 'num';
    const key = (row) => numeric ? Number(row.cells[index].textContent) : row.cells[index].textContent;
    rows.sort((a, b) => {
      const x = key(a), y = key(b);
      const order = numeric ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
      return dir === 'asc' ? order : -order;
    });
    table.tBodies[0].append(...rows);
  });
}
apply();
`;
  return htmlDocument('Engine vs. Wine references', body, script);
}

function capturePage(r: CaptureResult, images: boolean): string {
  const name = r.name;
  const reasons = (Object.entries(r.byReason) as [Reason, number][])
    .map(([reason, pixels]) => `<li><code>${reason}</code>: ${pixels} px, ${escape(REASONS[reason])}</li>`)
    .join('\n');
  const masks = r.masks
    .map((mask) => `<li><code>${mask.reason}</code> ${rect(mask.rect)}: ${escape(mask.detail)}</li>`)
    .join('\n');
  const boxes = (list: readonly Rect[]) =>
    list.length === 0
      ? '<p class="muted">none</p>'
      : `<ul>${list.map((b) => `<li>${rect(b)}</li>`).join('')}</ul>`;
  const figure = (file: string, caption: string, size = r.referenceSize, id = '') =>
    `<figure><img ${id} src="${escape(file)}" width="${size.width}" height="${size.height}" alt="${escape(caption)}"><figcaption>${escape(caption)}</figcaption></figure>`;
  const imageBlock = images
    ? `<div class="images">
${figure(`${name}.ref.png`, 'reference (Wine)')}
${figure(`${name}.ours.png`, 'ours (engine, wine presentation)')}
${figure(`${name}.diff.png`, `diff of the compared ${r.area.width}×${r.area.height}: red unexplained, orange explained, blue tint masked`, r.area)}
</div>
<h2>Blink</h2>
<p class="muted">Click the picture to switch between the reference and ours.</p>
${figure(`${name}.ref.png`, 'reference', r.referenceSize, 'id="blink"')}`
    : '<p class="muted">No images written for this capture.</p>';
  const body = `
<p><a href="../../index.html">← all captures</a></p>
<h1>${escape(r.id)} <span class="status s-${r.status}">${r.status}</span></h1>
<p>${escape(r.directory ?? '')} · ${r.kind} from ${r.start}${r.steps.length > 0 ? ` · steps ${escape(r.steps.join(' '))}` : ''}</p>
<p>Rendered: <code>${escape(JSON.stringify(r.rendered))}</code>${r.autoAdvance === 'none' ? '' : ` · auto-advance: ${r.autoAdvance}`}</p>
<p>Compared ${r.area.width}×${r.area.height} (reference ${r.referenceSize.width}×${r.referenceSize.height}):
${r.differing} differing pixels (${r.differingPercent.toFixed(3)} %), ${r.unexplained} unexplained.</p>
${r.error === undefined ? '' : `<p class="s-error">Error: ${escape(r.error)}</p>`}
${r.notes.length === 0 ? '' : `<ul>${r.notes.map((note) => `<li>${escape(note)}</li>`).join('')}</ul>`}
${imageBlock}
<h2>Explained differences</h2>
${reasons === '' ? '<p class="muted">none</p>' : `<ul>${reasons}</ul>`}
<h2>Unexplained areas</h2>
${boxes(r.unexplainedBoxes)}
<h2>Differing areas</h2>
${boxes(r.differingBoxes)}
<h2>Masks</h2>
${masks === '' ? '<p class="muted">none</p>' : `<ul>${masks}</ul>`}`;
  const script = images
    ? `
const blink = document.getElementById('blink');
const caption = blink.nextElementSibling;
blink.addEventListener('click', () => {
  const ours = blink.src.endsWith('.ref.png');
  blink.src = ${JSON.stringify(name)} + (ours ? '.ours.png' : '.ref.png');
  caption.textContent = ours ? 'ours' : 'reference';
});`
    : '';
  return htmlDocument(`${r.id}: ${r.status}`, body, script);
}
