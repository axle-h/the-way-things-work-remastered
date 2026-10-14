import { describe, expect, it } from 'vitest';
import { autoAdvanceChain, basePages, namedPage, popupOpeners, resolvePage } from './targets.ts';
import { db, ref } from './test-database.ts';

describe('resolvePage', () => {
  it('finds the named pages from the structure of the database', () => {
    expect(namedPage(db, 'title')).toBe(ref('title'));
    expect(namedPage(db, 'workshop')).toBe(ref('workshop'));
    expect(namedPage(db, 'az-machine')).toBe(ref('azmachine'));
    expect(namedPage(db, 'az-a')).toBe(ref('aza'));
    expect(namedPage(db, 'airplane')).toBe(ref('airplane'));
  });

  it('accepts heap offsets and directories', () => {
    expect(resolvePage(db, String(ref('aza')))).toBe(ref('aza'));
    expect(resolvePage(db, `0x${ref('aza').toString(16)}`)).toBe(ref('aza'));
    expect(resolvePage(db, '\\article1\\airp\\')).toBe(ref('airplane'));
    expect(resolvePage(db, 'ARTICLE1/AIRP')).toBe(ref('airplane'));
    expect(() => resolvePage(db, '\\TITLE\\')).toThrow(/2 base pages/);
    expect(() => resolvePage(db, 'nowhere')).toThrow(/unknown page/);
  });
});

describe('autoAdvanceChain', () => {
  it('follows autostart animations whose finished handler changes page', () => {
    expect(autoAdvanceChain(db, ref('title'))).toEqual([ref('still')]);
    expect(autoAdvanceChain(db, ref('still'))).toEqual([]);
  });
});

describe('basePages and popupOpeners', () => {
  it('lists the base pages and the first opener of each popup', () => {
    expect(basePages(db).map((page) => page.ref)).toEqual(
      ['title', 'still', 'workshop', 'azmachine', 'aza', 'airplane'].map(ref).sort((a, b) => a - b),
    );
    expect(popupOpeners(db.getPage(ref('airplane')))).toEqual([{ popup: ref('popup'), panel: 1, object: 1 }]);
  });
});
