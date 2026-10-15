/**
 * Where differences from a Wine reference capture are expected, derived from what the engine has
 * on screen, the page database and the capture's sidecar. Each mask carries its reason (see
 * {@link REASONS}); the comparison explains a differing pixel by the first mask covering it, so
 * the most specific masks come first.
 *
 * Animation masks are checked per pixel: a difference is explained only where the reference shows
 * a colour that some frame of the animation paints at that position.
 */
import {
  HandlerEvent,
  parsePics,
  resolveMedia,
  unpackPicsImage,
  type DisplayObject,
  type PageDatabase,
  type PicsFile,
  type Rect,
  type Rgb,
} from '@twtw/formats';
import {
  DIAL_POSITIONS,
  INDEX_CONTROLS,
  WINE,
  windowSize,
  type DataSource,
  type PageInstance,
  type PageWindow,
  type PanelInstance,
} from '@twtw/engine';
import type { Mask } from './diff.ts';

/**
 * Wine's client size before refcapture resized the window: captures made before that fix are
 * black beyond it (rendering.md §10, reference-environments.md "Client area size").
 */
export const WINE_VISIBLE = { width: 634, height: 454 } as const;

/** What is on screen, as the engine has it, plus what the capture says about it. */
export interface MaskInput {
  readonly database: PageDatabase;
  /** The master palette (256 RGB triplets). */
  readonly palette: Uint8Array;
  readonly base: PageInstance | null;
  readonly windows: readonly PageWindow[];
  /** The reference image's size. */
  readonly referenceSize: { readonly width: number; readonly height: number };
  /**
   * The part of the reference the program painted: Wine's client at capture time (the sidecar's
   * `wineClient`), or 634×454 for captures that do not record it.
   */
  readonly painted?: { readonly width: number; readonly height: number };
  /**
   * The page should have moved on by itself (autostart animation, then a `finished` ChangePage)
   * but the reference shows it still, with the animation stopped part-way.
   */
  readonly stalled: boolean;
  /** Pages whose autostart animations moved on to the page on screen, when the capture got there. */
  readonly arrivedFrom: readonly PageInstance[];
  /** Where the reference was still changing at capture time (sidecar), when it cycled. */
  readonly changing: Rect | null;
  /**
   * The X windows, in page coordinates, of the popups whose picture Wine lost (sidecar
   * `whitePopups`); each is matched to the engine's window with the same rectangle.
   */
  readonly whitePopups?: readonly Rect[];
}

/**
 * The first window row Wine leaves white in a popup whose picture it lost: caption rows 0–3 and
 * the shadow are drawn, the rest is white (reference-environments.md, "Popups that stay white").
 */
export const WINE_WHITE_POPUP_TOP = 4;

/** The engine's window whose full rectangle, caption and shadow included, is `rect`. */
export function windowWithRect(windows: readonly PageWindow[], rect: Rect): PageWindow | undefined {
  return windows.find((window) => {
    const { width, height } = windowSize(window);
    return (
      window.x === rect.left &&
      window.y === rect.top &&
      window.x + width === rect.right &&
      window.y + height === rect.bottom
    );
  });
}

/** For each pixel of `rect` (page coordinates), the palette indices some frame paints there. */
export interface FrameColours {
  readonly rect: Rect;
  has(x: number, y: number, index: number): boolean;
}

/** Animations by media name, read through a data source. */
export interface AnimationCatalog {
  /** The union of the frame rectangles in panel coordinates; `null` if missing or imageless. */
  extent(directory: string | null, name: string): Promise<Rect | null>;
  /** The colours the frames paint, placed with panel (0,0) at (x, y) and clipped to `clip`. */
  colours(
    directory: string | null,
    name: string,
    x: number,
    y: number,
    clip: Rect,
  ): Promise<FrameColours | null>;
}

export function animationCatalog(source: DataSource): AnimationCatalog {
  const files = new Map<string, Promise<PicsFile | null>>();
  const read = (directory: string | null, name: string): Promise<PicsFile | null> => {
    const location = resolveMedia(directory, { kind: 'animation', name });
    if (location.kind !== 'file') return Promise.resolve(null);
    const key = location.path.toUpperCase();
    let file = files.get(key);
    if (file === undefined) {
      file = source.read(location.path).then(
        (bytes) => parsePics(bytes, location.path),
        () => null,
      );
      files.set(key, file);
    }
    return file;
  };
  return {
    async extent(directory, name) {
      const file = await read(directory, name);
      return file === null ? null : framesExtent(file);
    },
    async colours(directory, name, x, y, clip) {
      const file = await read(directory, name);
      const extent = file === null ? null : framesExtent(file);
      if (file === null || extent === null) return null;
      const rect = intersect(offset(extent, x, y), clip);
      if (rect === null) return null;
      return frameColours(file, x, y, rect);
    },
  };
}

function framesExtent(file: PicsFile): Rect | null {
  let extent: Rect | null = null;
  for (const { unpackedSize, rect } of file.chunks) {
    if (unpackedSize === 0) continue; // no image; the rectangle holds arbitrary values (pics.md)
    extent = extent === null ? rect : unionRect(extent, rect);
  }
  return extent;
}

/** A 256-bit set of palette indices per pixel of `rect`. */
function frameColours(file: PicsFile, x: number, y: number, rect: Rect): FrameColours {
  const width = rect.right - rect.left;
  const bits = new Uint32Array(8 * width * (rect.bottom - rect.top));
  for (const chunk of file.chunks) {
    const image = unpackPicsImage(chunk);
    if (image === null) continue;
    const left = image.rect.left + x;
    const top = image.rect.top + y;
    for (let py = Math.max(top, rect.top); py < Math.min(top + image.height, rect.bottom); py++) {
      for (let px = Math.max(left, rect.left); px < Math.min(left + image.width, rect.right); px++) {
        const index = image.indices[(py - top) * image.stride + (px - left)]!;
        bits[8 * ((py - rect.top) * width + (px - rect.left)) + (index >> 5)]! |= 1 << (index & 31);
      }
    }
  }
  return {
    rect,
    has(px, py, index) {
      if (px < rect.left || px >= rect.right || py < rect.top || py >= rect.bottom) return false;
      return (
        (bits[8 * ((py - rect.top) * width + (px - rect.left)) + (index >> 5)]! & (1 << (index & 31))) !== 0
      );
    },
  };
}

/** A page on screen: where its content's (0,0) is, in page coordinates of the main client. */
interface PlacedPage {
  readonly page: PageInstance;
  readonly x: number;
  readonly y: number;
}

export async function deriveMasks(input: MaskInput, animations: AnimationCatalog): Promise<Mask[]> {
  const onScreen: PlacedPage[] = [
    ...(input.base === null ? [] : [{ page: input.base, x: 0, y: 0 }]),
    ...input.windows.map((window) => ({ page: window.page, x: window.x, y: window.y + window.caption })),
  ];
  const indicesOf = paletteLookup(input.palette);
  const masks: Mask[] = [];

  /** A mask over the pixels where the reference shows a colour some frame paints there. */
  const animationMask = async (
    reason: Mask['reason'],
    placed: PlacedPage,
    panel: PanelInstance,
    file: string,
    detail: string,
  ): Promise<void> => {
    const x = placed.x + panel.x;
    const y = placed.y + panel.y;
    const clip = { left: x, top: y, right: x + panel.width, bottom: y + panel.height };
    const colours = await animations.colours(placed.page.page.directory, file, x, y, clip);
    if (colours === null) return;
    masks.push({
      reason,
      rect: colours.rect,
      detail: `${detail}, where the reference shows a colour of one of its frames`,
      accepts: (px, py, colour) => indicesOf(colour).some((index) => colours.has(px, py, index)),
    });
  };

  // In captures made before the resize worked, the strips beyond Wine's client stayed black.
  const { width, height } = input.referenceSize;
  const painted = input.painted ?? WINE_VISIBLE;
  const black = [0x000000];
  if (width > painted.width) {
    masks.push({
      reason: 'wineClientStrip',
      rect: { left: painted.width, top: 0, right: width, bottom: height },
      detail: `columns ${painted.width}–${width - 1} where the reference is black`,
      referenceColours: black,
    });
  }
  if (height > painted.height) {
    masks.push({
      reason: 'wineClientStrip',
      rect: { left: 0, top: painted.height, right: width, bottom: height },
      detail: `rows ${painted.height}–${height - 1} where the reference is black`,
      referenceColours: black,
    });
  }

  // Caption strips in Wine's own colours.
  for (const window of input.windows) {
    if (window.caption === 0) continue;
    masks.push({
      reason: 'wineCaptionColour',
      rect: {
        left: window.x,
        top: window.y,
        right: window.x + window.page.width,
        bottom: window.y + window.caption,
      },
      detail: `caption strip of popup ${window.page.ref} where the reference shows Wine's colours`,
      referenceColours: [rgbValue(WINE.frameColour), rgbValue(WINE.activeCaptionColour)],
    });
  }

  // Popups whose picture Wine lost: white from window row 4 to the shadow, across the picture.
  for (const rect of input.whitePopups ?? []) {
    const window = windowWithRect(input.windows, rect);
    if (window === undefined) continue;
    masks.push({
      reason: 'wineWhitePopup',
      rect: {
        left: window.x,
        top: window.y + WINE_WHITE_POPUP_TOP,
        right: window.x + window.page.width,
        bottom: window.y + window.caption + window.page.height,
      },
      detail: `popup ${window.page.ref}, whose picture Wine lost, where the reference is white`,
      referenceColours: [0xffffff],
    });
  }

  // The Index page's text controls: our font differs from Windows' (and Wine's) raster fonts. The
  // scroll bar and the buttons are the program's bitmaps and must match.
  for (const window of input.windows) {
    if (window.page.page.pageType !== 'index') continue;
    for (const control of ['edit', 'list'] as const) {
      const { x, y, width, height } = INDEX_CONTROLS[control];
      const left = window.x + x;
      const top = window.y + window.caption + y;
      masks.push({
        reason: 'indexText',
        rect: { left, top, right: left + width, bottom: top + height },
        detail: `the Index ${control === 'edit' ? 'edit box' : 'list'} of page ${window.page.ref}`,
      });
    }
  }

  // The A–Z dial's lamp.
  for (const { page, x, y } of onScreen) {
    for (const panel of page.panels) {
      if (panel.dial === null) continue;
      const pictures = [panel.dial.lampOnPicture, panel.dial.lampOffPicture];
      const left = x + panel.x + DIAL_POSITIONS.lamp.x;
      const top = y + panel.y + DIAL_POSITIONS.lamp.y;
      masks.push({
        reason: 'azLamp',
        rect: {
          left,
          top,
          right: left + Math.max(...pictures.map((picture) => picture?.width ?? 18)),
          bottom: top + Math.max(...pictures.map((picture) => picture?.height ?? 8)),
        },
        detail: `lamp of A–Z dial panel ${panel.id} on page ${page.ref}`,
      });
    }
  }

  // Movie pages: the panel's on_open SENDMESSAGE starts an AnimationControl.
  for (const placed of onScreen) {
    for (const panel of placed.page.panels) {
      for (const { object, rect } of startedControls(panel)) {
        if (rect !== null) {
          masks.push({
            reason: 'moviePlaying',
            rect: offset(rect, placed.x + panel.x, placed.y + panel.y),
            detail: `AnimationControl ${object.id} strip (its look while playing is not established)`,
          });
        }
        if (object.file !== null) {
          await animationMask('moviePlaying', placed, panel, object.file, `frames of ${object.file}`);
        }
      }
    }
  }

  // Autostart animations on screen: stalled under Wine when they should have moved on.
  for (const placed of onScreen) {
    for (const panel of placed.page.panels) {
      for (const { object } of panel.objects) {
        if (!isAutostart(object) || object.file === null) continue;
        const reason =
          input.stalled && finishedChangePage(object) ? 'wineAnimationStall' : 'autostartAnimation';
        await animationMask(
          reason,
          placed,
          panel,
          object.file,
          `frames of ${object.file} on page ${placed.page.ref}`,
        );
      }
    }
  }

  // The animations that moved on to this page leave frames behind.
  for (const page of input.arrivedFrom) {
    for (const panel of page.panels) {
      for (const { object } of panel.objects) {
        if (!isAutostart(object) || object.file === null || !finishedChangePage(object)) continue;
        await animationMask(
          'animationLeftover',
          { page, x: 0, y: 0 },
          panel,
          object.file,
          `frames of ${object.file} from page ${page.ref}`,
        );
      }
    }
  }

  if (input.changing !== null) {
    masks.push({ reason: 'referenceChanging', rect: input.changing, detail: 'sidecar settle.changingRect' });
  }
  return masks;
}

type AnimatedObject = Extract<DisplayObject, { kind: 'animHotspot' | 'azAnimHotspot' }>;

/** Flag `0x20`: the animation starts when the page opens (rendering.md §5). */
function isAutostart(object: DisplayObject): object is AnimatedObject {
  return (object.kind === 'animHotspot' || object.kind === 'azAnimHotspot') && (object.flags & 0x20) !== 0;
}

function finishedChangePage(object: AnimatedObject): boolean {
  return object.handlers.some(
    (handler) =>
      handler.event === HandlerEvent.Finished &&
      handler.actions.some((action) => action.kind === 'changePage'),
  );
}

/**
 * The AnimationControls a panel's on_open SENDMESSAGE handlers address: the control whose object
 * id is the message's target (181 on the disc), or every control of the panel if none is.
 */
function startedControls(panel: PanelInstance) {
  const messages = (panel.panel?.handlers ?? [])
    .filter((handler) => handler.event === HandlerEvent.Open)
    .flatMap((handler) => handler.actions)
    .filter((action) => action.kind === 'sendMessage');
  if (messages.length === 0) return [];
  const controls = panel.objects.flatMap(({ object, rect }) =>
    object.kind === 'animationControl' ? [{ object, rect }] : [],
  );
  const addressed = controls.filter(({ object }) => messages.some((message) => message.target === object.id));
  return addressed.length > 0 ? addressed : controls;
}

/** The palette indices showing each `0xRRGGBB` colour. */
function paletteLookup(palette: Uint8Array): (colour: number) => readonly number[] {
  const map = new Map<number, number[]>();
  for (let index = 0; index < 256; index++) {
    const colour = (palette[index * 3]! << 16) | (palette[index * 3 + 1]! << 8) | palette[index * 3 + 2]!;
    const list = map.get(colour);
    if (list === undefined) map.set(colour, [index]);
    else list.push(index);
  }
  return (colour) => map.get(colour) ?? [];
}

function offset(rect: Rect, x: number, y: number): Rect {
  return { left: rect.left + x, top: rect.top + y, right: rect.right + x, bottom: rect.bottom + y };
}

function unionRect(a: Rect, b: Rect): Rect {
  return {
    left: Math.min(a.left, b.left),
    top: Math.min(a.top, b.top),
    right: Math.max(a.right, b.right),
    bottom: Math.max(a.bottom, b.bottom),
  };
}

function intersect(a: Rect, b: Rect): Rect | null {
  const rect = {
    left: Math.max(a.left, b.left),
    top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom),
  };
  return rect.left < rect.right && rect.top < rect.bottom ? rect : null;
}

function rgbValue({ red, green, blue }: Rgb): number {
  return (red << 16) | (green << 8) | blue;
}
