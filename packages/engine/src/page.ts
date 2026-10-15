/**
 * Instantiating a page (rendering.md §2): its panel list, panel rectangles, and every display
 * object placed with the pictures it draws at rest (§4–6), loaded once so that painting is
 * synchronous.
 */
import {
  resolveMedia,
  type AzDialPanel,
  type DisplayObject,
  type Page,
  type PageDatabase,
  type PageRef,
  type Panel,
  type PanelRef,
  type PanelType,
  type Rect,
  type Template,
} from '@twtw/formats';
import { paletteIndexOf } from './colours.ts';
import { PanelLayer } from './render/layer.ts';
import { ProgramBitmap, type PictureStore } from './pictures.ts';
import type { IndexedImage } from './screen.ts';

/** What a display object draws at rest; `null` for objects that draw nothing (hotspots etc.). */
export type ObjectLook =
  /** A picture copied opaque at the rectangle's top-left: Bitmap, AnimationControl. */
  | { readonly kind: 'picture'; readonly picture: IndexedImage | null }
  /** The CancelButton: its picture at rest, and the one drawn while it is pressed. */
  | { readonly kind: 'button'; readonly picture: IndexedImage | null; readonly pressed: IndexedImage | null }
  /** The rectangle's size of the picture, from its top row (scroll position 0). */
  | { readonly kind: 'scrollBitmap'; readonly picture: IndexedImage | null }
  /** The eight part bitmaps of a scroll bar, in data order (rendering.md §5). */
  | { readonly kind: 'scrollBar'; readonly parts: readonly (IndexedImage | null)[] }
  /** An AnimationControl's strip, which changes while its movie plays (playback.md §7). */
  | { readonly kind: 'control'; readonly strip: ControlStrip };

/** Where an AnimationControl's movie is, as its strip shows it (playback.md §7). */
export type ControlState =
  /** At its start: rewind greyed, play. */
  | 'rest'
  /** Playing: rewind, pause, progress. */
  | 'playing'
  /** Stopped part-way by its pause button: rewind, play, progress. */
  | 'paused'
  /** At its end, not rewound: rewind, play greyed, progress full. */
  | 'ended';

/** An AnimationControl strip: its parts and what it shows. The media changes `state` and `progress`. */
export interface ControlStrip {
  state: ControlState;
  /** Columns of the progress indicator shown, 0 … {@link CONTROL_PROGRESS.width}. */
  progress: number;
  readonly background: IndexedImage | null;
  readonly rewind: IndexedImage | null;
  readonly rewindActive: IndexedImage | null;
  readonly play: IndexedImage | null;
  readonly pause: IndexedImage | null;
  readonly playEnded: IndexedImage | null;
  readonly indicator: IndexedImage | null;
}

export interface PlacedObject {
  readonly object: DisplayObject;
  /**
   * Panel-relative rectangle after loading: a Bitmap's `right`/`bottom` come from its picture's
   * size, and an AnimationControl becomes 74×22 (rendering.md §4–5). `null` when the object has
   * no rectangle (flag `0x100`, never on the disc).
   */
  readonly rect: Rect | null;
  readonly look: ObjectLook | null;
}

/** The A–Z machine dial's state (rendering.md §6, behaviour.md §7). */
export interface DialState {
  /** Current letter, 0 = A. */
  letter: number;
  /** Lamp state: the program alternates it every second, starting with "on" after the first tick. */
  lampOn: boolean;
  /** The "go" animation is running: the dial ignores presses. */
  going: boolean;
  /** "Go" was pressed: the pressed button shows until the page changes. */
  goPressed: boolean;
  /** The lamp has been drawn since "go" was pressed, so it shows over the pressed button. */
  lampOverGo: boolean;
  /** Each letter's still picture, `null` if it failed to load. */
  readonly letters: readonly (IndexedImage | null)[];
  readonly lampOnPicture: IndexedImage | null;
  readonly lampOffPicture: IndexedImage | null;
  readonly goPicture: IndexedImage | null;
}

export type PanelSource =
  /** One of the page's own panels. */
  | 'page'
  /** A template slot filled by a shared panel from the heap (navigation bar, frame). */
  | 'shared'
  /** A non-shared template slot the page does not supply: painted with its colour only. */
  | 'empty';

export interface PanelInstance {
  readonly id: number;
  readonly type: PanelType;
  readonly source: PanelSource;
  /** The template's PanelRef for this panel; `null` if the page's panel has no slot. */
  readonly slot: PanelRef | null;
  /** `null` for an empty slot. */
  readonly panel: Panel | null;
  /** Position and size in the page's content coordinates. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** The fill colour as a palette index. */
  readonly colour: number;
  readonly objects: readonly PlacedObject[];
  /** Present on the A–Z dial panel. */
  readonly dial: DialState | null;
  /** Animation frames drawn over the panel since it was painted (playback.md §3). */
  readonly layer: PanelLayer;
}

export interface PageInstance {
  readonly ref: PageRef;
  readonly page: Page;
  readonly template: Template;
  /** In paint order: the page's own panels, then the template's other slots. */
  readonly panels: readonly PanelInstance[];
  /** Content size: the template's fixed size, or the extent of the panels. */
  readonly width: number;
  readonly height: number;
  /** Loading problems (missing or undecodable pictures); those pictures draw nothing. */
  readonly problems: readonly string[];
}

export interface PageLoadContext {
  readonly database: PageDatabase;
  readonly pictures: PictureStore;
  readonly palette: Uint8Array;
}

/** AnimationControl strip size (rendering.md §5). */
export const CONTROL_WIDTH = 74;
export const CONTROL_HEIGHT = 22;
/** Part offsets from the strip's top-left (rendering.md §5, playback.md §7). */
export const CONTROL_PARTS = {
  rewind: { x: 3, y: 3, width: 15, height: 16 },
  play: { x: 20, y: 3, width: 16, height: 16 },
} as const;
/** The progress indicator's slot in the strip: bitmap 159 from its left edge, this wide at most. */
export const CONTROL_PROGRESS = { x: 39, y: 7, width: 30, height: 9 } as const;
/** Where the A–Z dial panel draws the current letter's picture and the lamp (rendering.md §6). */
export const DIAL_POSITIONS = {
  letter: { x: 161, y: 101 },
  lamp: { x: 334, y: 350 },
  go: { x: 320, y: 335 },
} as const;

/** Loads a page and everything it draws at rest. Throws if the page or its template is invalid. */
export async function instantiatePage(context: PageLoadContext, ref: PageRef): Promise<PageInstance> {
  const { database } = context;
  const page = database.getPage(ref);
  const template = database.templateFor(page);
  if (template === undefined) throw new Error(`page ${ref}: no template ${page.templateId}`);
  const problems: string[] = [];
  const loader = new ObjectLoader(context, page.directory, problems);

  const own = new Set(page.panels.map((panel) => panel.id));
  const entries: { source: PanelSource; slot: PanelRef | null; panel: Panel | null }[] = [];
  for (const panel of page.panels) {
    const slot = template.panels.find((candidate) => candidate.panelId === panel.id) ?? null;
    if (slot === null) problems.push(`panel ${panel.id} has no slot in template ${template.id}`);
    entries.push({ source: 'page', slot, panel });
  }
  for (const slot of template.panels) {
    if (own.has(slot.panelId)) continue;
    if (slot.sharedPanel === null) {
      entries.push({ source: 'empty', slot, panel: null });
    } else {
      entries.push({
        source: 'shared',
        slot,
        panel: database.getSharedPanel(slot.sharedPanel, slot.panelType).panel,
      });
    }
  }

  const panels = await Promise.all(
    entries.map(async ({ source, slot, panel }): Promise<PanelInstance> => {
      const objects = panel === null ? [] : await Promise.all(panel.objects.map((o) => loader.place(o)));
      const dial = panel?.kind === 'azDial' ? await loader.dial(panel) : null;
      const extent = objectExtent(objects);
      const width = slot !== null && slot.width !== 0 ? slot.width : extent.width;
      const height = slot !== null && slot.height !== 0 ? slot.height : extent.height;
      return {
        id: panel?.id ?? slot?.panelId ?? 0,
        type: panel?.kind ?? slot?.panelType ?? 'display',
        source,
        slot,
        panel,
        x: slot?.x ?? 0,
        y: slot?.y ?? 0,
        width,
        height,
        colour: slot === null ? 0 : paletteIndexOf(context.palette, slot.colour),
        objects,
        dial,
        layer: new PanelLayer(width, height),
      };
    }),
  );

  const width = template.width !== 0 ? template.width : Math.max(0, ...panels.map((p) => p.x + p.width));
  const height = template.height !== 0 ? template.height : Math.max(0, ...panels.map((p) => p.y + p.height));
  return { ref, page, template, panels, width, height, problems };
}

/**
 * The extent of a panel's objects, used when its PanelRef size is 0: the largest object `right`
 * and `bottom` after loading (rendering.md §2).
 */
function objectExtent(objects: readonly PlacedObject[]): { width: number; height: number } {
  let width = 0;
  let height = 0;
  for (const { rect } of objects) {
    if (rect === null) continue;
    width = Math.max(width, rect.right);
    height = Math.max(height, rect.bottom);
  }
  return { width, height };
}

class ObjectLoader {
  readonly #context: PageLoadContext;
  readonly #directory: string | null;
  readonly #problems: string[];

  constructor(context: PageLoadContext, directory: string | null, problems: string[]) {
    this.#context = context;
    this.#directory = directory;
    this.#problems = problems;
  }

  async place(object: DisplayObject): Promise<PlacedObject> {
    const { rect } = object;
    switch (object.kind) {
      case 'bitmap': {
        const picture = await this.#picture(object.file);
        // The stored right/bottom are ignored: the picture's size decides (rendering.md §4).
        const placed =
          rect !== null && picture !== null
            ? { ...rect, right: rect.left + picture.width, bottom: rect.top + picture.height }
            : rect;
        return { object, rect: placed, look: { kind: 'picture', picture } };
      }
      case 'cancelButton':
        // The button's picture is EXE bitmap 170; its three strings are unused (rendering.md §5).
        return {
          object,
          rect,
          look: {
            kind: 'button',
            picture: this.#resource(ProgramBitmap.cancel),
            pressed: this.#resource(ProgramBitmap.cancelPressed),
          },
        };
      case 'animationControl': {
        const placed =
          rect === null
            ? null
            : { ...rect, right: rect.left + CONTROL_WIDTH, bottom: rect.top + CONTROL_HEIGHT };
        return { object, rect: placed, look: { kind: 'control', strip: this.#controlStrip() } };
      }
      case 'scrollBitmap':
        return { object, rect, look: { kind: 'scrollBitmap', picture: await this.#picture(object.file) } };
      case 'scrollBar': {
        const parts = await Promise.all(object.parts.map((name) => this.#picture(name)));
        return { object, rect, look: { kind: 'scrollBar', parts } };
      }
      case 'hotspot':
      case 'azHotspot':
      case 'wordBox':
      case 'navHotspot':
      case 'animHotspot':
      case 'azAnimHotspot':
        // Nothing at rest; animations draw only while they play (Phase 5).
        return { object, rect, look: null };
    }
  }

  async dial(panel: AzDialPanel): Promise<DialState> {
    const letters = await Promise.all(panel.letterAnimations.map((name) => this.#picture(name)));
    return {
      letter: 0,
      lampOn: false,
      going: false,
      goPressed: false,
      lampOverGo: false,
      letters,
      lampOnPicture: this.#resource(ProgramBitmap.lampOn),
      lampOffPicture: this.#resource(ProgramBitmap.lampOff),
      goPicture: this.#resource(ProgramBitmap.dialGo),
    };
  }

  /** The AnimationControl's 74×22 strip (rendering.md §5), at rest. */
  #controlStrip(): ControlStrip {
    return {
      state: 'rest',
      progress: 0,
      background: this.#resource(ProgramBitmap.animationControl),
      rewind: this.#resource(ProgramBitmap.animationRewind),
      rewindActive: this.#resource(ProgramBitmap.animationRewindActive),
      play: this.#resource(ProgramBitmap.animationPlay),
      pause: this.#resource(ProgramBitmap.animationPause),
      playEnded: this.#resource(ProgramBitmap.animationPlayEnded),
      indicator: this.#resource(ProgramBitmap.animationProgress),
    };
  }

  /** A picture by database name (`.DIB` in the page directory, a disc path, or `@` resource). */
  async #picture(name: string | null): Promise<IndexedImage | null> {
    if (name === null) return null;
    const location = resolveMedia(this.#directory, { kind: 'bitmap', name });
    if (location.kind === 'resource') return this.#resource(location.name);
    try {
      return await this.#context.pictures.file(location.path);
    } catch (error) {
      this.#problems.push(`${location.path}: ${describe(error)}`);
      return null;
    }
  }

  #resource(id: number | string): IndexedImage | null {
    try {
      return this.#context.pictures.resource(id);
    } catch (error) {
      this.#problems.push(`program bitmap ${String(id)}: ${describe(error)}`);
      return null;
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
