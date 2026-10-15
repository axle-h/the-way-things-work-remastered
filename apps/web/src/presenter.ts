// The canvas presenter (docs/PLAN.md §3, "Scaling rules"): the canvas covers the viewport, its
// backing store is sized in device pixels, and the framebuffer's presented area is drawn into it
// with nearest neighbour at the scale stage.ts chooses. The browser never resamples: the backing
// store matches the canvas's device-pixel box one to one.
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '@twtw/engine';
import { indexedToRgba } from './rgba.ts';
import {
  clientToFramebuffer,
  computeLayout,
  type ScaleMode,
  type StageLayout,
  type StagePoint,
} from './stage.ts';

export class Presenter {
  readonly canvas: HTMLCanvasElement;
  readonly #context: CanvasRenderingContext2D;
  /** The framebuffer as RGBA at 1×, drawn scaled onto the canvas. */
  readonly #frame: HTMLCanvasElement;
  readonly #frameContext: CanvasRenderingContext2D;
  readonly #image: ImageData;
  #mode: ScaleMode;
  #layout: StageLayout;
  #listeners = new Set<(layout: StageLayout) => void>();

  constructor(canvas: HTMLCanvasElement, mode: ScaleMode = 'integer') {
    this.canvas = canvas;
    this.#mode = mode;
    this.#context = context2d(canvas);
    this.#frame = document.createElement('canvas');
    this.#frame.width = SCREEN_WIDTH;
    this.#frame.height = SCREEN_HEIGHT;
    this.#frameContext = context2d(this.#frame);
    this.#image = this.#frameContext.createImageData(SCREEN_WIDTH, SCREEN_HEIGHT);
    this.#layout = computeLayout(canvas.width, canvas.height, mode);
    this.#observe();
  }

  get layout(): StageLayout {
    return this.#layout;
  }

  get mode(): ScaleMode {
    return this.#mode;
  }

  /** Called after every change of layout (resize, device pixel ratio, mode). */
  onLayout(listener: (layout: StageLayout) => void): void {
    this.#listeners.add(listener);
  }

  setMode(mode: ScaleMode): void {
    if (mode === this.#mode) return;
    this.#mode = mode;
    this.#resize(this.canvas.width, this.canvas.height, true);
  }

  /** Shows a framebuffer: palette indices through the palette to RGBA, then scaled. */
  present(pixels: Uint8Array, palette: Uint8Array): void {
    indexedToRgba(pixels, palette, this.#image.data);
    this.#frameContext.putImageData(this.#image, 0, 0);
    this.#draw();
  }

  /** The framebuffer position under a client position (the one place, stage.ts). */
  toFramebuffer(clientX: number, clientY: number): StagePoint {
    return clientToFramebuffer(this.#layout, this.canvas.getBoundingClientRect(), clientX, clientY);
  }

  #draw(): void {
    const { area, offsetX, offsetY, width, height } = this.#layout;
    this.#context.drawImage(
      this.#frame,
      area.x,
      area.y,
      area.width,
      area.height,
      offsetX,
      offsetY,
      width,
      height,
    );
  }

  /** Sizes the backing store to the canvas's box in device pixels, now and whenever it changes. */
  #observe(): void {
    const fromBox = (): void => {
      const ratio = window.devicePixelRatio || 1;
      this.#resize(
        Math.round(this.canvas.clientWidth * ratio),
        Math.round(this.canvas.clientHeight * ratio),
        false,
      );
    };
    fromBox();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', fromBox);
      return;
    }
    let exact = false;
    const observer = new ResizeObserver((entries) => {
      const entry = entries.at(-1);
      if (entry === undefined) return;
      const size = entry.devicePixelContentBoxSize?.[0];
      const ratio = window.devicePixelRatio || 1;
      const { width, height } = entry.contentRect;
      // The exact device-pixel size of the box: no rounding guesswork. It agrees with the CSS size
      // × devicePixelRatio to a pixel or so, except under Chromium's emulated device pixel ratio
      // (DevTools, Playwright), which it ignores; the emulated ratio is what is drawn then.
      if (
        size !== undefined &&
        Math.abs(size.inlineSize - width * ratio) <= 2 &&
        Math.abs(size.blockSize - height * ratio) <= 2
      ) {
        exact = true;
        this.#resize(size.inlineSize, size.blockSize, false);
      } else {
        exact = false;
        fromBox();
      }
    });
    try {
      observer.observe(this.canvas, { box: 'device-pixel-content-box' });
    } catch {
      // Safari: no device-pixel box; the content box and devicePixelRatio stand in.
      observer.observe(this.canvas);
    }
    // A change of device pixel ratio alone (browser zoom, another monitor) may not resize the box.
    window.addEventListener('resize', () => {
      if (!exact) fromBox();
    });
  }

  #resize(width: number, height: number, force: boolean): void {
    const backingWidth = Math.max(1, width);
    const backingHeight = Math.max(1, height);
    const changed = backingWidth !== this.canvas.width || backingHeight !== this.canvas.height;
    if (!changed && !force) return;
    if (changed) {
      // Setting the size clears the canvas and resets the context's state, smoothing included.
      this.canvas.width = backingWidth;
      this.canvas.height = backingHeight;
    }
    this.#layout = computeLayout(backingWidth, backingHeight, this.#mode);
    const context = this.#context;
    context.imageSmoothingEnabled = false;
    context.fillStyle = getComputedStyle(this.canvas).backgroundColor || '#000';
    context.fillRect(0, 0, backingWidth, backingHeight);
    this.#draw();
    const { dataset } = this.canvas;
    dataset['scale'] = String(this.#layout.scale);
    dataset['fit'] = this.#layout.fit;
    dataset['layout'] = [
      this.#layout.offsetX,
      this.#layout.offsetY,
      this.#layout.width,
      this.#layout.height,
    ].join(' ');
    for (const listener of this.#listeners) listener(this.#layout);
  }
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d', { alpha: false });
  if (context === null) throw new Error('no 2D canvas context');
  context.imageSmoothingEnabled = false;
  return context;
}
