// The scroll arithmetic of special-screens.md §1.11 and §3.2, with the worked examples there.
import { describe, expect, it } from 'vitest';
import {
  IndexScrollMath,
  roundDivide,
  scrollBarLayout,
  scrollBitmapState,
  scrollDragPosition,
  scrollPartAt,
  scrollPictureRow,
  scrollStep,
} from './scroll.ts';

describe('roundDivide', () => {
  it('doubles, divides truncating, adds 1 and halves rounding down', () => {
    expect(roundDivide(5, 2)).toBe(3); // 2.5 rounds up
    expect(roundDivide(7, 3)).toBe(2);
    expect(roundDivide(8, 3)).toBe(3);
    expect(roundDivide(0, 3)).toBe(0);
    expect(roundDivide(4, 0)).toBe(0);
  });
});

describe('ScrollBitmap position model (§3.2)', () => {
  it('reproduces the worked example of helpamt1: 298-row window, 807-row picture', () => {
    const state = scrollBitmapState(298, 807);
    expect(state).toEqual({ position: 0, max: 28, page: 16, distance: 509 });
    state.position = scrollStep(state, 'pageDown');
    expect(state.position).toBe(16);
    expect(scrollPictureRow(state)).toBe(291);
    // The bar (530,49)–(546,349): track rows 65–332, travel 253, thumb top row 210.
    const layout = scrollBarLayout(16, 300, state);
    expect([layout.trackTop, layout.trackBottom, layout.travel]).toEqual([16, 284, 253]);
    expect(49 + layout.thumbTop).toBe(210);
  });

  it('reproduces the helpbmt0 check: one page down is position 16, row 291, thumb at row 125', () => {
    const state = scrollBitmapState(300, 1520);
    expect([state.max, state.page]).toEqual([67, 16]);
    state.position = scrollStep(state, 'pageDown');
    expect(scrollPictureRow(state)).toBe(291);
    const layout = scrollBarLayout(16, 302, state);
    expect(layout.travel).toBe(255);
    expect(48 + layout.thumbTop).toBe(125);
  });

  it('gives the page sizes of the four scrollable Help pages', () => {
    expect([807, 1470, 418].map((height) => scrollBitmapState(298, height).page)).toEqual([16, 17, 15]);
    expect(scrollBitmapState(300, 1520).page).toBe(16);
  });

  it('cannot scroll a picture no taller than its window (or less than one step taller)', () => {
    expect(scrollBitmapState(298, 298).max).toBe(0);
    expect(scrollBitmapState(298, 297).max).toBe(0);
    expect(scrollBitmapState(298, 310).max).toBe(0);
    const state = scrollBitmapState(298, 298);
    expect(scrollStep(state, 'lineDown')).toBe(0);
    expect(scrollPictureRow(state)).toBe(0);
  });

  it('shows the picture bottom exactly at the last position, and clamps steps', () => {
    const state = scrollBitmapState(298, 807);
    state.position = 27;
    expect(scrollStep(state, 'lineDown')).toBe(28);
    state.position = 28;
    expect(scrollPictureRow(state)).toBe(509);
    expect(scrollStep(state, 'lineDown')).toBe(28);
    expect(scrollStep(state, 'pageDown')).toBe(28);
    state.position = 3;
    expect(scrollStep(state, 'pageUp')).toBe(0);
    expect(scrollStep(state, 'lineUp')).toBe(2);
  });

  it('classifies presses by part: arrows, track above and below the thumb, thumb', () => {
    const state = scrollBitmapState(298, 807);
    state.position = 16;
    const { trackTop, thumbTop, trackBottom } = scrollBarLayout(16, 300, state);
    const part = (y: number) => scrollPartAt(y, trackTop, thumbTop, trackBottom);
    expect([part(0), part(15), part(16), part(thumbTop - 1), part(thumbTop)]).toEqual([
      'lineUp',
      'lineUp',
      'pageUp',
      'pageUp',
      'thumb',
    ]);
    expect([part(thumbTop + 15), part(thumbTop + 16), part(283), part(284), part(300)]).toEqual([
      'thumb',
      'pageDown',
      'pageDown',
      'lineDown',
      'lineDown',
    ]);
  });

  it('keeps the thumb centre under the pointer while dragging, clamped', () => {
    const state = scrollBitmapState(298, 807);
    const layout = scrollBarLayout(16, 300, state);
    expect(scrollDragPosition(16 + 8, layout, state)).toBe(0);
    expect(scrollDragPosition(0, layout, state)).toBe(0);
    expect(scrollDragPosition(16 + 8 + 253, layout, state)).toBe(28);
    expect(scrollDragPosition(299, layout, state)).toBe(28);
    // Position 16's thumb top is 145 below the track: its centre is at 16 + 145 + 8.
    expect(scrollDragPosition(16 + 145 + 8, layout, state)).toBe(16);
  });
});

describe('the Index scroll bar control (§1.11)', () => {
  const math = new IndexScrollMath(1857, 173);

  it('has a 125-pixel travel and rounds the thumb offset half up', () => {
    expect(math.travel).toBe(125);
    expect(math.thumbOffset(0)).toBe(0);
    expect(math.thumbOffset(1857)).toBe(125);
    // At the largest top row the thumb stops one row short of the down arrow.
    expect(math.thumbOffset(1844)).toBe(124);
    expect(math.thumbOffset(15)).toBe(1); // 1.0097…
    expect(math.thumbOffset(7)).toBe(0); // 0.47…
  });

  it('turns a drag position into a position whose thumb centre is at the pointer', () => {
    expect(math.dragPosition(24)).toBe(0);
    expect(math.dragPosition(0)).toBe(0);
    // Truncated: the single-precision ratio makes this 1,856.99…, still the bottom thumb position.
    expect(math.dragPosition(24 + 125)).toBe(1856);
    expect(math.thumbOffset(1856)).toBe(125);
    expect(math.dragPosition(200)).toBe(1857);
    const position = math.dragPosition(24 + 62);
    expect(math.thumbOffset(position)).toBe(62);
  });
});
