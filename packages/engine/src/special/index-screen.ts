/**
 * The Index page's controls (special-screens.md §1): an edit box, a list box with the A–Z index
 * names, the program's own scroll bar control, and OK and Cancel buttons, all drawn into the
 * indexed framebuffer over the Index picture. This is their model (selection, top row, the edit
 * box's text and selection, focus, presses and auto-repeat) and their drawing; the engine routes
 * input here and performs the commands it returns (going to an entry, closing the Index).
 *
 * Coordinates are picture coordinates of the Index window: (0,0) is the picture's top-left, 8
 * rows below the window's top (special-screens.md §1.2).
 */
import { StaticColour } from '../colours.ts';
import type { CursorName } from '../input/cursor.ts';
import type { IndexedCanvas } from '../render/canvas.ts';
import { drawScrollBar } from '../render/paint.ts';
import type { IndexedImage } from '../screen.ts';
import { drawText, textOffsets, textWidth } from '../text/font.ts';
import { SERIF_FONT } from '../text/serif-font.ts';
import {
  clamp,
  INDEX_SCROLL_REPEAT_MS,
  IndexScrollMath,
  scrollPartAt,
  scrollPartRows,
  SCROLL_PART_SIZE,
  type ScrollPart,
} from './scroll.ts';

/** A control's rectangle in picture coordinates. */
export interface ControlRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type IndexControl = 'edit' | 'list' | 'scrollBar' | 'ok' | 'cancel';

/** The five controls' rectangles (special-screens.md §1.2). */
export const INDEX_CONTROLS: Readonly<Record<IndexControl, ControlRect>> = {
  edit: { x: 27, y: 88, width: 309, height: 16 },
  list: { x: 27, y: 138, width: 293, height: 169 },
  scrollBar: { x: 322, y: 136, width: 16, height: 173 },
  ok: { x: 68, y: 318, width: 62, height: 22 },
  cancel: { x: 227, y: 318, width: 62, height: 22 },
};

/** Rows of the list: 169 ÷ 13, the cell height of MS Serif 8 point (§1.3). */
export const INDEX_ROW_HEIGHT = 13;
export const INDEX_ROWS = 13;

/** Text margins and colours (special-screens.md §1.3; the margins are [H]). */
export const INDEX_TEXT = {
  /** The list draws each name this far right of the row's left edge. */
  listMargin: 1,
  /** The edit box's text starts at its left edge and top. */
  editMargin: 0,
  text: StaticColour.black,
  background: StaticColour.white,
  /** `COLOR_HIGHLIGHT` and `COLOR_HIGHLIGHTTEXT` of the default Windows 3.1 scheme. */
  highlight: StaticColour.navy,
  highlightText: StaticColour.white,
} as const;

/** Windows' default caret blink time [H]. */
export const CARET_BLINK_MS = 530;

/** A list box drag outside the list scrolls a row this often [H: the standard list box]. */
const LIST_AUTOSCROLL_MS = 100;

/** A touch that moves this far (pixels) before its release is a swipe, not a tap. */
export const SWIPE_THRESHOLD = 6;

/** What the engine does after an input: go to an entry (and maybe close the Index), or close it. */
export type IndexCommand =
  { readonly kind: 'go'; readonly entry: number; readonly close: boolean } | { readonly kind: 'close' };

/** The program bitmaps the controls are drawn from (program.md, Bitmaps). */
export interface IndexPictures {
  /** `LINEUP`, `LINEDOWN`, `THUMB`, `THUMBTRACK`, `LINEUPALT`, `LINEDOWNALT`, `THUMBALT`, `THUMBTRACKALT`. */
  readonly scrollParts: readonly (IndexedImage | null)[];
  readonly ok: IndexedImage | null;
  readonly okPressed: IndexedImage | null;
  readonly cancel: IndexedImage | null;
  readonly cancelPressed: IndexedImage | null;
}

export interface IndexPointer {
  readonly x: number;
  readonly y: number;
  /** Clock time in milliseconds. */
  readonly time: number;
  /** A touch (finger) rather than a mouse or pen: swipes scroll the list (a remake addition). */
  readonly touch?: boolean;
  /** The second press of a mouse double click. */
  readonly doubleClick?: boolean;
}

export interface IndexKey {
  /** DOM `KeyboardEvent.key`. */
  readonly key: string;
  readonly shiftKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly time: number;
}

/** The single-line edit box: its text and selection (anchor … caret). */
class EditBox {
  text = '';
  anchor = 0;
  caret = 0;

  get start(): number {
    return Math.min(this.anchor, this.caret);
  }

  get end(): number {
    return Math.max(this.anchor, this.caret);
  }

  /** Replaces the text, all of it selected (the program copying a name in). */
  setAll(text: string): void {
    this.text = text;
    this.anchor = 0;
    this.caret = text.length;
  }

  /**
   * Replaces the selection by `insert`. Refused (returns false) if the text would no longer fit
   * the box: the edit control has no horizontal scrolling [H].
   */
  replace(insert: string, fits: (text: string) => boolean): boolean {
    const text = this.text.slice(0, this.start) + insert + this.text.slice(this.end);
    if (insert !== '' && !fits(text)) return false;
    const caret = this.start + insert.length;
    const changed = text !== this.text;
    this.text = text;
    this.anchor = caret;
    this.caret = caret;
    return changed;
  }

  moveTo(position: number, extend: boolean): void {
    this.caret = clamp(position, 0, this.text.length);
    if (!extend) this.anchor = this.caret;
  }
}

type Press =
  | { readonly kind: 'edit' }
  | {
      readonly kind: 'list';
      readonly touch: boolean;
      readonly startY: number;
      readonly startTop: number;
      swiping: boolean;
    }
  | { readonly kind: 'scroll'; readonly part: ScrollPart; nextRepeat: number; repeating: boolean }
  | { readonly kind: 'button'; readonly button: 'ok' | 'cancel'; inside: boolean };

export class IndexScreen {
  /** The names in data order (special-screens.md §1.4). */
  readonly names: readonly string[];
  readonly #math: IndexScrollMath;
  readonly #edit = new EditBox();
  #selection = 0;
  #top = 0;
  #scrollPosition = 0;
  #remembered = 0;
  #focus: 'edit' | 'list' | null = 'edit';
  #press: Press | null = null;
  #pointer: { x: number; y: number } | null = null;
  #nextAutoscroll = 0;
  #blinkFrom: number;
  #caretShown = true;

  /** The Index as it opens (§1.5): entry 0 selected and in the edit box, all selected, focused. */
  constructor(names: readonly string[], now = 0) {
    this.names = names;
    this.#math = new IndexScrollMath(names.length, INDEX_CONTROLS.scrollBar.height);
    this.#edit.setAll(names[0] ?? '');
    this.#blinkFrom = now;
  }

  // -------------------------------------------------------------------------------------------
  // State

  get count(): number {
    return this.names.length;
  }

  /** The selected entry. */
  get selection(): number {
    return this.#selection;
  }

  /** The entry on the list's first row. */
  get top(): number {
    return this.#top;
  }

  /** The scroll bar's position; equal to {@link top} except after the edit box is emptied (§1.8). */
  get scrollPosition(): number {
    return this.#scrollPosition;
  }

  /** The entry OK, Enter and a double click go to (§1.6). */
  get remembered(): number {
    return this.#remembered;
  }

  /** Which control has the keyboard focus; `null` for neither (a button, or the picture). */
  get focus(): 'edit' | 'list' | null {
    return this.#focus;
  }

  get editText(): string {
    return this.#edit.text;
  }

  /** The edit box's selection, `[start, end)` in characters; equal when only the caret shows. */
  get editSelection(): readonly [number, number] {
    return [this.#edit.start, this.#edit.end];
  }

  /** The largest top row: the last entry on the last row. */
  get maxTop(): number {
    return Math.max(0, this.count - INDEX_ROWS);
  }

  /** The control at a picture point, the controls being on top of the picture. */
  controlAt(x: number, y: number): IndexControl | null {
    for (const control of ['edit', 'list', 'scrollBar', 'ok', 'cancel'] as const) {
      const rect = INDEX_CONTROLS[control];
      if (x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height) return control;
    }
    return null;
  }

  /** The cursor over a picture point, `null` outside the controls (§1.2, §1.11). */
  cursorAt(x: number, y: number): CursorName | null {
    const control = this.#press?.kind === 'scroll' ? 'scrollBar' : this.controlAt(x, y);
    switch (control) {
      case null:
        return null;
      case 'edit':
        return 'ibeam';
      case 'scrollBar': {
        const part = this.#scrollPartAt(y - INDEX_CONTROLS.scrollBar.y);
        return part === 'pageUp' || part === 'pageDown' ? 'arrow' : 'hand';
      }
      default:
        return 'arrow';
    }
  }

  // -------------------------------------------------------------------------------------------
  // Pointer

  /** A press on a control (picture coordinates). */
  press(control: IndexControl, pointer: IndexPointer): IndexCommand | null {
    this.#pointer = { x: pointer.x, y: pointer.y };
    this.#press = null;
    switch (control) {
      case 'edit': {
        this.#setFocus('edit', pointer.time);
        const at = this.#editPosition(pointer.x);
        if (pointer.doubleClick === true) {
          const [start, end] = wordAround(this.#edit.text, at);
          this.#edit.moveTo(start, false);
          this.#edit.moveTo(end, true);
        } else {
          this.#edit.moveTo(at, false);
          this.#press = { kind: 'edit' };
        }
        this.#blinkFrom = pointer.time;
        return null;
      }
      case 'list': {
        this.#setFocus('list', pointer.time);
        const touch = pointer.touch === true;
        this.#press = { kind: 'list', touch, startY: pointer.y, startTop: this.#top, swiping: false };
        if (touch) return null;
        const row = this.#rowAt(pointer.y);
        if (row !== null) this.#select(row);
        if (pointer.doubleClick === true) {
          this.#press = null;
          return this.#go(false);
        }
        this.#nextAutoscroll = pointer.time + LIST_AUTOSCROLL_MS;
        return null;
      }
      case 'scrollBar': {
        const part = this.#scrollPartAt(pointer.y - INDEX_CONTROLS.scrollBar.y);
        this.#press = {
          kind: 'scroll',
          part,
          nextRepeat: pointer.time + INDEX_SCROLL_REPEAT_MS,
          repeating: true,
        };
        if (part !== 'thumb') this.#scrollStep(part, pointer.time);
        return null;
      }
      case 'ok':
      case 'cancel':
        // A button takes the focus from the edit box and the list [H: standard push button].
        this.#setFocus(null, pointer.time);
        this.#press = { kind: 'button', button: control, inside: true };
        return null;
    }
  }

  /** A press on the Index picture outside the controls: neither control keeps the focus [H]. */
  pressOutside(time: number): void {
    this.#press = null;
    this.#setFocus(null, time);
  }

  /** Pointer movement while a control holds the press. */
  move(pointer: IndexPointer): void {
    this.#pointer = { x: pointer.x, y: pointer.y };
    const press = this.#press;
    if (press === null) return;
    switch (press.kind) {
      case 'edit':
        this.#edit.moveTo(this.#editPosition(pointer.x), true);
        this.#blinkFrom = pointer.time;
        return;
      case 'list': {
        if (press.touch) {
          const dy = pointer.y - press.startY;
          if (!press.swiping && Math.abs(dy) < SWIPE_THRESHOLD) return;
          press.swiping = true;
          // A swipe scrolls whole rows with the finger; the selection stays.
          this.#setTop(press.startTop - Math.round(dy / INDEX_ROW_HEIGHT), true);
          return;
        }
        this.#dragList(pointer.y);
        return;
      }
      case 'scroll':
        if (press.part === 'thumb') {
          const position = this.#math.dragPosition(pointer.y - INDEX_CONTROLS.scrollBar.y);
          this.#scrollTo(position, pointer.time);
        }
        return;
      case 'button':
        press.inside = this.controlAt(pointer.x, pointer.y) === press.button;
        return;
    }
  }

  /** The release that ends a press: a button acts if released on it; a tap on a row selects or goes. */
  release(pointer: IndexPointer): IndexCommand | null {
    this.#pointer = { x: pointer.x, y: pointer.y };
    const press = this.#press;
    this.#press = null;
    if (press === null) return null;
    if (press.kind === 'button') {
      if (this.controlAt(pointer.x, pointer.y) !== press.button) return null;
      return press.button === 'ok' ? this.#go(false) : { kind: 'close' };
    }
    if (press.kind === 'list' && press.touch && !press.swiping) {
      // A tap selects a row; a tap on the selected row goes (special-screens.md §1.12).
      const row = this.#rowAt(pointer.y);
      if (row === null) return null;
      if (row === this.#selection) return this.#go(false);
      this.#select(row);
    }
    return null;
  }

  /**
   * Selects an entry as a click on its row does (§1.6): scrolled into view, copied into the edit
   * box and remembered. For tools and tests that need to reach any entry directly.
   */
  selectEntry(entry: number): void {
    this.#select(entry);
  }

  /** The press was cancelled (e.g. the window closed): forget it. */
  cancelPress(): void {
    this.#press = null;
  }

  /** Whether a control holds the press. */
  get pressed(): boolean {
    return this.#press !== null;
  }

  // -------------------------------------------------------------------------------------------
  // Keyboard (§1.9)

  /**
   * A key press. The keyboard hook's keys act whichever window has the focus (`focused` false);
   * the others go to the focused control only when the Index window has the focus. Returns whether
   * the key was used, and the command to perform.
   */
  key(input: IndexKey, focused: boolean): { readonly used: boolean; readonly command: IndexCommand | null } {
    const used = { used: true, command: null };
    const last = this.count - 1;
    switch (input.key) {
      case 'Tab':
        this.#setFocus(this.#focus === 'edit' ? 'list' : 'edit', input.time);
        return used;
      case 'ArrowDown':
        // The original asks for an entry past the end at the last entry; the remake clamps.
        this.#select(clamp(this.#selection + 1, 0, last));
        return used;
      case 'ArrowUp':
        if (this.#selection > 0) this.#select(this.#selection - 1);
        return used;
      case 'PageDown':
        this.#select(clamp(this.#selection + INDEX_ROWS, 0, last));
        return used;
      case 'PageUp':
        this.#select(Math.max(0, this.#selection - INDEX_ROWS));
        return used;
      case 'Enter':
        return { used: true, command: this.#go(true) ?? { kind: 'close' } };
      case 'Escape':
        return { used: true, command: { kind: 'close' } };
    }
    if (!focused || input.ctrlKey === true) return { used: false, command: null };
    if (this.#focus === 'edit') return { used: this.#editKey(input), command: null };
    if (this.#focus === 'list') return { used: this.#listKey(input), command: null };
    return { used: false, command: null };
  }

  /** Keys the edit box handles itself (standard edit control [H]). */
  #editKey(input: IndexKey): boolean {
    const edit = this.#edit;
    const extend = input.shiftKey === true;
    let changed = false;
    switch (input.key) {
      case 'Backspace':
        if (edit.start === edit.end) edit.moveTo(edit.caret - 1, true);
        changed = edit.replace('', () => true);
        break;
      case 'Delete':
        if (edit.start === edit.end) edit.moveTo(edit.caret + 1, true);
        changed = edit.replace('', () => true);
        break;
      case 'ArrowLeft':
        edit.moveTo(!extend && edit.start !== edit.end ? edit.start : edit.caret - 1, extend);
        break;
      case 'ArrowRight':
        edit.moveTo(!extend && edit.start !== edit.end ? edit.end : edit.caret + 1, extend);
        break;
      case 'Home':
        edit.moveTo(0, extend);
        break;
      case 'End':
        edit.moveTo(edit.text.length, extend);
        break;
      default: {
        const char = typedCharacter(input.key);
        if (char === null) return false;
        changed = edit.replace(char, (text) => this.#editFits(text));
      }
    }
    this.#blinkFrom = input.time;
    if (changed) this.#editChanged();
    return true;
  }

  /** Keys the list box handles itself (standard list box [H]). */
  #listKey(input: IndexKey): boolean {
    const last = this.count - 1;
    switch (input.key) {
      case 'Home':
        this.#select(0);
        return true;
      case 'End':
        this.#select(last);
        return true;
      case 'ArrowLeft':
        if (this.#selection > 0) this.#select(this.#selection - 1);
        return true;
      case 'ArrowRight':
        this.#select(clamp(this.#selection + 1, 0, last));
        return true;
    }
    const char = typedCharacter(input.key);
    if (char === null) return false;
    // The next entry, after the selection and wrapping, whose name starts with the character.
    for (let step = 1; step <= this.count; step++) {
      const entry = (this.#selection + step) % this.count;
      if (startsWithIgnoringCase(this.names[entry]!, char)) {
        this.#select(entry);
        break;
      }
    }
    return true;
  }

  // -------------------------------------------------------------------------------------------
  // Time

  /** Advances auto-repeat and the caret's blink to `time`. Returns whether anything changed. */
  tick(time: number): boolean {
    let changed = false;
    const press = this.#press;
    if (press?.kind === 'scroll' && press.part !== 'thumb' && press.repeating) {
      while (press.repeating && time >= press.nextRepeat) {
        // Before each repeat the pointer must still be inside the part, else repeating stops for good.
        if (!this.#pointerInPart(press.part)) {
          press.repeating = false;
          break;
        }
        changed = this.#scrollStep(press.part, press.nextRepeat) || changed;
        press.nextRepeat += INDEX_SCROLL_REPEAT_MS;
      }
    }
    if (press?.kind === 'list' && !press.touch && this.#pointer !== null) {
      const { y } = this.#pointer;
      const list = INDEX_CONTROLS.list;
      while (time >= this.#nextAutoscroll && (y < list.y || y >= list.y + list.height)) {
        this.#dragList(y);
        this.#nextAutoscroll += LIST_AUTOSCROLL_MS;
        changed = true;
      }
      if (time >= this.#nextAutoscroll) this.#nextAutoscroll = time + LIST_AUTOSCROLL_MS;
    }
    const caret = this.#caretVisible(time);
    if (caret !== this.#caretShown) {
      this.#caretShown = caret;
      changed = true;
    }
    return changed;
  }

  // -------------------------------------------------------------------------------------------
  // Drawing

  /**
   * Draws the controls into `canvas`, whose origin is the picture's top-left. `screenParity` is
   * (screen x − image x + screen y − image y) mod 2, for the dotted focus rectangle's pattern.
   */
  draw(canvas: IndexedCanvas, pictures: IndexPictures, time: number, screenParity = 0): void {
    this.#drawEdit(canvas, time);
    this.#drawList(canvas, screenParity);
    this.#drawScrollBar(canvas, pictures);
    const press = this.#press;
    const shown = (button: 'ok' | 'cancel'): boolean =>
      press?.kind === 'button' && press.button === button && press.inside;
    const ok = shown('ok') ? (pictures.okPressed ?? pictures.ok) : pictures.ok;
    const cancel = shown('cancel') ? (pictures.cancelPressed ?? pictures.cancel) : pictures.cancel;
    if (ok !== null) canvas.draw(ok, INDEX_CONTROLS.ok.x, INDEX_CONTROLS.ok.y);
    if (cancel !== null) canvas.draw(cancel, INDEX_CONTROLS.cancel.x, INDEX_CONTROLS.cancel.y);
  }

  #drawEdit(canvas: IndexedCanvas, time: number): void {
    const rect = INDEX_CONTROLS.edit;
    const view = canvas.view(rect.x, rect.y, rect.width, rect.height);
    view.fill(0, 0, rect.width, rect.height, INDEX_TEXT.background);
    const { text } = this.#edit;
    const x = INDEX_TEXT.editMargin;
    drawText(view, SERIF_FONT, text, x, 0, INDEX_TEXT.text, { bold: true });
    if (this.#focus !== 'edit') return;
    const offsets = textOffsets(SERIF_FONT, text, { bold: true });
    const { start, end } = this.#edit;
    if (start < end) {
      // The selection, white on the highlight colour, shown only while the box has the focus.
      const left = x + offsets[start]!;
      const selection = view.view(left, 0, offsets[end]! - offsets[start]!, SERIF_FONT.height);
      selection.fill(0, 0, rect.width, SERIF_FONT.height, INDEX_TEXT.highlight);
      drawText(
        view.view(left, 0, offsets[end]! - offsets[start]!, rect.height),
        SERIF_FONT,
        text,
        x - left,
        0,
        INDEX_TEXT.highlightText,
        { bold: true },
      );
    }
    if (this.#caretVisible(time)) {
      const caretX = Math.min(rect.width - 1, x + offsets[this.#edit.caret]!);
      view.map(caretX, 0, 1, SERIF_FONT.height, (index) => 255 - index);
    }
  }

  #drawList(canvas: IndexedCanvas, screenParity: number): void {
    const rect = INDEX_CONTROLS.list;
    const view = canvas.view(rect.x, rect.y, rect.width, rect.height);
    view.fill(0, 0, rect.width, rect.height, INDEX_TEXT.background);
    for (let row = 0; row < INDEX_ROWS; row++) {
      const entry = this.#top + row;
      if (entry >= this.count) break;
      const y = row * INDEX_ROW_HEIGHT;
      const selected = entry === this.#selection;
      if (selected) view.fill(0, y, rect.width, INDEX_ROW_HEIGHT, INDEX_TEXT.highlight);
      const colour = selected ? INDEX_TEXT.highlightText : INDEX_TEXT.text;
      drawText(
        view.view(0, y, rect.width, INDEX_ROW_HEIGHT),
        SERIF_FONT,
        this.names[entry]!,
        INDEX_TEXT.listMargin,
        0,
        colour,
        { bold: true },
      );
      if (selected && this.#focus === 'list')
        invertDottedFrame(view, 0, y, rect.width, INDEX_ROW_HEIGHT, screenParity);
    }
  }

  #drawScrollBar(canvas: IndexedCanvas, pictures: IndexPictures): void {
    const rect = INDEX_CONTROLS.scrollBar;
    const view = canvas.view(rect.x, rect.y, rect.width, rect.height);
    const press = this.#press;
    // Only the arrows look different while pressed; the other pressed pictures are identical (§1.11).
    const pressed =
      press?.kind === 'scroll' && (press.part === 'lineUp' || press.part === 'lineDown') ? press.part : null;
    drawScrollBar(
      view,
      { left: 0, top: 0, right: rect.width, bottom: rect.height },
      pictures.scrollParts,
      this.#math.thumbOffset(this.#scrollPosition),
      pressed,
    );
  }

  // -------------------------------------------------------------------------------------------
  // The model

  /**
   * A selection by a click or a key (§1.6): select, keep it visible scrolling as little as
   * possible, sync the scroll bar, copy the name into the edit box (all selected) and remember it.
   */
  #select(entry: number): void {
    if (entry < 0 || entry >= this.count) return;
    this.#selection = entry;
    this.#scrollIntoView(entry);
    this.#scrollPosition = this.#top;
    this.#edit.setAll(this.names[entry]!);
    this.#remembered = entry;
  }

  /** What the list box does to show a selected entry: it ends up on the first or last row. */
  #scrollIntoView(entry: number): void {
    if (entry >= this.#top + INDEX_ROWS) this.#top = entry - (INDEX_ROWS - 1);
    if (entry < this.#top) this.#top = entry;
    this.#top = clamp(this.#top, 0, this.maxTop);
  }

  #setTop(top: number, syncScrollBar: boolean): void {
    this.#top = clamp(top, 0, this.maxTop);
    if (syncScrollBar) this.#scrollPosition = this.#top;
  }

  /**
   * The edit box's text changed by typing (§1.8): an empty text selects entry 0; otherwise the
   * first entry from the top whose name starts with the text, ignoring case, if any.
   */
  #editChanged(): void {
    const text = this.#edit.text;
    if (text === '') {
      // The list shows entry 0; the scroll bar is not moved and the remembered entry stays.
      this.#selection = 0;
      this.#scrollIntoView(0);
      return;
    }
    if (equalIgnoringCase(text, this.names[this.#selection] ?? '')) return;
    const found = this.names.findIndex((name) => startsWithIgnoringCase(name, text));
    if (found < 0) return;
    this.#selection = found;
    this.#scrollIntoView(found);
    this.#scrollPosition = this.#top;
    this.#remembered = found;
  }

  /** A line or page step of the scroll bar (§1.11): moves the top row only. */
  #scrollStep(part: ScrollPart, time: number): boolean {
    const step = { lineUp: -1, pageUp: -INDEX_ROWS, thumb: 0, pageDown: INDEX_ROWS, lineDown: 1 }[part];
    const before = this.#top;
    this.#scrollTo(this.#top + step, time);
    return this.#top !== before;
  }

  #scrollTo(position: number, time: number): void {
    // Scrolling with the scroll bar while the list has the focus gives the edit box the focus.
    if (this.#focus === 'list') this.#setFocus('edit', time);
    this.#setTop(position, true);
  }

  /** A mouse drag in the list: the row under the pointer, or one row beyond the edge it is past. */
  #dragList(y: number): void {
    const list = INDEX_CONTROLS.list;
    if (y < list.y) this.#select(Math.max(0, this.#top - 1));
    else if (y >= list.y + list.height) this.#select(Math.min(this.count - 1, this.#top + INDEX_ROWS));
    else {
      const row = this.#rowAt(y);
      if (row !== null) this.#select(row);
    }
  }

  #go(close: boolean): IndexCommand | null {
    if (this.#remembered < 0 || this.#remembered >= this.count) return null;
    return { kind: 'go', entry: this.#remembered, close };
  }

  #setFocus(focus: 'edit' | 'list' | null, time: number): void {
    this.#focus = focus;
    this.#blinkFrom = time;
  }

  #rowAt(y: number): number | null {
    const row = Math.floor((y - INDEX_CONTROLS.list.y) / INDEX_ROW_HEIGHT);
    if (row < 0 || row >= INDEX_ROWS) return null;
    const entry = this.#top + row;
    return entry < this.count ? entry : null;
  }

  #editPosition(x: number): number {
    const offsets = textOffsets(SERIF_FONT, this.#edit.text, { bold: true });
    const local = x - INDEX_CONTROLS.edit.x - INDEX_TEXT.editMargin;
    let best = 0;
    for (let i = 1; i < offsets.length; i++) {
      if (Math.abs(offsets[i]! - local) < Math.abs(offsets[best]! - local)) best = i;
    }
    return best;
  }

  #editFits(text: string): boolean {
    return INDEX_TEXT.editMargin + textWidth(SERIF_FONT, text, { bold: true }) <= INDEX_CONTROLS.edit.width;
  }

  #scrollPartAt(y: number): ScrollPart {
    const thumbTop = SCROLL_PART_SIZE + this.#math.thumbOffset(this.#scrollPosition);
    return scrollPartAt(y, SCROLL_PART_SIZE, thumbTop, INDEX_CONTROLS.scrollBar.height - SCROLL_PART_SIZE);
  }

  #pointerInPart(part: ScrollPart): boolean {
    const pointer = this.#pointer;
    if (pointer === null) return false;
    const rect = INDEX_CONTROLS.scrollBar;
    if (pointer.x < rect.x || pointer.x >= rect.x + rect.width) return false;
    const thumbTop = SCROLL_PART_SIZE + this.#math.thumbOffset(this.#scrollPosition);
    const [top, bottom] = scrollPartRows(
      part,
      rect.height,
      SCROLL_PART_SIZE,
      thumbTop,
      rect.height - SCROLL_PART_SIZE,
    );
    const y = pointer.y - rect.y;
    return y >= top && y < bottom;
  }

  #caretVisible(time: number): boolean {
    if (this.#focus !== 'edit') return false;
    return Math.floor(Math.max(0, time - this.#blinkFrom) / CARET_BLINK_MS) % 2 === 0;
  }
}

/** The character a key types, if it is one the edit box takes: a single Windows-1252 character. */
function typedCharacter(key: string): string | null {
  if (key.length !== 1) return null;
  const code = key.charCodeAt(0);
  if (code < 0x20 || code === 0x7f) return null;
  if (code <= 0xff) return code >= 0x80 && code <= 0x9f ? null : key;
  // The few Windows-1252 characters above U+00FF.
  return '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'.includes(key) ? key : null;
}

/** Case folding for one character, as the list box compares names [H: all Windows-1252 letters]. */
function fold(char: string): string {
  const lower = char.toLowerCase();
  return lower.length === 1 ? lower : char;
}

function startsWithIgnoringCase(name: string, prefix: string): boolean {
  if (prefix.length > name.length) return false;
  for (let i = 0; i < prefix.length; i++) if (fold(name[i]!) !== fold(prefix[i]!)) return false;
  return true;
}

/** The program's own comparison folds A–Z only (§1.8 step 3). */
function equalIgnoringCase(a: string, b: string): boolean {
  return (
    a.length === b.length &&
    a.replace(/[A-Z]/g, (c) => c.toLowerCase()) === b.replace(/[A-Z]/g, (c) => c.toLowerCase())
  );
}

/** The word around a caret position, for a double click in the edit box [H]. */
function wordAround(text: string, at: number): [number, number] {
  const isWord = (char: string | undefined): boolean => char !== undefined && char !== ' ';
  let start = at;
  let end = at;
  while (start > 0 && isWord(text[start - 1])) start--;
  while (end < text.length && isWord(text[end])) end++;
  return [start, end];
}

/**
 * The dotted focus rectangle (`DrawFocusRect`): every other pixel of the one-pixel frame inverted
 * (index v becomes 255 − v), aligned to the screen.
 */
function invertDottedFrame(
  canvas: IndexedCanvas,
  x: number,
  y: number,
  width: number,
  height: number,
  screenParity: number,
): void {
  const invert = (index: number, px: number, py: number): number =>
    (px + py + screenParity) % 2 === 0 ? 255 - index : index;
  canvas.map(x, y, width, 1, invert);
  canvas.map(x, y + height - 1, width, 1, invert);
  canvas.map(x, y + 1, 1, height - 2, invert);
  canvas.map(x + width - 1, y + 1, 1, height - 2, invert);
}
