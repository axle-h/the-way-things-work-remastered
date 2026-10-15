import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  listReferences,
  matchesFilter,
  whitePopupRects,
  type Reference,
  type Sidecar,
} from './references.ts';

function reference(page: number, name: string, start = page): Reference {
  const sidecar = { image: `${name}.png`, actionPath: { start, steps: [] } } as unknown as Sidecar;
  return { id: `${page}/${name}`, page, name, png: '', sidecar };
}

describe('matchesFilter', () => {
  const startup = reference(1538, 'startup');
  const path = reference(1188, 'path-1538_1538-1-13', 1538);

  it('matches a page number by directory or start page', () => {
    expect(matchesFilter(startup, '1538')).toBe(true);
    expect(matchesFilter(path, '1538')).toBe(true);
    expect(matchesFilter(path, '1188')).toBe(true);
    expect(matchesFilter(startup, '1188')).toBe(false);
  });

  it('matches names, page globs and id globs', () => {
    expect(matchesFilter(startup, 'startup')).toBe(true);
    expect(matchesFilter(path, 'path-*')).toBe(true);
    expect(matchesFilter(startup, 'path-*')).toBe(false);
    expect(matchesFilter(path, '11*')).toBe(true);
    expect(matchesFilter(startup, '11*')).toBe(false);
    expect(matchesFilter(path, '1188/path-1538_*')).toBe(true);
    expect(matchesFilter(path, '*/startup')).toBe(false);
    expect(matchesFilter(startup, '153?/startup')).toBe(true);
  });
});

describe('whitePopupRects', () => {
  const sidecar = (fields: Partial<Sidecar>): Sidecar => fields as Sidecar;
  const clientRect = { x: 195, y: 195, width: 638, height: 459 };
  const otherWindows = [
    { id: 7, x: 451, y: 250, width: 359, height: 388 },
    { id: 9, x: 300, y: 300, width: 185, height: 131 },
  ];

  it('maps the listed X window ids, not popup positions, to client rectangles', () => {
    expect(whitePopupRects(sidecar({ clientRect, otherWindows, whitePopups: [9] }))).toEqual([
      { left: 105, top: 105, right: 290, bottom: 236 },
    ]);
    expect(whitePopupRects(sidecar({ clientRect, otherWindows, whitePopups: [7, 9] }))).toHaveLength(2);
  });

  it('ignores ids of no window, and captures without the fields', () => {
    expect(whitePopupRects(sidecar({ clientRect, otherWindows, whitePopups: [0, 1] }))).toEqual([]);
    expect(whitePopupRects(sidecar({ clientRect, otherWindows }))).toEqual([]);
    expect(whitePopupRects(sidecar({ otherWindows, whitePopups: [7] }))).toEqual([]);
  });
});

describe('listReferences', () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'twtw-refs-'));
    const write = (page: string, name: string, sidecar: string | null, png = true) => {
      mkdirSync(join(root, page), { recursive: true });
      if (sidecar !== null) writeFileSync(join(root, page, `${name}.json`), sidecar);
      if (png) writeFileSync(join(root, page, `${name}.png`), '');
    };
    const sidecar = (name: string) =>
      JSON.stringify({ image: `${name}.png`, actionPath: { start: 1, steps: [] } });
    write('20', 'startup', sidecar('startup'));
    write('3', 'startup', sidecar('startup'));
    write('3', 'path-1_1-1-1', sidecar('path-1_1-1-1'));
    write('3', 'broken', '{');
    write('3', 'nopng', sidecar('nopng'), false);
    write('notapage', 'startup', sidecar('startup'));
    writeFileSync(join(root, 'index.json'), '{}');
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('lists captures with a sidecar and a picture, by page then name', () => {
    expect(listReferences(root).map((r) => r.id)).toEqual(['3/path-1_1-1-1', '3/startup', '20/startup']);
  });

  it('is empty without a reference directory', () => {
    expect(listReferences(join(root, 'missing'))).toEqual([]);
  });
});
