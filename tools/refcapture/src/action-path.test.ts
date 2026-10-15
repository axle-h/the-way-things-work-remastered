import { describe, expect, it } from 'vitest';
import {
  clickPoint,
  formatStep,
  parseStep,
  pathName,
  resolvePath,
  topPage,
  WINE_POPUP_PLACEMENT,
  wineLosesPopupPicture,
} from './action-path.ts';
import { db, ref } from './test-database.ts';

const clientSize = { width: 638, height: 459 };

describe('steps', () => {
  it('parses and formats page:panel:object', () => {
    expect(parseStep('1538:1:11')).toEqual({ page: 1538, panel: 1, object: 11 });
    expect(parseStep('0x602:1:0')).toEqual({ page: 0x602, panel: 1, object: 0 });
    expect(formatStep({ page: 1538, panel: 1, object: 11 })).toBe('1538:1:11');
    expect(() => parseStep('1538:1')).toThrow(/page:panel:object/);
  });

  it('names a path prefix for files', () => {
    expect(pathName(1538, [{ page: 1538, panel: 1, object: 11 }])).toBe('path-1538_1538-1-11');
    expect(pathName(1538, [])).toBe('path-1538');
  });
});

describe('clickPoint', () => {
  const visible = { left: 0, top: 0, right: 100, bottom: 100 };

  it('uses the centre when nothing covers it', () => {
    expect(clickPoint({ left: 10, top: 10, right: 20, bottom: 30 }, [], visible)).toEqual({
      point: { x: 14, y: 19 },
      clear: true,
    });
  });

  it('moves away from overlapping clickable objects', () => {
    const { point, clear } = clickPoint(
      { left: 10, top: 10, right: 50, bottom: 30 },
      [{ left: 25, top: 5, right: 60, bottom: 40 }],
      visible,
    );
    expect(clear).toBe(true);
    expect(point).toEqual({ x: 24, y: 19 });
  });

  it('stays inside the visible client area', () => {
    const { point } = clickPoint({ left: 90, top: 90, right: 120, bottom: 120 }, [], visible);
    expect(point).toEqual({ x: 99, y: 99 });
  });

  it('reports when the rectangle is fully covered', () => {
    expect(
      clickPoint(
        { left: 10, top: 10, right: 20, bottom: 20 },
        [{ left: 0, top: 0, right: 30, bottom: 30 }],
        visible,
      ).clear,
    ).toBe(false);
  });
});

describe('resolvePath', () => {
  it('maps a content-panel object through the panel position', () => {
    const [step] = resolvePath(
      db,
      { start: ref('airplane'), steps: [{ page: ref('airplane'), panel: 1, object: 1 }] },
      { clientSize },
    );
    // Panel 1 is at (94, 4); the hotspot (10,10)-(50,30) overlaps a different hotspot from x = 25.
    expect(step!.panelOrigin).toEqual({ x: 94, y: 4 });
    expect(step!.point).toEqual({ x: 94 + 24, y: 4 + 19 });
    expect(step!.effect).toEqual({ kind: 'openPage', page: ref('popup') });
    expect(step!.after).toEqual({ base: ref('airplane'), popups: [ref('popup')] });
    expect(topPage(step!.after)).toBe(ref('popup'));
  });

  it('maps popup objects through the popup placement and follows page changes', () => {
    const steps = resolvePath(
      db,
      {
        start: ref('airplane'),
        steps: [
          { page: ref('airplane'), panel: 1, object: 3 },
          { page: ref('popup'), panel: 1, object: 1 },
        ],
      },
      { clientSize },
    );
    const origin = WINE_POPUP_PLACEMENT({ x: 100, y: 50 });
    expect(steps[1]!.point).toEqual({ x: origin.x + 14, y: origin.y + 9 });
    expect(steps[1]!.after).toEqual({ base: ref('workshop'), popups: [] });
  });

  it('uses the shared navigation bar of the template', () => {
    const [step] = resolvePath(
      db,
      { start: ref('airplane'), steps: [{ page: ref('airplane'), panel: 849, object: 1 }] },
      { clientSize },
    );
    expect(step!.objectKind).toBe('navHotspot');
    expect(step!.point).toEqual({ x: 46, y: 38 });
    expect(step!.effect).toEqual({ kind: 'changePage', page: ref('workshop') });
  });

  describe('navigation buttons', () => {
    const nav = (page: string, object: number) => ({ page: ref(page), panel: 849, object });
    const effects = (start: string, steps: ReturnType<typeof nav>[]) =>
      resolvePath(db, { start: ref(start), steps }, { clientSize }).map((step) => step.effect);

    it('follow the base page links, else the NavPanel pages', () => {
      // Machines: link 1 on the Airplane, NavPanel page 2 elsewhere.
      expect(effects('airplane', [nav('airplane', 2)])).toEqual([{ kind: 'changePage', page: ref('aza') }]);
      expect(effects('workshop', [nav('workshop', 2)])).toEqual([
        { kind: 'changePage', page: ref('azmachine') },
      ]);
      // Principles: link 0, a popup, which is opened.
      expect(effects('airplane', [nav('airplane', 3)])).toEqual([{ kind: 'openPage', page: ref('popup') }]);
      // Options: opens the first Options page.
      expect(effects('workshop', [nav('workshop', 5)])).toEqual([{ kind: 'openPage', page: ref('popup') }]);
    });

    it('do not close popups first', () => {
      const steps = resolvePath(
        db,
        {
          start: ref('airplane'),
          steps: [{ page: ref('airplane'), panel: 1, object: 1 }, nav('airplane', 2)],
        },
        { clientSize },
      );
      expect(steps[1]!.effect).toEqual({ kind: 'changePage', page: ref('aza') });
      expect(steps[1]!.after).toEqual({ base: ref('aza'), popups: [] });
    });

    it('go back through the history of base pages, which a direct start leaves empty', () => {
      expect(effects('airplane', [nav('airplane', 4)])).toEqual([{ kind: 'none' }]);
      expect(
        effects('airplane', [nav('airplane', 1), nav('workshop', 2), nav('azmachine', 4)]).at(-1),
      ).toEqual({ kind: 'changePage', page: ref('workshop') });
    });
  });

  it('predicts that a click on the base page closes an open popup', () => {
    const steps = resolvePath(
      db,
      {
        start: ref('airplane'),
        steps: [
          { page: ref('airplane'), panel: 1, object: 1 },
          { page: ref('airplane'), panel: 1, object: 4 },
        ],
      },
      { clientSize },
    );
    expect(steps[1]!.effect).toEqual({ kind: 'closePopups' });
    expect(steps[1]!.after).toEqual({ base: ref('airplane'), popups: [] });
  });

  it('rejects steps on pages that are not on screen, and missing objects', () => {
    expect(() =>
      resolvePath(
        db,
        { start: ref('airplane'), steps: [{ page: ref('workshop'), panel: 1, object: 0 }] },
        { clientSize },
      ),
    ).toThrow(/not on screen/);
    expect(() =>
      resolvePath(
        db,
        { start: ref('airplane'), steps: [{ page: ref('airplane'), panel: 1, object: 99 }] },
        { clientSize },
      ),
    ).toThrow(/no object 99/);
    expect(() =>
      resolvePath(
        db,
        { start: ref('airplane'), steps: [{ page: ref('airplane'), panel: 5, object: 0 }] },
        { clientSize },
      ),
    ).toThrow(/no panel 5/);
  });
});

describe('wineLosesPopupPicture', () => {
  it('is true when shrinking by the shadow changes the 128-pixel surface size', () => {
    expect(wineLosesPopupPicture({ width: 185, height: 131 })).toBe(true);
    expect(wineLosesPopupPicture({ width: 359, height: 388 })).toBe(true);
    expect(wineLosesPopupPicture({ width: 260, height: 300 })).toBe(true);
    expect(wineLosesPopupPicture({ width: 291, height: 342 })).toBe(false);
    expect(wineLosesPopupPicture({ width: 256, height: 133 })).toBe(false);
    expect(wineLosesPopupPicture({ width: 100, height: 100 })).toBe(false);
  });
});
