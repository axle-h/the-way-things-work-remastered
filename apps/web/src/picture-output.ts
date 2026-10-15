// Copy and Print of a page's captioned picture (docs/PLAN.md Phase 8; special-screens.md §4).
// Copy puts a PNG on the clipboard, or shows the picture to copy or save by hand where the
// clipboard is unavailable. Print fills a print-only element and opens the browser's print dialog.
// Sizes and layout are in `print-layout.ts`; the PNG encoder in `png.ts`.
import type { IndexedImage } from '@twtw/engine';
import { canEncodePng, encodeIndexedPng, upscaleIndexed } from './png.ts';
import { COPY_SCALE, previewScale, PRINT_SCALE, printLayout } from './print-layout.ts';
import { indexedToRgba } from './rgba.ts';

export interface PictureOutputElements {
  /** The fallback when the clipboard cannot be written: the picture, Save and Close. */
  readonly overlay: HTMLElement;
  readonly overlayImage: HTMLImageElement;
  readonly save: HTMLAnchorElement;
  readonly close: HTMLButtonElement;
  /** A short message ("Picture copied"). */
  readonly toast: HTMLElement;
  /** The print-only element and its picture; `pageStyle` holds the `@page` rule. */
  readonly print: HTMLElement;
  readonly printImage: HTMLImageElement;
  readonly pageStyle: HTMLStyleElement;
}

/** Finds the elements in index.html. */
export function findPictureOutput(root: ParentNode = document): PictureOutputElements {
  const get = <T extends Element>(selector: string): T => {
    const element = root.querySelector<T>(selector);
    if (element === null) throw new Error(`index.html is missing ${selector}`);
    return element;
  };
  return {
    overlay: get('#picture-overlay'),
    overlayImage: get('#picture-overlay-image'),
    save: get('#picture-save'),
    close: get('#picture-close'),
    toast: get('#toast'),
    print: get('#print'),
    printImage: get('#print-picture'),
    pageStyle: get('#print-page'),
  };
}

export type CopyResult = 'copied' | 'shown';

export interface PictureOutputOptions {
  /**
   * Puts a PNG on the clipboard in place of `navigator.clipboard` (the desktop app's system
   * clipboard, `host.ts`). It rejects if it cannot; the picture is then shown instead.
   */
  readonly writeClipboardPng?: ((png: Uint8Array) => Promise<void>) | undefined;
}

export class PictureOutput {
  readonly #elements: PictureOutputElements;
  readonly #writeClipboardPng: ((png: Uint8Array) => Promise<void>) | undefined;
  #overlayUrl: string | null = null;
  #printUrl: string | null = null;
  #toastTimer: ReturnType<typeof setTimeout> | undefined;
  /** Set while our own print is being prepared or shown, so `beforeprint` leaves it alone. */
  #printing = false;

  constructor(elements: PictureOutputElements, options: PictureOutputOptions = {}) {
    this.#elements = elements;
    this.#writeClipboardPng = options.writeClipboardPng;
    elements.close.addEventListener('click', () => this.closeOverlay());
    elements.overlay.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.closeOverlay();
    });
    window.addEventListener('afterprint', () => {
      this.#printing = false;
    });
  }

  /** Whether the fallback picture is showing (keys go to it then, not to the engine). */
  get overlayOpen(): boolean {
    return !this.#elements.overlay.hidden;
  }

  /** Whether {@link print} is under way (its picture is ready or being made). */
  get printing(): boolean {
    return this.#printing;
  }

  /**
   * Copies the captioned picture at {@link COPY_SCALE} as a PNG. Call it from the user's gesture:
   * the clipboard is written at once, with the PNG to follow. Where the clipboard is missing or
   * refuses, shows the picture instead, to copy with a long press or right click, or to save. The
   * host's clipboard writer, when given, is used instead of the browser's.
   */
  async copy(image: IndexedImage, palette: Uint8Array, name: string): Promise<CopyResult> {
    const png = pngBlob(upscaleIndexed(image, COPY_SCALE), palette);
    if (this.#writeClipboardPng !== undefined) {
      try {
        await this.#writeClipboardPng(new Uint8Array(await (await png).arrayBuffer()));
        this.#toast('Picture copied');
        return 'copied';
      } catch (error) {
        console.warn('copy: the clipboard refused the picture', error);
      }
    } else if (clipboardTakesPng()) {
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
        this.#toast('Picture copied');
        return 'copied';
      } catch (error) {
        console.warn('copy: the clipboard refused the picture', error);
      }
    }
    this.#showOverlay(await png, name, image);
    return 'shown';
  }

  /** Prints the captioned picture through the browser's print dialog. */
  async print(image: IndexedImage, palette: Uint8Array): Promise<void> {
    this.#printing = true;
    try {
      const blob = await pngBlob(upscaleIndexed(image, PRINT_SCALE), palette);
      if (this.#printUrl !== null) URL.revokeObjectURL(this.#printUrl);
      this.#printUrl = URL.createObjectURL(blob);
      this.#layOut(image, this.#printUrl);
      await this.#elements.printImage.decode();
    } catch (error) {
      this.#printing = false;
      throw error;
    }
    window.print();
  }

  /**
   * For a print started from the browser (its menu, or a shortcut we did not catch): fills the
   * print element at once, as `beforeprint` allows no waiting. Best effort: the browser may lay
   * out the page before the picture has decoded.
   */
  prepareForBrowserPrint(image: IndexedImage, palette: Uint8Array): void {
    if (this.#printing) return;
    const canvas = rgbaCanvas(upscaleIndexed(image, PRINT_SCALE), palette);
    if (canvas !== null) this.#layOut(image, canvas.toDataURL('image/png'));
  }

  closeOverlay(): void {
    const { overlay, overlayImage, save } = this.#elements;
    overlay.hidden = true;
    overlayImage.removeAttribute('src');
    save.removeAttribute('href');
    if (this.#overlayUrl !== null) URL.revokeObjectURL(this.#overlayUrl);
    this.#overlayUrl = null;
  }

  #layOut(image: IndexedImage, src: string): void {
    const { print, printImage, pageStyle } = this.#elements;
    const layout = printLayout(image.width, image.height);
    pageStyle.textContent = layout.pageRule;
    print.dataset['placement'] = layout.placement;
    print.dataset['orientation'] = layout.orientation;
    printImage.style.width = layout.imageWidth;
    printImage.src = src;
  }

  /** Shows the picture (`image` at its own size) at a whole scale of it, in device pixels. */
  #showOverlay(blob: Blob, name: string, image: IndexedImage): void {
    this.closeOverlay();
    const { overlay, overlayImage, save, close } = this.#elements;
    this.#overlayUrl = URL.createObjectURL(blob);
    overlayImage.src = this.#overlayUrl;
    save.href = this.#overlayUrl;
    save.download = name;
    overlay.hidden = false;
    const ratio = window.devicePixelRatio || 1;
    const scale = previewScale(
      image.width,
      image.height,
      overlay.clientWidth * ratio - OVERLAY_GUTTER,
      (overlay.clientHeight - OVERLAY_CONTROLS_HEIGHT) * ratio - OVERLAY_GUTTER,
    );
    overlayImage.style.width = `${(image.width * scale) / ratio}px`;
    close.focus();
  }

  #toast(message: string): void {
    const { toast } = this.#elements;
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(this.#toastTimer);
    this.#toastTimer = setTimeout(() => {
      toast.hidden = true;
    }, TOAST_MS);
  }
}

const TOAST_MS = 1800;
/** Room for the overlay's text and buttons (CSS pixels), and its side gutters (device pixels). */
const OVERLAY_CONTROLS_HEIGHT = 110;
const OVERLAY_GUTTER = 24;

/** Whether `navigator.clipboard.write` exists and takes PNG (it needs a secure context). */
function clipboardTakesPng(): boolean {
  if (typeof ClipboardItem !== 'function' || typeof navigator.clipboard?.write !== 'function') return false;
  const supports = (ClipboardItem as { supports?: (type: string) => boolean }).supports;
  return supports === undefined || supports.call(ClipboardItem, 'image/png');
}

/** The picture as a PNG: our palette encoder, or the canvas's where `CompressionStream` is missing. */
async function pngBlob(image: IndexedImage, palette: Uint8Array): Promise<Blob> {
  if (canEncodePng()) return new Blob([await encodeIndexedPng(image, palette)], { type: 'image/png' });
  const canvas = rgbaCanvas(image, palette);
  if (canvas === null) throw new Error('no canvas to encode the picture');
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob === null ? reject(new Error('PNG encoding failed')) : resolve(blob)),
      'image/png',
    ),
  );
}

function rgbaCanvas(image: IndexedImage, palette: Uint8Array): HTMLCanvasElement | null {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d');
  if (context === null) return null;
  const data = context.createImageData(image.width, image.height);
  indexedToRgba(image.pixels, palette, data.data);
  context.putImageData(data, 0, 0);
  return canvas;
}
