import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listReferences, matchesFilter, type Reference, type Sidecar } from './references.ts';

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
