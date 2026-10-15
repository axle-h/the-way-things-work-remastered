/**
 * The engine: what is on screen (a base page and a stack of popup windows), input (pointer and
 * keyboard), event dispatch and page actions, and composing it all into the indexed framebuffer.
 *
 * Behaviour follows docs/formats/behaviour.md; drawing follows rendering.md. Sound and animation
 * go through a {@link Media} (Phase 5); time-based effects through a {@link Clock}.
 *
 * Loading is asynchronous (pictures come from a {@link DataSource}). Input and page actions run as
 * one task at a time; while a task runs the engine is **busy** (the original's hourglass) and
 * ignores pointer input, as the original does (behaviour.md, "Busy"). `render` is synchronous and
 * always sees a complete state.
 */
import {
  HandlerEvent,
  resolveMedia,
  type Action,
  type AzDialPanel,
  type Handler,
  type NavPanel,
  type PageRef,
  type Point,
} from '@twtw/formats';
import { canAdvance, VirtualClock, type Clock } from './clock.ts';
import { loadDiscContent, type DiscContent } from './content.ts';
import type { DataSource } from './data/data-source.ts';
import { History } from './history.ts';
import { cursorForName, type CursorName } from './input/cursor.ts';
import { classifyWindowPoint, objectAt, panelAt, rectContains, type WindowArea } from './input/hit-test.ts';
import {
  DIAL_SOUND,
  SilentMedia,
  type AnimationReason,
  type Media,
  type MediaAction,
  type MediaTarget,
} from './media.ts';
import {
  DIAL_POSITIONS,
  instantiatePage,
  type PageInstance,
  type PanelInstance,
  type PlacedObject,
} from './page.ts';
import { PictureStore } from './pictures.ts';
import { IndexedCanvas, intersect, type Box } from './render/canvas.ts';
import { invertFocusRect } from './render/focus-rect.ts';
import { paintPage } from './render/paint.ts';
import {
  captionColours,
  drawWindow,
  PRESENTATIONS,
  windowPosition,
  windowSize,
  windowStyle,
  type CaptionColours,
  type PageWindow,
  type Presentation,
  type PresentationName,
} from './render/window.ts';
import { CLIENT_HEIGHT, CLIENT_WIDTH, type Framebuffer } from './screen.ts';
import {
  invertOutline,
  visibleZoomRectangles,
  ZOOM_CLOSE_PERCENTAGES,
  ZOOM_DURATION_MS,
  ZOOM_OPEN_PERCENTAGES,
  zoomRectangles,
} from './zoom.ts';

export interface EngineOptions {
  /** How popups are placed and decorated: Windows 3.1 (default) or Wine, for comparisons. */
  readonly presentation?: PresentationName | Presentation;
  /** Page shown first by {@link Engine.load}: the product's startup page by default; `null` for none. */
  readonly startPage?: PageRef | null;
  /** Budget in bytes for decoded pictures kept for reuse. */
  readonly cacheBytes?: number;
  /** Time for the zoom effect and the A–Z lamp; a {@link VirtualClock} by default. */
  readonly clock?: Clock;
  /** Sound and animation; {@link SilentMedia} (nothing plays, animations end at once) by default. */
  readonly media?: Media;
}

/** Things the engine reports to its presenter. */
export type EngineEvent =
  /**
   * ProductOption (behaviour.md §4.6): 1 copy, 2 print, 3 print setup (Phase 8). `page` is the
   * page recorded when the Options button was pressed, if it is still open.
   */
  | { readonly kind: 'productOption'; readonly option: number; readonly page: PageInstance | null }
  /** Alt+F4 with the main window focused: the original closes at once (program.md). */
  | { readonly kind: 'quit' }
  /** A page action that could not run, e.g. a ChangePage with no window to change (behaviour.md §4.3). */
  | { readonly kind: 'actionFailed'; readonly action: Action; readonly reason: string }
  | { readonly kind: 'error'; readonly error: unknown };

/** What lies under a point of the stage. */
export interface Hit {
  /** The popup window, or `null` for the main window. */
  readonly window: PageWindow | null;
  readonly area: WindowArea;
  readonly page: PageInstance;
  /** The panel under the point (client area only), first in panel-list order. */
  readonly panel: PanelInstance | null;
  /** The point in the panel's coordinates. */
  readonly panelX: number;
  readonly panelY: number;
  /** The topmost object under the point, and its index in the panel's object list (−1 for none). */
  readonly object: PlacedObject | null;
  readonly objectIndex: number;
}

/** A key press, in DOM `KeyboardEvent.key` terms (`'F4'`, `'a'`, `'Escape'`). */
export interface KeyInput {
  readonly key: string;
  readonly altKey?: boolean;
}

export interface PointerDownOptions {
  /**
   * The press is the second press of a double click (a presenter decides, e.g. with
   * `DoubleClickDetector`): the original ignores it and the release that follows (behaviour.md §1.7).
   */
  readonly doubleClick?: boolean;
}

/** A popup or index window; the engine's mutable record behind {@link PageWindow}. */
class Popup implements PageWindow {
  page: PageInstance;
  x: number;
  y: number;
  readonly caption: number;
  readonly shadow: number;
  readonly owner: Popup | null;
  readonly focusable: boolean;
  /** The page that was active when it opened, which gets the focus back when it closes (§4.4). */
  readonly opener: Popup | null;
  /** Start point (screen) of the opening zoom, for the closing zoom; `null` if it opened without. */
  zoomFrom: Point | null = null;

  constructor(
    page: PageInstance,
    position: Point,
    style: { caption: number; shadow: number; focusable: boolean },
    owner: Popup | null,
  ) {
    this.page = page;
    this.x = position.x;
    this.y = position.y;
    this.caption = style.caption;
    this.shadow = style.shadow;
    this.focusable = style.focusable;
    this.owner = owner;
    this.opener = owner;
  }
}

/** An object that holds the mouse capture, or receives a click. */
interface ObjectTarget extends MediaTarget {
  readonly window: Popup | null;
  readonly object: PlacedObject;
}

type Press =
  /** An object holds the capture (behaviour.md §1.4). */
  | { readonly kind: 'object'; readonly target: ObjectTarget }
  /** A popup's system box or shadow was pressed: a release there closes it (§5). */
  | { readonly kind: 'close'; readonly window: Popup }
  /** A popup's caption was pressed: the dotted rectangle follows the mouse (§5). */
  | { readonly kind: 'drag'; readonly window: Popup; readonly from: Point; to: Point };

interface QueuedAction {
  readonly action: Extract<Action, { kind: 'openPage' | 'changePage' | 'closePage' }>;
}

export class Engine {
  readonly content: DiscContent;
  readonly presentation: Presentation;
  readonly clock: Clock;
  readonly media: Media;
  readonly #pictures: PictureStore;
  readonly #captionColours: CaptionColours;
  readonly #history = new History();
  readonly #listeners = new Set<(event: EngineEvent) => void>();

  #base: PageInstance | null = null;
  /** Popup and index windows in stacking order, bottom first. */
  #popups: Popup[] = [];
  /** The page that last received a press, or opened or changed; `null` is the main window. */
  #active: Popup | null = null;
  /** The window with the keyboard focus, whose caption is drawn active; `null` is the main window. */
  #focus: Popup | null = null;
  #appActive = true;

  #queue: QueuedAction[] = [];
  #busy = false;
  #task: Promise<void> | null = null;
  /** Cancels the wait for a navigation button's animation (when the app is deactivated). */
  #cancelNavWait: (() => void) | null = null;
  /** The running task waits for an animation to end (a navigation button). */
  #waitingForMedia = false;
  /** Told when the running task starts waiting for an animation. */
  #onMediaWait: (() => void) | null = null;

  #press: Press | null = null;
  #ignoreRelease = false;
  /** The CancelButton holding the capture shows its pressed picture (pointer inside it). */
  #buttonPressed = false;
  #pointer: Point | null = null;
  /** The last press, in the receiving window's client coordinates (zoom start, §4.2). */
  #lastPress: { readonly window: Popup | null; readonly x: number; readonly y: number } | null = null;
  #cursor: CursorName = 'arrow';

  #zoom: { readonly start: number; readonly rects: readonly Box[]; visible: readonly number[] } | null = null;
  /** When the current base page opened: the A–Z lamp ticks from here. */
  #dialSince = 0;
  #dialGoTick = 0;
  /** The page copy and print act on, recorded by the Options button (§6.2). */
  #optionsTarget: { readonly window: Popup | null; readonly page: PageInstance } | null = null;
  #dirty = true;

  /** Loads the database, palette and program resources, then shows the start page. */
  static async load(source: DataSource, options: EngineOptions = {}): Promise<Engine> {
    const engine = new Engine(source, await loadDiscContent(source), options);
    const start =
      options.startPage === undefined ? engine.content.database.product.startupPage : options.startPage;
    if (start !== null) await engine.reset(start);
    return engine;
  }

  constructor(source: DataSource, content: DiscContent, options: EngineOptions = {}) {
    this.content = content;
    const presentation = options.presentation ?? 'win31';
    this.presentation = typeof presentation === 'string' ? PRESENTATIONS[presentation] : presentation;
    this.clock = options.clock ?? new VirtualClock();
    this.media = options.media ?? new SilentMedia();
    this.#pictures = new PictureStore(source, content.program, options.cacheBytes);
    this.#captionColours = captionColours(this.presentation, content.palette);
  }

  // -------------------------------------------------------------------------------------------
  // State

  /** The master palette: 256 RGB triplets for converting the framebuffer. */
  get palette(): Uint8Array {
    return this.content.palette;
  }

  /** The base page, filling the main window's client area; `null` before the first page. */
  get basePage(): PageInstance | null {
    return this.#base;
  }

  /** Popup and index windows in stacking order, bottom first. */
  get windows(): readonly PageWindow[] {
    return this.#popups;
  }

  /** The active page's window (behaviour.md, "Active page"); `null` for the main window. */
  get activeWindow(): PageWindow | null {
    return this.#active;
  }

  /** The window with the keyboard focus; `null` for the main window. */
  get focusWindow(): PageWindow | null {
    return this.#focus;
  }

  /** The history of base pages, oldest first (behaviour.md §6.3). */
  get history(): readonly PageRef[] {
    return this.#history.entries;
  }

  /** Whether the engine is handling input or running page actions; input is ignored meanwhile. */
  get busy(): boolean {
    return this.#busy;
  }

  /** Whether a zoom effect is on screen. */
  get zooming(): boolean {
    return this.#zoom !== null;
  }

  /**
   * The cursor for the last pointer position (behaviour.md §8): the hourglass while busy;
   * otherwise from the object under the pointer (or holding the capture).
   */
  get cursor(): CursorName {
    if (this.#busy) return 'wait';
    const cursor = this.#cursorAtPointer();
    if (cursor !== null) this.#cursor = cursor;
    return this.#cursor;
  }

  /** Subscribes to engine events; returns the unsubscribe function. */
  on(listener: (event: EngineEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Resolves once no input or page action is being handled. */
  async idle(): Promise<void> {
    while (this.#task !== null) await this.#task;
  }

  /** Loads a page and every picture it draws, without showing it. */
  loadPage(ref: PageRef): Promise<PageInstance> {
    return instantiatePage(
      { database: this.content.database, pictures: this.#pictures, palette: this.content.palette },
      ref,
    );
  }

  // -------------------------------------------------------------------------------------------
  // Page operations (for presenters and tools; the data's actions use the same code)

  /**
   * A direct start at a base page, as the original's startup page or the capture harness's
   * patched start: every window closes without effects, the history is emptied and the page is
   * not recorded in it (behaviour.md §6.3). Its open handlers run and its autostart animations
   * start. Throws if the page is not a base page.
   */
  async reset(ref: PageRef): Promise<void> {
    await this.idle();
    const instance = await this.loadPage(ref);
    if (instance.page.pageType !== 'base')
      throw new Error(`page ${ref}: a ${instance.page.pageType} page cannot start`);
    await this.#perform(async () => {
      this.media.stopAll();
      this.media.pageOpened?.(instance);
      for (const popup of this.#popups) this.media.pageClosed(popup.page);
      if (this.#base !== null) this.media.pageClosed(this.#base);
      this.#popups = [];
      this.#base = instance;
      this.#active = null;
      this.#focus = null;
      this.#history.clear();
      this.#queue = [];
      this.#press = null;
      this.#ignoreRelease = false;
      this.#buttonPressed = false;
      this.#lastPress = null;
      this.#zoom = null;
      this.#optionsTarget = null;
      this.#dialSince = this.clock.now();
      this.#dirty = true;
      this.#pageOpened(instance, null, false);
    });
  }

  /** ChangePage (behaviour.md §4.3), then any page actions it causes. Returns whether it succeeded. */
  changePage(ref: PageRef): Promise<boolean> {
    return this.#perform(() => this.#changePage(ref));
  }

  /** OpenPage (behaviour.md §4.1), optionally with the zoom effect. Returns whether it succeeded. */
  openPage(ref: PageRef, zoom = false): Promise<boolean> {
    return this.#perform(() => this.#openPage(ref, zoom));
  }

  /** ClosePage (behaviour.md §4.4). Returns whether a window closed. */
  closePage(ref: PageRef): Promise<boolean> {
    return this.#perform(() => this.#closePage(ref));
  }

  // -------------------------------------------------------------------------------------------
  // Input

  /** What lies under (x, y), in page (framebuffer) coordinates: topmost popup first, then the main window. */
  hitTest(x: number, y: number): Hit | null {
    const window = this.#windowAt(x, y);
    if (window === undefined) return null;
    const page = window === null ? this.#base! : window.page;
    let contentX = x;
    let contentY = y;
    if (window !== null) {
      const area = classifyWindowPoint(window, x - window.x, y - window.y);
      if (area !== 'client') {
        return { window, area, page, panel: null, panelX: 0, panelY: 0, object: null, objectIndex: -1 };
      }
      contentX = x - window.x;
      contentY = y - window.y - window.caption;
    }
    const panel = panelAt(page, contentX, contentY);
    if (panel === null) {
      return { window, area: 'client', page, panel, panelX: 0, panelY: 0, object: null, objectIndex: -1 };
    }
    const panelX = contentX - panel.x;
    const panelY = contentY - panel.y;
    const objectIndex = objectAt(panel, panelX, panelY);
    const object = panel.objects[objectIndex] ?? null;
    return { window, area: 'client', page, panel, panelX, panelY, object, objectIndex };
  }

  /** A mouse button press, touch or pen contact at (x, y) in page coordinates (behaviour.md §1.4, §5). */
  pointerDown(x: number, y: number, options: PointerDownOptions = {}): Promise<void> {
    this.#pointer = { x, y };
    return this.#run(() => this.#handlePress(x, y, options.doubleClick === true));
  }

  /** Pointer movement: cursor, caption drag, the pressed CancelButton (behaviour.md §1.8). */
  pointerMove(x: number, y: number): void {
    this.#pointer = { x, y };
    if (this.#busy) return;
    const press = this.#press;
    if (press?.kind === 'drag') {
      press.to = { x, y };
      this.#dirty = true;
    } else if (press?.kind === 'object' && press.target.object.object.kind === 'cancelButton') {
      const point = this.#panelPoint(press.target, x, y);
      const rect = press.target.object.rect;
      const inside = rect !== null && rectContains(rect, point.x, point.y);
      if (inside !== this.#buttonPressed) {
        this.#buttonPressed = inside;
        this.#dirty = true;
      }
    }
  }

  /** The release that completes a click (behaviour.md §1.5, §1.6, §5). Resolves when its page actions are done. */
  pointerUp(x: number, y: number): Promise<void> {
    this.#pointer = { x, y };
    return this.#run(() => this.#handleRelease(x, y));
  }

  /** The pointer was cancelled (e.g. a touch taken over by the system): forget the press, click nothing. */
  pointerCancel(): void {
    this.#press = null;
    this.#ignoreRelease = false;
    if (this.#buttonPressed) this.#dirty = true;
    this.#buttonPressed = false;
  }

  /** The pointer left the stage: no cursor position. */
  pointerLeave(): void {
    this.#pointer = null;
  }

  /**
   * A key press (behaviour.md §9). Ordinary pages ignore every key; Alt+F4 closes the focused
   * popup, or asks to quit from the main window. Returns whether the key was used.
   */
  key(input: KeyInput): boolean {
    if (input.altKey === true && input.key === 'F4') {
      const focus = this.#focus;
      if (focus !== null) void this.#run(async () => void (await this.#closeWindow(focus)));
      else this.#emit({ kind: 'quit' });
      return true;
    }
    // F1–F24 and characters go to the focused page, whose panels ignore them. The Index page's
    // own keyboard handling is Phase 6.
    return false;
  }

  /**
   * The application gained or lost activation (behaviour.md §10): losing it stops all media and
   * shows the focus popup's caption inactive.
   */
  setActive(active: boolean): void {
    if (!active) {
      this.media.stopAll();
      this.#cancelNavWait?.();
    }
    if (this.#appActive !== active) this.#dirty = true;
    this.#appActive = active;
  }

  // -------------------------------------------------------------------------------------------
  // Time and drawing

  /**
   * Advances time-based state (sound and animation playback, the A–Z lamp, the zoom outlines) to
   * the clocks' time. Returns whether the picture changed since the last call, i.e. whether to
   * render again.
   */
  update(): boolean {
    if (this.media.update?.() === true) this.#dirty = true;
    const now = this.clock.now();
    for (const panel of this.#base?.panels ?? []) {
      const dial = panel.dial;
      if (dial === null) continue;
      const ticks = Math.floor((now - this.#dialSince) / 1000);
      const lampOn = ticks % 2 === 1;
      if (dial.lampOn !== lampOn) {
        dial.lampOn = lampOn;
        // The lamp draws over whatever an animation left there.
        const lamp = (lampOn ? dial.lampOnPicture : dial.lampOffPicture) ?? dial.lampOnPicture;
        clearPicture(panel, DIAL_POSITIONS.lamp, lamp);
        this.#dirty = true;
      }
      const lampOverGo = dial.goPressed && ticks > this.#dialGoTick;
      if (dial.lampOverGo !== lampOverGo) {
        dial.lampOverGo = lampOverGo;
        this.#dirty = true;
      }
    }
    const zoom = this.#zoom;
    if (zoom !== null) {
      const visible = visibleZoomRectangles(now - zoom.start);
      if (visible.join() !== zoom.visible.join()) {
        zoom.visible = visible;
        this.#dirty = true;
      }
    }
    const dirty = this.#dirty;
    this.#dirty = false;
    return dirty;
  }

  /**
   * Runs time on until everything has played out and no input or page action is pending: the
   * true settled state, e.g. the title animation moving on to the still title (playback.md §6). Needs a
   * clock that can be moved on (`VirtualClock`, the default, or a test's `ManualClock`) and media
   * timed by it (`PlaybackMedia` on a `ClockAudioSink` of the same clock). Returns `false` if
   * `limitMs` of clock time pass first. Pages that never settle (the A–Z lamp) are fine: only
   * playback and pending work count.
   */
  async settle(limitMs = 3_600_000): Promise<boolean> {
    const clock = this.clock;
    if (!canAdvance(clock)) throw new Error('settle needs a clock that can be advanced');
    const until = clock.now() + limitMs;
    for (;;) {
      this.update();
      const loading = this.media.loading?.() ?? null;
      if (loading !== null) {
        await loading;
        continue;
      }
      const task = this.#task;
      if (task !== null && (clock instanceof VirtualClock || !this.#waitingForMedia)) {
        // A virtual clock is moved on by the task itself while it waits for an animation.
        await Promise.race([task, new Promise<void>((resolve) => (this.#onMediaWait = resolve))]);
        this.#onMediaWait = null;
        if (!(clock instanceof VirtualClock) || !this.#waitingForMedia) continue;
        await task;
        continue;
      }
      const delay = this.media.nextEventDelay?.() ?? null;
      if (delay === null) {
        if (this.#task === null) return true;
        await this.#task;
        continue;
      }
      const step = stepMs(delay);
      if (clock.now() + step > until) {
        clock.advance(Math.max(0, until - clock.now()));
        this.update();
        return false;
      }
      clock.advance(step);
    }
  }

  /**
   * Composes the current state into the framebuffer: index 0 everywhere, the base page clipped
   * to the 638×459 client area at (0,0), then each window bottom first, clipped to the
   * framebuffer; then the drag rectangle and the zoom outlines over everything.
   */
  render(framebuffer: Framebuffer): void {
    framebuffer.pixels.fill(0);
    const screen = new IndexedCanvas(framebuffer);
    const client = screen.view(0, 0, CLIENT_WIDTH, CLIENT_HEIGHT);
    if (this.#base !== null) paintPage(client, this.#base);
    this.#drawPressedButton(client, null);
    for (const window of this.#popups) {
      const focused = this.#appActive && window === this.#focus;
      drawWindow(screen, window, focused, this.presentation, this.#captionColours);
      const { width, height } = windowSize(window);
      this.#drawPressedButton(
        screen
          .view(window.x, window.y, width, height)
          .view(0, window.caption, window.page.width, window.page.height),
        window,
      );
    }
    const origin = this.presentation.clientScreenOrigin;
    const press = this.#press;
    if (press?.kind === 'drag') {
      const { window, from, to } = press;
      invertFocusRect(
        framebuffer,
        window.x + to.x - from.x,
        window.y + to.y - from.y,
        window.page.width,
        window.caption + window.page.height,
        origin,
      );
    }
    if (this.#zoom !== null) {
      for (const index of this.#zoom.visible) invertOutline(framebuffer, this.#zoom.rects[index]!, origin);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Tasks

  #emit(event: EngineEvent): void {
    for (const listener of this.#listeners) listener(event);
  }

  /**
   * Runs one piece of input handling as a task: busy until it and the page actions it queued are
   * done. Dropped when already busy, as the original ignores input then.
   */
  #run(work: () => void | Promise<void>): Promise<void> {
    if (this.#busy) return Promise.resolve();
    this.#busy = true;
    this.#dirty = true;
    let result: void | Promise<void>;
    try {
      result = work();
    } catch (error) {
      this.#emit({ kind: 'error', error });
      result = undefined;
    }
    if (!(result instanceof Promise) && this.#queue.length === 0) {
      this.#finish();
      return Promise.resolve();
    }
    const task = (async () => {
      try {
        await result;
        await this.#drain();
      } catch (error) {
        this.#emit({ kind: 'error', error });
      } finally {
        this.#finish();
      }
    })();
    this.#task = task;
    return task;
  }

  #finish(): void {
    this.#busy = false;
    this.#task = null;
    this.#dirty = true;
    // Page actions queued by something that ended meanwhile (an animation's finished event).
    if (this.#queue.length > 0) void this.#run(() => {});
  }

  /** A page operation for callers: after any running task, rethrowing its error. */
  async #perform<T>(work: () => Promise<T>): Promise<T> {
    let result: { value: T } | { error: unknown } | null = null;
    let ran = false;
    // Another task may start between `idle` and `#run` (an animation ending): wait for it too.
    while (!ran) {
      await this.idle();
      await this.#run(async () => {
        ran = true;
        try {
          result = { value: await work() };
        } catch (error) {
          result = { error };
        }
      });
    }
    const outcome = result as { value: T } | { error: unknown } | null;
    if (outcome === null) throw new Error('the page operation did not run');
    if ('error' in outcome) throw outcome.error;
    return outcome.value;
  }

  /** Runs the deferred page actions in queue order (behaviour.md §2.3). */
  async #drain(): Promise<void> {
    for (let next = this.#queue.shift(); next !== undefined; next = this.#queue.shift()) {
      const { action } = next;
      // Page actions release the mouse capture (§4.1, §4.3).
      this.#press = null;
      this.#buttonPressed = false;
      let ok = false;
      let reason = 'no window can show the page';
      try {
        if (action.page === null) reason = 'no page';
        else if (action.kind === 'openPage') ok = await this.#openPage(action.page, action.unknown1 === 1);
        else if (action.kind === 'changePage') ok = await this.#changePage(action.page);
        else {
          // Closing a page that is not open does nothing; it is not a failure.
          await this.#closePage(action.page);
          ok = true;
        }
      } catch (error) {
        reason = error instanceof Error ? error.message : String(error);
      }
      if (!ok) this.#emit({ kind: 'actionFailed', action, reason });
    }
  }

  /** Starts a task for queued page actions when nothing else runs. */
  #kick(): void {
    if (!this.#busy && this.#queue.length > 0) void this.#run(() => {});
  }

  // -------------------------------------------------------------------------------------------
  // Pointer handling

  #handlePress(x: number, y: number, doubleClick: boolean): void | Promise<void> {
    this.#press = null;
    this.#buttonPressed = false;
    if (doubleClick) {
      // A double-click message: no press, and the next release is ignored (§1.7).
      this.#ignoreRelease = true;
      return;
    }
    this.#ignoreRelease = false;
    const hit = this.hitTest(x, y);
    if (hit === null) return;
    const window = hit.window as Popup | null;
    this.#lastPress = window === null ? { window, x, y } : { window, x: x - window.x, y: y - window.y };
    if (window !== null) this.#raise(window);

    switch (hit.area) {
      case 'systemBox':
      case 'shadow':
        this.#setFocus(window);
        this.#press = { kind: 'close', window: window! };
        return;
      case 'caption': {
        this.#setFocus(window);
        const owned = this.#ownedBy(window);
        if (owned.length > 0) return this.#closeWindows(owned);
        this.#press = { kind: 'drag', window: window!, from: { x, y }, to: { x, y } };
        return;
      }
      case 'client':
        break;
    }

    this.#active = window;
    if (window?.focusable === true) this.#setFocus(window);
    const panel = hit.panel;
    if (panel === null) return;
    let closing: Promise<void> | undefined;
    if (panel.dial !== null) {
      // The dial ignores presses while "go" runs, and first closes the page's popups (§7).
      if (panel.dial.going) return;
      const owned = this.#ownedBy(window);
      if (owned.length > 0) closing = this.#closeWindows(owned);
    }
    const object = hit.object;
    if (object !== null && (flagsOf(object) & 0x2) === 0) {
      this.#press = { kind: 'object', target: { window, page: hit.page, panel, object } };
      if (object.object.kind === 'cancelButton') {
        this.media.stopAll();
        this.#buttonPressed = true;
        this.#dirty = true;
      }
    }
    return closing;
  }

  #handleRelease(x: number, y: number): void | Promise<void> {
    if (this.#ignoreRelease) {
      this.#ignoreRelease = false;
      this.#press = null;
      return;
    }
    const press = this.#press;
    this.#press = null;
    if (this.#buttonPressed) this.#dirty = true;
    this.#buttonPressed = false;

    if (press?.kind === 'close') {
      const hit = this.hitTest(x, y);
      if (hit?.window === press.window && (hit.area === 'systemBox' || hit.area === 'shadow')) {
        return this.#closeWindow(press.window).then(() => {});
      }
      return;
    }
    if (press?.kind === 'drag') {
      const { window, from } = press;
      if (x !== from.x || y !== from.y) {
        const before = this.#windowBox(window);
        window.x += x - from.x;
        window.y += y - from.y;
        this.#expose(before, this.#below(window));
      }
      this.#dirty = true;
      return;
    }
    if (press?.kind === 'object') {
      const { target } = press;
      const point = this.#panelPoint(target, x, y);
      if (target.panel.type !== 'display') return this.#simpleRelease(target, point);
      return this.#displayRelease(target, point);
    }

    // No capture: the window and panel under the pointer receive the release.
    const hit = this.hitTest(x, y);
    if (hit === null || hit.area !== 'client' || hit.panel === null) return;
    const window = hit.window as Popup | null;
    if (hit.panel.type === 'display') {
      // §1.5 step 2: nothing was pressed in this panel.
      return this.#closeWindows(this.#ownedBy(window));
    }
    if (hit.object === null) return;
    return this.#click(
      { window, page: hit.page, panel: hit.panel, object: hit.object },
      {
        x: hit.panelX,
        y: hit.panelY,
      },
    );
  }

  /** Release in a Display panel (behaviour.md §1.5). */
  #displayRelease(target: ObjectTarget, point: Point): void | Promise<void> {
    const owned = this.#ownedBy(target.window);
    if (owned.length > 0) {
      // A click on a page that owns popups only closes them.
      this.media.stopAll();
      return this.#closeWindows(owned);
    }
    // The original tests one pixel lower than the pointer here.
    const lowered = { x: point.x, y: point.y + 1 };
    const rect = target.object.rect;
    if (rect !== null && rectContains(rect, lowered.x, lowered.y)) return this.#click(target, lowered);
    this.media.stopAll();
  }

  /** Release in the nav bar or the A–Z dial (behaviour.md §1.6): the object at the release point. */
  #simpleRelease(target: ObjectTarget, point: Point): void | Promise<void> {
    const index = objectAt(target.panel, point.x, point.y);
    const object = target.panel.objects[index];
    if (object === undefined) return;
    return this.#click({ ...target, object }, point);
  }

  /** An accepted click on an object (behaviour.md §3); `point` is in panel coordinates. */
  #click(target: ObjectTarget, point: Point): void | Promise<void> {
    const object = target.object.object;
    switch (object.kind) {
      case 'hotspot': {
        const wasPlaying = (object.flags & 0x4) !== 0 ? this.media.stopAll() : false;
        if (wasPlaying && (object.flags & 0x1) === 0) return;
        // The pressed highlight (style = the i16) is 0 everywhere on the disc: nothing to draw.
        const rect = target.object.rect;
        if (rect !== null && rectContains(rect, point.x, point.y)) this.#fire(HandlerEvent.Click, target);
        return;
      }
      case 'animHotspot':
      case 'azAnimHotspot':
        if (this.media.stopAll()) return;
        this.#playObjectAnimation(target, 'click');
        return;
      case 'navHotspot':
        return this.#navClick(target);
      case 'azHotspot':
        this.#dialClick(target, object.unknown2);
        return;
      case 'cancelButton':
        this.#fire(HandlerEvent.Click, target);
        return;
      case 'animationControl':
        this.media.control({ kind: 'click', control: object, x: point.x, y: point.y, target });
        return;
      case 'bitmap':
      case 'wordBox':
      case 'scrollBitmap':
      case 'scrollBar':
        // Scroll objects have their own handling in Phase 6.
        this.media.stopAll();
        return;
    }
  }

  // -------------------------------------------------------------------------------------------
  // Events and actions

  /**
   * Fires an event at an object (behaviour.md §2.2): its own handlers, then the active page's,
   * its template's and the product's.
   */
  #fire(event: number, target: ObjectTarget): void {
    const lists: (readonly Handler[])[] = [];
    const object = target.object.object;
    if ('handlers' in object) lists.push(object.handlers);
    const active = this.#active === null ? this.#base : this.#active.page;
    if (active !== null) lists.push(active.page.handlers, active.template.handlers);
    lists.push(this.content.database.product.handlers);
    for (const handlers of lists) this.#runHandlers(handlers, event, target);
  }

  #runHandlers(handlers: readonly Handler[], event: number, target: MediaTarget): void {
    for (const handler of handlers) {
      if (handler.event === event) this.#runActions(handler.actions, target);
    }
  }

  /**
   * Runs an action list in order (behaviour.md §2.3): page actions are queued and run after the
   * current input handling; the others run at once.
   */
  #runActions(actions: readonly Action[], target: MediaTarget): void {
    for (const action of actions) {
      switch (action.kind) {
        case 'openPage':
        case 'changePage':
        case 'closePage':
          this.#queue.push({ action });
          break;
        case 'sendMessage':
          this.#sendMessage(action.target, action.message, target);
          break;
        case 'productOption':
          this.#emit({ kind: 'productOption', option: action.option, page: this.#optionsPage() });
          break;
        default:
          this.media.runAction(action satisfies MediaAction, target);
      }
    }
    this.#kick();
  }

  /** SendMessage (behaviour.md §4.5): the first object with the id in the handler's panel. */
  #sendMessage(id: number, message: number, origin: MediaTarget): void {
    const object = origin.panel.objects.find((placed) => placed.object.id === id);
    if (object === undefined) return;
    if (object.object.kind === 'animationControl') {
      this.media.control({ kind: 'message', control: object.object, message, target: { ...origin, object } });
    }
  }

  #optionsPage(): PageInstance | null {
    const target = this.#optionsTarget;
    if (target === null) return null;
    const open =
      target.window === null
        ? this.#base === target.page
        : target.window.page === target.page && this.#popups.includes(target.window);
    return open ? target.page : null;
  }

  /** Queues the page change of "go to a page" (behaviour.md §6.1): ChangePage to a base page, else OpenPage. */
  #goTo(ref: PageRef | null | undefined): void {
    if (ref === null || ref === undefined) return;
    const base = this.content.database.getPage(ref).pageType === 'base';
    this.#queue.push({
      action: base
        ? { kind: 'changePage', page: ref, unknown1: 0 }
        : { kind: 'openPage', page: ref, unknown1: 0 },
    });
    this.#kick();
  }

  /** Plays an AnimHotspot's animation; its end fires the finished event (playback.md §6). */
  #playObjectAnimation(target: ObjectTarget, reason: AnimationReason): void {
    const object = target.object.object;
    if ((object.kind !== 'animHotspot' && object.kind !== 'azAnimHotspot') || object.file === null) return;
    const name = object.file;
    const path = this.#animationPath(target.page, name);
    this.media.playAnimation({ reason, name, path, target }, () => {
      if (this.#isShown(target.page)) this.#fire(HandlerEvent.Finished, target);
    });
  }

  #animationPath(page: PageInstance, name: string): string {
    const location = resolveMedia(page.page.directory, { kind: 'animation', name });
    return location.kind === 'file' ? location.path : name;
  }

  // -------------------------------------------------------------------------------------------
  // Navigation bar and the A–Z machine

  /** A navigation button (behaviour.md §6.1): stop media, play its animation, then act. */
  async #navClick(target: ObjectTarget): Promise<void> {
    const panel = target.panel.panel;
    const object = target.object.object;
    if (panel?.kind !== 'navPanel' || object.kind !== 'navHotspot') return;
    if (this.media.stopAll()) return; // press again
    if (object.file !== null) {
      const request = {
        reason: 'nav' as const,
        name: object.file,
        path: this.#animationPath(target.page, object.file),
        target,
      };
      const ended = await this.#waitForAnimation(
        new Promise<boolean>((resolve) => {
          this.#cancelNavWait = () => resolve(false);
          this.media.playAnimation(
            request,
            () => resolve(true),
            () => resolve(false),
          );
        }),
      );
      this.#cancelNavWait = null;
      if (!ended) return;
    }
    await this.#navAction(panel, panel.buttonIds.indexOf(object.id));
  }

  /** What each navigation button does (page-database.md, NavPanel; behaviour.md §6.2–6.3). */
  async #navAction(panel: NavPanel, button: number): Promise<void> {
    const pages = panel.buttonPages;
    const links = this.#base?.page.links ?? null;
    switch (button) {
      case 0:
        return this.#goTo(pages[0]);
      case 1:
        return this.#goTo(links !== null ? links[1] : pages[2]);
      case 2:
        return this.#goTo(links !== null ? links[0] : pages[1]);
      case 3:
        return this.#goTo(links !== null ? links[3] : pages[4]);
      case 4:
        return this.#goTo(links !== null ? links[2] : pages[3]);
      case 5:
        // Back. With fewer than two entries the original stays busy until reactivated; the remake
        // does nothing instead (behaviour.md §6.3, §11).
        return this.#goTo(this.#history.back());
      case 6:
      case 7: {
        const ref = pages[button === 6 ? 7 : 8];
        if (ref === null || ref === undefined) return;
        await this.#closeShowing(ref);
        return this.#goTo(ref);
      }
      case 8: {
        for (const ref of [pages[5], pages[6]]) {
          if (ref !== null && ref !== undefined) await this.#closeShowing(ref);
        }
        const newest = this.#popups.at(-1) ?? null;
        const page = newest === null ? this.#base : newest.page;
        if (page !== null) this.#optionsTarget = { window: newest, page };
        this.#active = newest;
        this.#setFocus(newest);
        const options = pages[5];
        if (options !== null && options !== undefined) await this.#openPage(options, false);
        return;
      }
    }
  }

  /** An AZHotspot (behaviour.md §7): codes 0–25 pick a letter, 26/27 step, 28 is "go". */
  #dialClick(target: ObjectTarget, code: number): void {
    const dial = target.panel.dial;
    const panel = target.panel.panel;
    // While "go" runs the dial ignores presses, and so its clicks.
    if (dial === null || panel?.kind !== 'azDial' || dial.going) return;
    if (code >= 0 && code <= 27) {
      if (code <= 25) dial.letter = code;
      else if (code === 26) dial.letter = (dial.letter + 25) % 26;
      else dial.letter = (dial.letter + 1) % 26;
      // The new letter's picture is drawn over whatever an animation left there.
      clearPicture(target.panel, DIAL_POSITIONS.letter, dial.letters[dial.letter] ?? null);
      this.media.runAction(DIAL_SOUND, target);
      this.#dirty = true;
      return;
    }
    if (code !== 28) return;
    this.#dialGo(target, panel, dial.letter);
  }

  #dialGo(target: ObjectTarget, panel: AzDialPanel, letter: number): void {
    const dial = target.panel.dial!;
    dial.going = true;
    dial.goPressed = true;
    dial.lampOverGo = false;
    clearPicture(target.panel, DIAL_POSITIONS.go, dial.goPicture);
    this.#dialGoTick = Math.floor((this.clock.now() - this.#dialSince) / 1000);
    this.#dirty = true;
    const finish = (): void => {
      if (!this.#isShown(target.page)) return;
      dial.going = false;
      this.#goTo(panel.letterPages[letter]);
    };
    const name = panel.letterAnimations[letter] ?? null;
    if (name === null) {
      finish();
      return;
    }
    this.media.playAnimation(
      { reason: 'dial', name, path: this.#animationPath(target.page, name), target },
      finish,
      () => {
        // Stopped (all media stopped meanwhile): the dial takes presses again.
        dial.going = false;
      },
    );
  }

  // -------------------------------------------------------------------------------------------
  // Page actions

  /** ChangePage (behaviour.md §4.3, rendering.md §7.7). */
  async #changePage(ref: PageRef): Promise<boolean> {
    const type = this.content.database.getPage(ref).pageType;
    let window: Popup | null;
    if (type === 'base') {
      window = null;
    } else {
      const same = this.#popups.filter((popup) => popup.page.page.pageType === type);
      if (same.length === 1) window = same[0]!;
      else if (this.#focus !== null && this.#focus.page.page.pageType === type) window = this.#focus;
      else return false;
    }
    const current = window === null ? this.#base : window.page;
    if (current?.ref === ref) {
      await this.#closeWindows(this.#ownedBy(window));
      this.#recordHistory();
      return true;
    }
    const instance = await this.loadPage(ref);
    await this.#closeWindows(this.#ownedBy(window));
    if (window !== null && !this.#popups.includes(window)) return false;
    // The new page's players open before the old page's go, so shared ones stay (playback.md §1).
    this.media.pageOpened?.(instance);
    if (window === null) {
      if (this.#base !== null) {
        keepSharedPanels(this.#base, instance);
        this.media.pageClosed(this.#base);
      }
      this.#base = instance;
      this.#dialSince = this.clock.now();
    } else {
      this.media.pageClosed(window.page);
      const resized = window.page.width !== instance.width || window.page.height !== instance.height;
      const before = this.#windowBox(window);
      window.page = instance;
      if (resized) {
        const position = windowPosition(this.content.database, instance, this.presentation, false);
        window.x = position.x;
        window.y = position.y;
        this.#expose(before, this.#below(window));
      }
      // The zoom flag belonged to the page opened in the window.
      window.zoomFrom = null;
    }
    this.#active = window;
    this.#dirty = true;
    // The transition id (ChangePage's u16) is 0 on the whole disc: a plain copy (rendering.md §3).
    this.#pageOpened(instance, window, false);
    this.#recordHistory();
    return true;
  }

  /** After a successful ChangePage: record the base page (behaviour.md §6.3). */
  #recordHistory(): void {
    if (this.#base !== null) this.#history.push(this.#base.ref);
  }

  /** OpenPage (behaviour.md §4.1). */
  async #openPage(ref: PageRef, zoom: boolean): Promise<boolean> {
    if (this.#base?.ref === ref || this.#popups.some((popup) => popup.page.ref === ref)) return true;
    const instance = await this.loadPage(ref);
    const type = instance.page.pageType;
    if (type !== 'popup' && type !== 'index') return false;
    const owner = this.#active !== null && this.#popups.includes(this.#active) ? this.#active : null;
    const popup = new Popup(
      instance,
      windowPosition(this.content.database, instance, this.presentation, true),
      windowStyle(instance.template),
      owner,
    );
    if (zoom && this.#lastPress !== null) {
      popup.zoomFrom = this.#zoomStart(this.#lastPress);
      await this.#playZoom(ZOOM_OPEN_PERCENTAGES, popup.zoomFrom, this.#screenRect(popup));
    }
    this.media.pageOpened?.(instance);
    this.#popups.push(popup);
    this.#active = popup;
    if (popup.focusable) this.#setFocus(popup);
    this.#dirty = true;
    this.#pageOpened(instance, popup, true);
    return true;
  }

  /** ClosePage (behaviour.md §4.4): the topmost window showing the page. */
  async #closePage(ref: PageRef): Promise<boolean> {
    const popup = this.#popups.findLast((candidate) => candidate.page.ref === ref);
    return popup === undefined ? false : this.#closeWindow(popup);
  }

  async #closeShowing(ref: PageRef): Promise<void> {
    await this.#closePage(ref);
  }

  /**
   * Closes a popup window (behaviour.md §4.4): the windows it owns first, then gives the focus
   * back to the page that was active when it opened, then plays the closing zoom if it opened with
   * one.
   */
  async #closeWindow(popup: Popup): Promise<boolean> {
    if (!this.#popups.includes(popup)) return false;
    await this.#closeWindows(this.#ownedBy(popup));
    const at = this.#popups.indexOf(popup);
    if (at < 0) return false;
    const below = this.#below(popup);
    this.#popups.splice(at, 1);
    this.#expose(this.#windowBox(popup), below);
    const press = this.#press;
    if (press !== null && (press.kind === 'object' ? press.target.window : press.window) === popup) {
      this.#press = null;
      this.#buttonPressed = false;
    }
    if (popup.focusable) {
      const back = popup.opener === null || this.#popups.includes(popup.opener) ? popup.opener : null;
      this.#focus = back;
      this.#active = back;
    }
    if (this.#focus === popup) this.#focus = null;
    if (this.#active === popup) this.#active = null;
    this.media.pageClosed(popup.page);
    this.#dirty = true;
    if (popup.zoomFrom !== null) {
      await this.#playZoom(ZOOM_CLOSE_PERCENTAGES, popup.zoomFrom, this.#screenRect(popup));
    }
    return true;
  }

  /** Closes windows one after the other, topmost first. */
  async #closeWindows(popups: readonly Popup[]): Promise<void> {
    for (const popup of [...popups].reverse()) await this.#closeWindow(popup);
  }

  /**
   * After a page has been shown (rendering.md §8): its open handlers run and its autostart
   * animations start. Popups get `before open` (event 5) first and the page's `open` last; base
   * pages and changed windows the page's `open` first.
   */
  #pageOpened(page: PageInstance, window: Popup | null, opening: boolean): void {
    const pageTarget: MediaTarget | null =
      page.panels[0] === undefined ? null : { window, page, panel: page.panels[0], object: null };
    if (opening && pageTarget !== null)
      this.#runHandlers(page.page.handlers, HandlerEvent.BeforeOpen, pageTarget);
    if (!opening && pageTarget !== null) this.#runHandlers(page.page.handlers, HandlerEvent.Open, pageTarget);
    for (const panel of page.panels) {
      this.#runHandlers(panel.panel?.handlers ?? [], HandlerEvent.Open, {
        window,
        page,
        panel,
        object: null,
      });
      for (const object of panel.objects) {
        const kind = object.object.kind;
        if ((kind === 'animHotspot' || kind === 'azAnimHotspot') && (flagsOf(object) & 0x20) !== 0) {
          this.#playObjectAnimation({ window, page, panel, object }, 'autostart');
        }
      }
    }
    if (opening && pageTarget !== null) this.#runHandlers(page.page.handlers, HandlerEvent.Open, pageTarget);
  }

  // -------------------------------------------------------------------------------------------
  // Zoom (behaviour.md §4.2)

  /** The zoom's start point on the screen: the last press, offset as the original does. */
  #zoomStart(press: { readonly x: number; readonly y: number }): Point {
    const { clientScreenOrigin, frameOffset, captionHeight } = this.presentation;
    return {
      x: clientScreenOrigin.x + frameOffset.x + press.x,
      y: clientScreenOrigin.y + frameOffset.y + captionHeight + press.y,
    };
  }

  /** A popup window's rectangle on the screen, caption and shadow included (right/bottom exclusive). */
  #screenRect(popup: Popup): Box {
    const { width, height } = windowSize(popup);
    const left = popup.x + this.presentation.clientScreenOrigin.x;
    const top = popup.y + this.presentation.clientScreenOrigin.y;
    return { left, top, right: left + width, bottom: top + height };
  }

  async #playZoom(percentages: readonly number[], point: Point, window: Box): Promise<void> {
    this.#zoom = { start: this.clock.now(), rects: zoomRectangles(point, window, percentages), visible: [0] };
    this.#dirty = true;
    await this.clock.wait(ZOOM_DURATION_MS);
    this.#zoom = null;
    this.#dirty = true;
  }

  // -------------------------------------------------------------------------------------------
  // Helpers

  /**
   * Waits for an animation a task depends on (a navigation button). On a {@link VirtualClock} the
   * engine moves time on itself until it ends, as the clock does for other waits.
   */
  async #waitForAnimation(ended: Promise<boolean>): Promise<boolean> {
    this.#waitingForMedia = true;
    this.#onMediaWait?.();
    try {
      const clock = this.clock;
      if (!(clock instanceof VirtualClock)) return await ended;
      let done = false;
      void ended.then(() => (done = true));
      while (!done) {
        const loading = this.media.loading?.() ?? null;
        if (loading !== null) await loading;
        this.update();
        await Promise.resolve();
        if (done) break;
        const delay = this.media.nextEventDelay?.() ?? null;
        if (delay === null) {
          if (loading === null) break;
          continue;
        }
        clock.advance(stepMs(delay));
      }
      return await ended;
    } finally {
      this.#waitingForMedia = false;
    }
  }

  /** A window's rectangle in page coordinates, caption and shadow included. */
  #windowBox(window: Popup): Box {
    const { width, height } = windowSize(window);
    return { left: window.x, top: window.y, right: window.x + width, bottom: window.y + height };
  }

  /** The base page (`null`) and the popups below a popup in the stacking order. */
  #below(popup: Popup): (Popup | null)[] {
    const at = this.#popups.indexOf(popup);
    return [null, ...this.#popups.slice(0, Math.max(0, at))];
  }

  /**
   * A rectangle of the screen (page coordinates) was uncovered: Windows has the windows there
   * repaint it from their panels at rest (rendering.md §3), so animation frames drawn there are
   * gone (playback.md §3).
   */
  #expose(rect: Box, windows: readonly (Popup | null)[]): void {
    for (const window of windows) {
      const page = window === null ? this.#base : window.page;
      if (page === null) continue;
      const originX = window?.x ?? 0;
      const originY = window === null ? 0 : window.y + window.caption;
      for (const panel of page.panels) {
        if (panel.layer.empty) continue;
        const left = originX + panel.x;
        const top = originY + panel.y;
        const box = intersect(rect, { left, top, right: left + panel.width, bottom: top + panel.height });
        if (box.left >= box.right || box.top >= box.bottom) continue;
        panel.layer.clear({
          left: box.left - left,
          top: box.top - top,
          right: box.right - left,
          bottom: box.bottom - top,
        });
        this.#dirty = true;
      }
    }
  }

  /** The topmost window at a page point: a popup, `null` for the main window, `undefined` for none. */
  #windowAt(x: number, y: number): Popup | null | undefined {
    for (let i = this.#popups.length - 1; i >= 0; i--) {
      const popup = this.#popups[i]!;
      const { width, height } = windowSize(popup);
      if (x >= popup.x && x < popup.x + width && y >= popup.y && y < popup.y + height) return popup;
    }
    if (this.#base !== null && x >= 0 && y >= 0 && x < CLIENT_WIDTH && y < CLIENT_HEIGHT) return null;
    return undefined;
  }

  /** A page point in the coordinates of the target's panel. */
  #panelPoint(target: MediaTarget, x: number, y: number): Point {
    const window = target.window;
    const originX = (window?.x ?? 0) + target.panel.x;
    const originY = (window === null ? 0 : window.y + window.caption) + target.panel.y;
    return { x: x - originX, y: y - originY };
  }

  #ownedBy(window: Popup | null): Popup[] {
    return this.#popups.filter((popup) => popup.owner === window);
  }

  #isShown(page: PageInstance): boolean {
    return this.#base === page || this.#popups.some((popup) => popup.page === page);
  }

  #setFocus(window: Popup | null): void {
    if (this.#focus === window) return;
    this.#focus = window;
    this.#dirty = true;
  }

  /**
   * Brings a pressed popup to the top, with the windows it owns above it (Windows activates a
   * window when it is clicked, and keeps owned windows above their owner).
   */
  #raise(popup: Popup): void {
    const descends = (candidate: Popup): boolean => {
      for (let at: Popup | null = candidate; at !== null; at = at.owner) if (at === popup) return true;
      return false;
    };
    const family = this.#popups.filter(descends);
    const rest = this.#popups.filter((candidate) => !descends(candidate));
    const order = [...rest, ...family];
    if (order.some((candidate, i) => candidate !== this.#popups[i])) {
      // Parts of the raised windows that others covered are repainted (rendering.md §3).
      for (const raised of family) {
        const at = this.#popups.indexOf(raised);
        for (const other of this.#popups.slice(at + 1)) {
          if (!descends(other)) this.#expose(this.#windowBox(other), [raised]);
        }
      }
      this.#popups = order;
      this.#dirty = true;
    }
  }

  /** The cursor rule of behaviour.md §8; `null` keeps the current cursor (unknown name). */
  #cursorAtPointer(): CursorName | null {
    let window: Popup | null;
    let object: PlacedObject | null;
    const press = this.#press;
    if (press?.kind === 'object') {
      window = press.target.window;
      object = press.target.object;
    } else {
      if (this.#pointer === null) return 'arrow';
      const hit = this.hitTest(this.#pointer.x, this.#pointer.y);
      if (hit === null || hit.area !== 'client' || hit.object === null) return 'arrow';
      window = hit.window as Popup | null;
      object = hit.object;
    }
    if (this.#ownedBy(window).length > 0) return 'arrow';
    if (this.media.isPlaying() && (flagsOf(object) & 0x1) === 0) return 'arrow';
    return cursorForName(object.object.cursor);
  }

  /** Overdraws the CancelButton's pressed picture while it is pressed (behaviour.md §3). */
  #drawPressedButton(content: IndexedCanvas, window: Popup | null): void {
    const press = this.#press;
    if (!this.#buttonPressed || press?.kind !== 'object' || press.target.window !== window) return;
    const { panel, object } = press.target;
    if (object.look?.kind !== 'button' || object.look.pressed === null || object.rect === null) return;
    content
      .view(panel.x, panel.y, panel.width, panel.height)
      .draw(object.look.pressed, object.rect.left, object.rect.top);
  }
}

/** A clock step (ms) that reaches an event `delay` seconds ahead, rounded up so it is due. */
function stepMs(delay: number): number {
  return Math.ceil(Math.max(0, delay) * 1e6) / 1e3;
}

/** A picture drawn at a panel position covers what animations drew there. */
function clearPicture(
  panel: PanelInstance,
  at: { readonly x: number; readonly y: number },
  picture: { readonly width: number; readonly height: number } | null,
): void {
  if (picture === null) return;
  panel.layer.clear({ left: at.x, top: at.y, right: at.x + picture.width, bottom: at.y + picture.height });
}

/**
 * A ChangePage keeps a shared panel whose PanelRef is the same in the old and new templates, and
 * does not repaint it (rendering.md §2): what animations drew there stays.
 */
function keepSharedPanels(old: PageInstance, next: PageInstance): void {
  for (const panel of next.panels) {
    if (panel.source !== 'shared' || panel.slot === null) continue;
    const same = old.panels.find(
      (candidate) =>
        candidate.source === 'shared' && candidate.slot !== null && samePanelRef(candidate.slot, panel.slot!),
    );
    if (same !== undefined) panel.layer.adopt(same.layer);
  }
}

function samePanelRef(a: NonNullable<PanelInstance['slot']>, b: NonNullable<PanelInstance['slot']>): boolean {
  return (
    a.panelType === b.panelType &&
    a.panelId === b.panelId &&
    a.sharedPanel === b.sharedPanel &&
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height &&
    a.colour.red === b.colour.red &&
    a.colour.green === b.colour.green &&
    a.colour.blue === b.colour.blue
  );
}

/** An object's flags; the scroll objects have none. */
function flagsOf(placed: PlacedObject): number {
  return 'flags' in placed.object ? placed.object.flags : 0;
}
