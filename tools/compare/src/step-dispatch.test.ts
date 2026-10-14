import { Engine } from '@twtw/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyEffect,
  engineState,
  nextState,
  showState,
  stepEffect,
  type ScreenState,
} from './step-dispatch.ts';
import { disc, ref } from './test-disc.ts';

const engine = await Engine.load(disc.source, { presentation: 'wine', startPage: null });
const db = engine.content.database;
const onArticle: ScreenState = { base: ref('article'), popups: [] };
const withPopup: ScreenState = { base: ref('article'), popups: [ref('popup')] };

describe('stepEffect', () => {
  it("takes the first page action of the object's click handlers", () => {
    expect(stepEffect(db, onArticle, { page: ref('article'), panel: 1, object: 1 })).toEqual({
      kind: 'openPage',
      page: ref('popup'),
    });
    expect(stepEffect(db, withPopup, { page: ref('popup'), panel: 1, object: 1 })).toEqual({
      kind: 'changePage',
      page: ref('other'),
    });
    expect(stepEffect(db, withPopup, { page: ref('popup'), panel: 1, object: 3 })).toEqual({
      kind: 'closePage',
      page: ref('popup'),
    });
  });

  it('gives no effect for objects without a page action', () => {
    expect(stepEffect(db, onArticle, { page: ref('article'), panel: 1, object: 3 })).toEqual({
      kind: 'none',
    });
    expect(stepEffect(db, onArticle, { page: ref('article'), panel: 1, object: 0 })).toEqual({
      kind: 'none',
    });
  });

  it("follows a NavHotspot to its button's page, in the template's shared panel", () => {
    expect(stepEffect(db, onArticle, { page: ref('article'), panel: 849, object: 1 })).toEqual({
      kind: 'changePage',
      page: ref('other'),
    });
  });

  it('only closes the popups when the base page is clicked while one is open', () => {
    expect(stepEffect(db, withPopup, { page: ref('article'), panel: 1, object: 2 })).toEqual({
      kind: 'closePopups',
    });
  });

  it('rejects steps on pages that are not on screen, and missing objects', () => {
    expect(() => stepEffect(db, onArticle, { page: ref('popup'), panel: 1, object: 1 })).toThrow(
      /not on screen/,
    );
    expect(() => stepEffect(db, onArticle, { page: ref('article'), panel: 1, object: 9 })).toThrow(/no such/);
    expect(() => stepEffect(db, onArticle, { page: ref('article'), panel: 7, object: 0 })).toThrow(/no such/);
  });
});

describe('nextState', () => {
  it('closes every popup when a base page replaces the base page', () => {
    expect(nextState(db, withPopup, { kind: 'changePage', page: ref('other') })).toEqual({
      base: ref('other'),
      popups: [],
    });
  });

  it('replaces the top popup when a popup page replaces it', () => {
    expect(nextState(db, withPopup, { kind: 'changePage', page: ref('popup2') })).toEqual({
      base: ref('article'),
      popups: [ref('popup2')],
    });
  });

  it('opens a popup on top once, and closes it', () => {
    const twice = nextState(db, withPopup, { kind: 'openPage', page: ref('popup') });
    expect(twice).toEqual(withPopup);
    expect(nextState(db, twice, { kind: 'closePage', page: ref('popup') })).toEqual(onArticle);
    expect(nextState(db, twice, { kind: 'closePopups' })).toEqual(onArticle);
    expect(nextState(db, twice, { kind: 'none' })).toBe(twice);
  });
});

describe('applyEffect', () => {
  beforeEach(async () => {
    await showState(engine, onArticle);
  });

  it('opens and closes popup windows', async () => {
    await applyEffect(engine, { kind: 'openPage', page: ref('popup') });
    expect(engineState(engine)).toEqual(withPopup);
    await applyEffect(engine, { kind: 'openPage', page: ref('popup') });
    expect(engine.windows).toHaveLength(1);
    await applyEffect(engine, { kind: 'closePage', page: ref('popup') });
    expect(engineState(engine)).toEqual(onArticle);
  });

  it('replaces the page in a popup window, and closes popups when the base page changes', async () => {
    await applyEffect(engine, { kind: 'openPage', page: ref('popup') });
    await applyEffect(engine, { kind: 'changePage', page: ref('popup2') });
    expect(engineState(engine)).toEqual({ base: ref('article'), popups: [ref('popup2')] });
    await applyEffect(engine, { kind: 'changePage', page: ref('other') });
    expect(engineState(engine)).toEqual({ base: ref('other'), popups: [] });
  });

  it('closes all popups on request and ignores effects without a page change', async () => {
    await showState(engine, { base: ref('article'), popups: [ref('popup'), ref('popup2')] });
    await applyEffect(engine, { kind: 'none' });
    expect(engine.windows).toHaveLength(2);
    await applyEffect(engine, { kind: 'closePopups' });
    expect(engineState(engine)).toEqual(onArticle);
  });
});
