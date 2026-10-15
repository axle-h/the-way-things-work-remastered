// The Index page's controls (special-screens.md §1.5–1.11) on made-up names.
import { describe, expect, it } from 'vitest';
import { StaticColour } from '../colours.ts';
import { IndexedCanvas } from '../render/canvas.ts';
import type { IndexedImage } from '../screen.ts';
import {
  INDEX_CONTROLS,
  INDEX_ROW_HEIGHT,
  IndexScreen,
  type IndexPictures,
  type IndexPointer,
} from './index-screen.ts';

const NAMES = [
  'A. Example',
  'Abacus',
  'Air Pump',
  'Airplane',
  'airship',
  'Zebra', // out of order, kept where it is
  'Bell',
  ...Array.from({ length: 33 }, (_, i) => `Gear ${String(i + 10)}`),
];
const LAST = NAMES.length - 1;

let time = 0;
const key = (screen: IndexScreen, name: string, focused = true, shiftKey = false) =>
  screen.key({ key: name, shiftKey, time: (time += 10) }, focused);
const type = (screen: IndexScreen, text: string): void => {
  for (const char of text) key(screen, char);
};

/** The centre of a list row (0–12), in picture coordinates. */
const row = (r: number): IndexPointer => ({
  x: INDEX_CONTROLS.list.x + 20,
  y: INDEX_CONTROLS.list.y + r * INDEX_ROW_HEIGHT + 6,
  time: (time += 10),
});
/** A point of the scroll bar, `y` rows from its top. */
const bar = (y: number, at = (time += 10)): IndexPointer => ({
  x: INDEX_CONTROLS.scrollBar.x + 8,
  y: INDEX_CONTROLS.scrollBar.y + y,
  time: at,
});
const centre = (control: keyof typeof INDEX_CONTROLS): IndexPointer => {
  const rect = INDEX_CONTROLS[control];
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, time: (time += 10) };
};

function state(screen: IndexScreen) {
  return {
    selection: screen.selection,
    top: screen.top,
    scroll: screen.scrollPosition,
    remembered: screen.remembered,
    edit: screen.editText,
  };
}

describe('the Index as it opens (§1.5)', () => {
  it('selects entry 0, copies it into the edit box all selected, and focuses the edit box', () => {
    const screen = new IndexScreen(NAMES);
    expect(state(screen)).toEqual({ selection: 0, top: 0, scroll: 0, remembered: 0, edit: 'A. Example' });
    expect(screen.editSelection).toEqual([0, 10]);
    expect(screen.focus).toBe('edit');
    expect(screen.maxTop).toBe(NAMES.length - 13);
  });

  it('finds the controls at their picture rectangles (§1.2)', () => {
    const screen = new IndexScreen(NAMES);
    expect(screen.controlAt(27, 88)).toBe('edit');
    expect(screen.controlAt(27 + 308, 88 + 15)).toBe('edit');
    expect(screen.controlAt(27 + 309, 88)).toBeNull();
    expect(screen.controlAt(27, 138)).toBe('list');
    expect(screen.controlAt(322, 136)).toBe('scrollBar');
    expect(screen.controlAt(68, 318)).toBe('ok');
    expect(screen.controlAt(227 + 61, 318 + 21)).toBe('cancel');
    expect(screen.controlAt(10, 10)).toBeNull();
  });
});

describe('typing in the edit box (§1.8)', () => {
  it('selects the first entry from the top that starts with the text, ignoring case', () => {
    const screen = new IndexScreen(NAMES);
    type(screen, 'a');
    expect(state(screen)).toMatchObject({ selection: 0, edit: 'a' });
    type(screen, 'ir');
    expect(state(screen)).toMatchObject({ selection: 2, remembered: 2, edit: 'air' });
    type(screen, 's');
    expect(state(screen)).toMatchObject({ selection: 4, remembered: 4, edit: 'airs' });
    // No match: nothing changes, the text is kept.
    type(screen, 'x');
    expect(state(screen)).toMatchObject({ selection: 4, remembered: 4, edit: 'airsx' });
  });

  it('keeps a selection whose whole name equals the text', () => {
    const screen = new IndexScreen(NAMES);
    type(screen, 'AIRSHIP');
    expect(screen.selection).toBe(4);
  });

  it('scrolls a match below the view onto the last row, and the scroll bar with it', () => {
    const screen = new IndexScreen(NAMES);
    type(screen, 'gear 30');
    expect(state(screen)).toMatchObject({ selection: 27, top: 15, scroll: 15, remembered: 27 });
  });

  it('selects entry 0 when emptied, without moving the scroll bar or the remembered entry', () => {
    const screen = new IndexScreen(NAMES);
    type(screen, 'gear 30');
    key(screen, 'Home', true, true);
    expect(screen.editSelection).toEqual([0, 7]);
    key(screen, 'Backspace');
    expect(state(screen)).toEqual({ selection: 0, top: 0, scroll: 15, remembered: 27, edit: '' });
  });

  it('edits like a standard edit box: caret keys, Delete, typing over a selection', () => {
    const screen = new IndexScreen(NAMES);
    key(screen, 'Home');
    expect(screen.editSelection).toEqual([0, 0]);
    key(screen, 'ArrowRight');
    key(screen, 'ArrowRight', true, true);
    expect(screen.editSelection).toEqual([1, 2]);
    key(screen, 'Delete');
    expect(screen.editText).toBe('A Example');
    key(screen, 'End');
    key(screen, 'ArrowLeft', true, true);
    type(screen, 'y');
    expect(screen.editText).toBe('A Examply');
  });

  it('refuses text that would not fit the 309-pixel box', () => {
    const screen = new IndexScreen(NAMES);
    type(screen, 'W'.repeat(100));
    expect(screen.editText.length).toBeLessThan(100);
    expect(screen.editText.length).toBeGreaterThan(20);
  });

  it('ignores keys meant for the browser and does not type without the Index window focused', () => {
    const screen = new IndexScreen(NAMES);
    expect(screen.key({ key: 'r', ctrlKey: true, time: 0 }, true).used).toBe(false);
    expect(screen.key({ key: 'F5', time: 0 }, true).used).toBe(false);
    expect(screen.key({ key: 'b', time: 0 }, false).used).toBe(false);
    expect(screen.editText).toBe('A. Example');
  });
});

describe('the keyboard hook (§1.9)', () => {
  it('moves the selection with Up, Down, Page Up and Page Down, copying it and keeping it visible', () => {
    const screen = new IndexScreen(NAMES);
    key(screen, 'ArrowUp');
    expect(screen.selection).toBe(0);
    key(screen, 'ArrowDown');
    expect(state(screen)).toEqual({ selection: 1, top: 0, scroll: 0, remembered: 1, edit: 'Abacus' });
    expect(screen.editSelection).toEqual([0, 6]);
    key(screen, 'PageDown');
    expect(state(screen)).toMatchObject({ selection: 14, top: 2, scroll: 2 });
    key(screen, 'PageUp');
    key(screen, 'PageUp');
    expect(state(screen)).toMatchObject({ selection: 0, top: 0, scroll: 0 });
  });

  it('clamps Down and Page Down at the last entry (a deliberate difference)', () => {
    const screen = new IndexScreen(NAMES);
    for (let i = 0; i < 4; i++) key(screen, 'PageDown');
    expect(state(screen)).toMatchObject({ selection: LAST, top: screen.maxTop, remembered: LAST });
    key(screen, 'ArrowDown');
    key(screen, 'PageDown');
    expect(state(screen)).toMatchObject({ selection: LAST, remembered: LAST, edit: NAMES[LAST] });
  });

  it('acts whichever window has the focus; Tab switches between the edit box and the list', () => {
    const screen = new IndexScreen(NAMES);
    expect(key(screen, 'ArrowDown', false).used).toBe(true);
    expect(screen.selection).toBe(1);
    key(screen, 'Tab');
    expect(screen.focus).toBe('list');
    key(screen, 'Tab', false);
    expect(screen.focus).toBe('edit');
  });

  it('goes to the remembered entry and closes with Enter; closes with Esc', () => {
    const screen = new IndexScreen(NAMES);
    key(screen, 'ArrowDown');
    expect(key(screen, 'Enter').command).toEqual({ kind: 'go', entry: 1, close: true });
    expect(key(screen, 'Escape').command).toEqual({ kind: 'close' });
  });

  it('lets the focused list take Home, End and letters (the next name with that letter, wrapping)', () => {
    const screen = new IndexScreen(NAMES);
    key(screen, 'Tab');
    key(screen, 'End');
    expect(screen.selection).toBe(LAST);
    key(screen, 'a');
    expect(state(screen)).toMatchObject({ selection: 0, edit: 'A. Example' });
    key(screen, 'a');
    expect(screen.selection).toBe(1);
    key(screen, 'z');
    expect(screen.selection).toBe(5);
    key(screen, 'Home');
    expect(screen.selection).toBe(0);
  });
});

describe('the mouse on the list and the buttons (§1.7)', () => {
  it('selects the clicked row, focuses the list and copies the name', () => {
    const screen = new IndexScreen(NAMES);
    screen.press('list', row(3));
    expect(screen.release(row(3))).toBeNull();
    expect(state(screen)).toMatchObject({ selection: 3, remembered: 3, edit: 'Airplane' });
    expect(screen.focus).toBe('list');
    // Below the last entry nothing changes.
    expect(new IndexScreen(NAMES.slice(0, 3)).press('list', row(5))).toBeNull();
  });

  it('goes on a double click', () => {
    const screen = new IndexScreen(NAMES);
    expect(screen.press('list', { ...row(4), doubleClick: true })).toEqual({
      kind: 'go',
      entry: 4,
      close: false,
    });
  });

  it('moves the selection while dragging, scrolling past the edges', () => {
    const screen = new IndexScreen(NAMES);
    screen.press('list', row(0));
    screen.move(row(5));
    expect(screen.selection).toBe(5);
    screen.move({ ...row(0), y: INDEX_CONTROLS.list.y + INDEX_CONTROLS.list.height + 5 });
    expect(state(screen)).toMatchObject({ selection: 13, top: 1 });
    // Held below the list, it keeps scrolling.
    expect(screen.tick(time + 250)).toBe(true);
    expect(screen.top).toBeGreaterThan(1);
    screen.release(row(0));
  });

  it('OK goes to the remembered entry on a release over it; Cancel closes', () => {
    const screen = new IndexScreen(NAMES);
    key(screen, 'ArrowDown');
    screen.press('ok', centre('ok'));
    expect(screen.focus).toBeNull();
    expect(screen.release(centre('ok'))).toEqual({ kind: 'go', entry: 1, close: false });
    screen.press('ok', centre('ok'));
    screen.move(centre('cancel'));
    expect(screen.release(centre('cancel'))).toBeNull();
    screen.press('cancel', centre('cancel'));
    expect(screen.release(centre('cancel'))).toEqual({ kind: 'close' });
  });
});

describe('the scroll bar control (§1.11)', () => {
  it('steps by a line or a page at once, moving only the top row', () => {
    const screen = new IndexScreen(NAMES);
    screen.press('scrollBar', bar(165));
    screen.release(bar(165));
    expect(state(screen)).toMatchObject({ selection: 0, top: 1, scroll: 1 });
    screen.press('scrollBar', bar(150));
    screen.release(bar(150));
    expect(state(screen)).toMatchObject({ selection: 0, top: 14, scroll: 14 });
    screen.press('scrollBar', bar(5));
    screen.release(bar(5));
    expect(screen.top).toBe(13);
    screen.press('scrollBar', bar(17));
    screen.release(bar(17));
    expect(screen.top).toBe(0);
  });

  it('repeats every 80 ms while held inside the part, and stops for good once the pointer leaves', () => {
    const screen = new IndexScreen(NAMES);
    const start = (time += 1000);
    screen.press('scrollBar', bar(165, start));
    expect(screen.top).toBe(1);
    screen.tick(start + 79);
    expect(screen.top).toBe(1);
    screen.tick(start + 160);
    expect(screen.top).toBe(3);
    screen.move(bar(100, start + 170));
    screen.tick(start + 240);
    screen.move(bar(165, start + 250));
    screen.tick(start + 400);
    expect(screen.top).toBe(3);
    screen.release(bar(165, start + 410));
  });

  it('pages until the thumb reaches the pointer', () => {
    const screen = new IndexScreen(NAMES);
    const start = (time += 1000);
    screen.press('scrollBar', bar(100, start));
    screen.tick(start + 2000);
    // The thumb stopped under the pointer: its rows now include row 100 or lie just above it.
    expect(screen.top).toBeGreaterThan(0);
    expect(screen.top).toBeLessThan(screen.maxTop);
    screen.release(bar(100, start + 2010));
  });

  it('drags the thumb with its centre under the pointer', () => {
    const screen = new IndexScreen(NAMES);
    screen.press('scrollBar', bar(20));
    expect(screen.top).toBe(0); // a press alone moves nothing
    screen.move(bar(24 + 125));
    expect(state(screen)).toMatchObject({ top: screen.maxTop, scroll: screen.maxTop });
    screen.move(bar(-50));
    expect(screen.top).toBe(0);
    screen.release(bar(0));
  });

  it('moves the focus from the list to the edit box when it scrolls', () => {
    const screen = new IndexScreen(NAMES);
    key(screen, 'Tab');
    screen.press('scrollBar', bar(165));
    screen.release(bar(165));
    expect(screen.focus).toBe('edit');
  });

  it('shows the hand over the arrows and thumb, the arrow over the track', () => {
    const screen = new IndexScreen(NAMES);
    const at = (y: number) => screen.cursorAt(330, INDEX_CONTROLS.scrollBar.y + y);
    expect([at(3), at(20), at(60), at(170)]).toEqual(['hand', 'hand', 'arrow', 'hand']);
    expect(screen.cursorAt(30, 90)).toBe('ibeam');
    expect(screen.cursorAt(30, 140)).toBe('arrow');
    expect(screen.cursorAt(5, 5)).toBeNull();
  });
});

describe('touch on the list (a remake addition, §1.12)', () => {
  it('scrolls by whole rows with a swipe, keeping the selection', () => {
    const screen = new IndexScreen(NAMES);
    screen.press('list', { ...row(10), touch: true });
    screen.move({ ...row(10), y: row(10).y - 5 * INDEX_ROW_HEIGHT, touch: true });
    expect(state(screen)).toMatchObject({ selection: 0, top: 5, scroll: 5 });
    expect(screen.release({ ...row(5), touch: true })).toBeNull();
    expect(screen.selection).toBe(0);
  });

  it('selects a row with a tap and goes with a tap on the selected row', () => {
    const screen = new IndexScreen(NAMES);
    screen.press('list', { ...row(2), touch: true });
    expect(screen.release({ ...row(2), touch: true })).toBeNull();
    expect(screen.selection).toBe(2);
    screen.press('list', { ...row(2), touch: true });
    expect(screen.release({ ...row(2), touch: true })).toEqual({ kind: 'go', entry: 2, close: false });
  });
});

describe('drawing (§1.3)', () => {
  const picture = (fill: number, width = 16, height = 16): IndexedImage => ({
    width,
    height,
    pixels: new Uint8Array(width * height).fill(fill),
  });
  const pictures: IndexPictures = {
    scrollParts: [picture(60), picture(70), picture(80), picture(90, 16, 270), picture(64), picture(74)],
    ok: picture(168, 62, 22),
    okPressed: picture(169, 62, 22),
    cancel: picture(170, 62, 22),
    cancelPressed: picture(171, 62, 22),
  };
  const render = (screen: IndexScreen, at = 0): IndexedImage => {
    const image = picture(231, 363, 360);
    screen.draw(new IndexedCanvas(image), pictures, at);
    return image;
  };
  const pixel = (image: IndexedImage, x: number, y: number) => image.pixels[y * image.width + x];
  const rowColours = (image: IndexedImage, y: number, x0: number, width: number) =>
    new Set(image.pixels.subarray(y * image.width + x0, y * image.width + x0 + width));

  it('draws the list white with black names, the selected row in white on navy', () => {
    const screen = new IndexScreen(NAMES);
    const image = render(screen);
    const list = INDEX_CONTROLS.list;
    expect(pixel(image, list.x + list.width - 1, list.y + 20)).toBe(StaticColour.white);
    const selected = new Set<number>();
    for (let y = list.y; y < list.y + 13; y++)
      for (const c of rowColours(image, y, list.x, list.width)) selected.add(c);
    expect([...selected].toSorted((a, b) => a - b)).toEqual([StaticColour.navy, StaticColour.white]);
    const second = new Set<number>();
    for (let y = list.y + 13; y < list.y + 26; y++)
      for (const c of rowColours(image, y, list.x, list.width)) second.add(c);
    expect([...second].toSorted((a, b) => a - b)).toEqual([StaticColour.black, StaticColour.white]);
  });

  it('draws the focus rectangle on the selected row only while the list has the focus', () => {
    const screen = new IndexScreen(NAMES);
    const list = INDEX_CONTROLS.list;
    expect(rowColours(render(screen), list.y, list.x, list.width)).toEqual(new Set([StaticColour.navy]));
    key(screen, 'Tab');
    // Inverted navy is index 251 (yellow), every other pixel.
    expect(rowColours(render(screen), list.y, list.x, list.width)).toEqual(new Set([StaticColour.navy, 251]));
  });

  it('shows the edit box selection and caret only while it has the focus; the caret blinks', () => {
    const screen = new IndexScreen(NAMES);
    const edit = INDEX_CONTROLS.edit;
    expect(rowColours(render(screen), edit.y + 2, edit.x, 4)).toContain(StaticColour.navy);
    key(screen, 'Tab');
    expect(rowColours(render(screen), edit.y + 2, edit.x, edit.width)).not.toContain(StaticColour.navy);
    key(screen, 'Tab');
    key(screen, 'End');
    const caretX = (image: IndexedImage) =>
      [...Array(edit.width).keys()].filter((x) => pixel(image, edit.x + x, edit.y + 1) === 0).length;
    const blinkStart = time;
    expect(caretX(render(screen, blinkStart))).toBe(1);
    expect(caretX(render(screen, blinkStart + 600))).toBe(0);
  });

  it('draws the buttons, pressed while held over them, and the scroll bar parts', () => {
    const screen = new IndexScreen(NAMES);
    expect(pixel(render(screen), 68, 318)).toBe(168);
    screen.press('ok', centre('ok'));
    expect(pixel(render(screen), 68, 318)).toBe(169);
    screen.move(centre('list'));
    expect(pixel(render(screen), 68, 318)).toBe(168);
    expect(pixel(render(screen), 227, 318)).toBe(170);
    screen.release(centre('list'));
    const bar = INDEX_CONTROLS.scrollBar;
    const image = render(screen);
    expect([
      pixel(image, bar.x, bar.y),
      pixel(image, bar.x, bar.y + 16),
      pixel(image, bar.x, bar.y + 40),
    ]).toEqual([60, 80, 90]);
    expect(pixel(image, bar.x, bar.y + 172)).toBe(70);
    screen.press('scrollBar', { x: bar.x + 4, y: bar.y + 3, time: 0 });
    expect(pixel(render(screen), bar.x, bar.y)).toBe(64);
  });
});
