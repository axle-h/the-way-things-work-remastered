/**
 * The engine: what is on screen (a base page and a stack of popup windows), the state operations
 * that change it, and composing it into the indexed framebuffer.
 *
 * Loading is asynchronous (pictures come from a {@link DataSource}); a state operation loads
 * everything the new page draws before it takes effect, so `render` is synchronous and always
 * sees a complete state.
 *
 * Static rendering only (Phase 3): no handlers run and nothing animates. Where the original runs
 * a page's `on_open` handlers and starts autostart animations (rendering.md §8) is marked below.
 */
import type { PageRef } from '@twtw/formats';
import { loadDiscContent, type DiscContent } from './content.ts';
import type { DataSource } from './data/data-source.ts';
import { instantiatePage, type PageInstance } from './page.ts';
import { PictureStore } from './pictures.ts';
import { IndexedCanvas } from './render/canvas.ts';
import { paintPage } from './render/paint.ts';
import {
  captionColours,
  drawWindow,
  PRESENTATIONS,
  windowPosition,
  windowStyle,
  type CaptionColours,
  type PageWindow,
  type Presentation,
  type PresentationName,
} from './render/window.ts';
import { CLIENT_HEIGHT, CLIENT_WIDTH, type Framebuffer } from './screen.ts';

export interface EngineOptions {
  /** How popups are placed and decorated: Windows 3.1 (default) or Wine, for comparisons. */
  readonly presentation?: PresentationName | Presentation;
  /** Page shown first by {@link Engine.load}: the product's startup page by default; `null` for none. */
  readonly startPage?: PageRef | null;
  /** Budget in bytes for decoded pictures kept for reuse. */
  readonly cacheBytes?: number;
}

export class Engine {
  readonly content: DiscContent;
  readonly presentation: Presentation;
  readonly #pictures: PictureStore;
  readonly #captionColours: CaptionColours;
  #base: PageInstance | null = null;
  #windows: PageWindow[] = [];

  /** Loads the database, palette and program resources, then shows the start page. */
  static async load(source: DataSource, options: EngineOptions = {}): Promise<Engine> {
    const engine = new Engine(source, await loadDiscContent(source), options);
    const start =
      options.startPage === undefined ? engine.content.database.product.startupPage : options.startPage;
    if (start !== null) await engine.changePage(start);
    return engine;
  }

  constructor(source: DataSource, content: DiscContent, options: EngineOptions = {}) {
    this.content = content;
    const presentation = options.presentation ?? 'win31';
    this.presentation = typeof presentation === 'string' ? PRESENTATIONS[presentation] : presentation;
    this.#pictures = new PictureStore(source, content.program, options.cacheBytes);
    this.#captionColours = captionColours(this.presentation, content.palette);
  }

  /** The master palette: 256 RGB triplets for converting the framebuffer. */
  get palette(): Uint8Array {
    return this.content.palette;
  }

  /** The base page, filling the main window's client area; `null` before the first page. */
  get basePage(): PageInstance | null {
    return this.#base;
  }

  /** Popup and index windows, bottom first; the last one is active. */
  get windows(): readonly PageWindow[] {
    return this.#windows;
  }

  /** Loads a page and every picture it draws, without showing it. */
  loadPage(ref: PageRef): Promise<PageInstance> {
    return instantiatePage(
      { database: this.content.database, pictures: this.#pictures, palette: this.content.palette },
      ref,
    );
  }

  /**
   * ChangePage (rendering.md §2, §7.7): a base page replaces the base page; a popup or index
   * page replaces the page in the topmost window of the same page type, or opens a window if
   * there is none. A popup window keeps its place when the new page has the same size, and
   * otherwise moves to the new page's origin without the caption-height term.
   *
   * Open popups are left as they are when the base page changes; whether the original closes
   * them is for Phase 4.
   */
  async changePage(ref: PageRef): Promise<PageInstance> {
    const instance = await this.loadPage(ref);
    const type = instance.page.pageType;
    if (type === 'base') {
      this.#base = instance;
    } else if (type === 'popup' || type === 'index') {
      const at = this.#windows.findLastIndex((window) => window.page.page.pageType === type);
      const old = this.#windows[at];
      if (old === undefined) {
        this.#windows.push(this.#newWindow(instance, true));
      } else if (old.page.width === instance.width && old.page.height === instance.height) {
        this.#windows[at] = { ...this.#newWindow(instance, false), x: old.x, y: old.y };
      } else {
        this.#windows[at] = this.#newWindow(instance, false);
      }
    } else {
      throw new Error(`page ${ref}: cannot show a ${type} page`);
    }
    // Phase 4/5: run the page's and panels' open handlers and start autostart animations here.
    return instance;
  }

  /** OpenPage: shows a popup or index page in a new window on top (rendering.md §7). */
  async openPopup(ref: PageRef): Promise<PageInstance> {
    const instance = await this.loadPage(ref);
    const type = instance.page.pageType;
    if (type !== 'popup' && type !== 'index')
      throw new Error(`page ${ref}: a ${type} page cannot open as a popup`);
    this.#windows.push(this.#newWindow(instance, true));
    // Phase 4/5: run on_preopen, the panels' on_open handlers and on_open here (rendering.md §8).
    return instance;
  }

  /**
   * Closes the window showing `ref` (the topmost one if several do), or the topmost window when
   * `ref` is omitted. Returns whether a window closed.
   */
  closePopup(ref?: PageRef): boolean {
    const at =
      ref === undefined
        ? this.#windows.length - 1
        : this.#windows.findLastIndex((window) => window.page.ref === ref);
    if (at < 0) return false;
    this.#windows.splice(at, 1);
    return true;
  }

  /**
   * Composes the current state into the framebuffer: index 0 everywhere, the base page clipped
   * to the 638×459 client area at (0,0), then each window bottom first, clipped to the framebuffer.
   */
  render(framebuffer: Framebuffer): void {
    framebuffer.pixels.fill(0);
    const screen = new IndexedCanvas(framebuffer);
    if (this.#base !== null) paintPage(screen.view(0, 0, CLIENT_WIDTH, CLIENT_HEIGHT), this.#base);
    const top = this.#windows.length - 1;
    this.#windows.forEach((window, i) => {
      drawWindow(screen, window, i === top, this.presentation, this.#captionColours);
    });
  }

  #newWindow(page: PageInstance, opening: boolean): PageWindow {
    const position = windowPosition(this.content.database, page, this.presentation, opening);
    return { page, ...position, ...windowStyle(page.template) };
  }
}
