// Typing into the Index on touch devices (special-screens.md §1.12): a tap on the Index's edit box
// focuses a hidden text field, which brings up the soft keyboard. The field mirrors the edit box,
// and each change of its text goes to the engine as the edit box's new text. A presentation
// addition outside the original; with a hardware keyboard, keys reach the engine as before.
import type { Engine } from '@twtw/engine';

export class SoftKeyboard {
  readonly #input: HTMLInputElement;
  readonly #engine: Engine;
  /** An input method composing a word: the field is not overwritten meanwhile. */
  #composing = false;

  constructor(input: HTMLInputElement, engine: Engine) {
    this.#input = input;
    this.#engine = engine;
    input.addEventListener('input', () => {
      if (!this.#engine.setIndexEditText(input.value, input.selectionStart ?? undefined)) this.#mirror();
    });
    input.addEventListener('compositionstart', () => (this.#composing = true));
    input.addEventListener('compositionend', () => {
      this.#composing = false;
      this.#mirror();
    });
    input.addEventListener('blur', () => (this.#composing = false));
  }

  get shown(): boolean {
    return document.activeElement === this.#input;
  }

  /**
   * After a touch or pen release on the stage (inside its event handler, where browsers allow a
   * field to take the focus and show the keyboard): shows the keyboard if the Index's edit box
   * has the focus now, and hides it otherwise.
   */
  afterTap(): void {
    if (this.#engine.indexEditFocused) {
      this.#mirror();
      this.#input.focus({ preventScroll: true });
    } else {
      this.hide();
    }
  }

  hide(): void {
    if (this.shown) this.#input.blur();
  }

  /** Each frame: keeps the field in step with the edit box, and hides it once typing goes elsewhere. */
  update(): void {
    if (!this.shown) return;
    if (!this.#engine.indexEditFocused) this.hide();
    else if (!this.#composing) this.#mirror();
  }

  /** Copies the edit box's text and selection into the field. */
  #mirror(): void {
    const screen = this.#engine.indexScreen;
    if (screen === null) return;
    const input = this.#input;
    const [start, end] = screen.editSelection;
    if (input.value !== screen.editText) input.value = screen.editText;
    if (input.selectionStart !== start || input.selectionEnd !== end) {
      try {
        input.setSelectionRange(start, end);
      } catch {
        // Not focused in some browsers: the selection follows on the next frame.
      }
    }
  }
}
