/**
 * Popup and index windows (rendering.md §7): borderless windows over the main window, drawn by
 * the program itself with an 8-pixel caption strip above the picture and a stippled drop shadow
 * to the right and below.
 */
import type { PageDatabase, Point, Rgb, Template } from '@twtw/formats';
import { paletteIndexOf, StaticColour } from '../colours.ts';
import type { PageInstance } from '../page.ts';
import type { IndexedCanvas } from './canvas.ts';
import { paintPage } from './paint.ts';

/**
 * How the original's surroundings looked: the window manager decides where popups land, the
 * caption colours, and what shows through the shadow.
 */
export interface Presentation {
  readonly name: PresentationName;
  /** The main window's outer top-left relative to its client area's top-left (page (0,0)). */
  readonly frameOffset: Point;
  /**
   * Where page (0,0) is on the screen. Only the zoom effect needs it: it interpolates in screen
   * coordinates, truncating each product (behaviour.md §4.2).
   */
  readonly clientScreenOrigin: Point;
  /** `GetSystemMetrics(SM_CYCAPTION)`, added to a popup's position when it opens. */
  readonly captionHeight: number;
  /** The caption strip's frame colour, and the active and inactive caption fill. */
  readonly frameColour: Rgb;
  readonly activeCaptionColour: Rgb;
  readonly inactiveCaptionColour: Rgb;
  /**
   * What the shadow strips show before the stipple: `'below'` keeps what is underneath (the base
   * page and lower popups), `'white'` fills them with white first, as under Wine.
   */
  readonly shadowBackground: 'below' | 'white';
  /** Shadow pixels whose page `(x + y) % 2` equals this become black (index 0). */
  readonly shadowBlackParity: 0 | 1;
}

export type PresentationName = 'win31' | 'wine';

/** Windows 3.1 at 640×480 with the default colour scheme (rendering.md §7.2–7.4). */
export const WIN31: Presentation = {
  name: 'win31',
  frameOffset: { x: -1, y: -20 },
  // The 640×480 main window is centred on a 640×480 screen.
  clientScreenOrigin: { x: 1, y: 20 },
  captionHeight: 20,
  frameColour: rgb(0x000000),
  activeCaptionColour: rgb(0x000080),
  inactiveCaptionColour: rgb(0xffffff),
  shadowBackground: 'below',
  shadowBlackParity: 0,
};

/**
 * Wine, as in the reference captures (rendering.md §7.2–7.4, §10): popups land (−2, −3) from the
 * Windows 3.1 position, and the shadow is a stipple over white with the opposite parity.
 *
 * Wine's frame and active caption colours (`9E9E9E`, `3296FA`) are not in the palette, so they
 * cannot be drawn into an indexed framebuffer: the nearest entries stand in for them, and a
 * comparison must treat those pixels as expected differences. Its inactive caption colour,
 * `808080`, is palette index 248.
 */
export const WINE: Presentation = {
  name: 'wine',
  frameOffset: { x: -3, y: -23 },
  // Where the reference captures found the client area (tools/refcapture).
  clientScreenOrigin: { x: 195, y: 195 },
  captionHeight: 20,
  frameColour: rgb(0x9e9e9e),
  activeCaptionColour: rgb(0x3296fa),
  inactiveCaptionColour: rgb(0x808080),
  shadowBackground: 'white',
  shadowBlackParity: 1,
};

export const PRESENTATIONS: Readonly<Record<PresentationName, Presentation>> = { win31: WIN31, wine: WINE };

function rgb(value: number): Rgb {
  return { red: value >> 16, green: (value >> 8) & 0xff, blue: value & 0xff };
}

/** A presentation's caption colours as palette indices. */
export interface CaptionColours {
  readonly frame: number;
  readonly active: number;
  readonly inactive: number;
}

export function captionColours(presentation: Presentation, palette: Uint8Array): CaptionColours {
  return {
    frame: paletteIndexOf(palette, presentation.frameColour),
    active: paletteIndexOf(palette, presentation.activeCaptionColour),
    inactive: paletteIndexOf(palette, presentation.inactiveCaptionColour),
  };
}

/** Height of the caption strip when the template asks for one. */
export const CAPTION_STRIP_HEIGHT = 8;

/** The caption rectangle's left edge in window coordinates; the system box is left of it. */
export const CAPTION_RECT_LEFT = 11;

/** A popup or index page in its own window. */
export interface PageWindow {
  readonly page: PageInstance;
  /** The window's top-left, in page coordinates. */
  readonly x: number;
  readonly y: number;
  /** Caption strip height: 8, or 0 when the template has no caption. */
  readonly caption: number;
  /** Drop-shadow width. */
  readonly shadow: number;
  /**
   * The window that owns this one: the window of the page that was active when it opened, another
   * popup or `null` for the main window (behaviour.md §4.1). Closing a window closes those it owns.
   */
  readonly owner: PageWindow | null;
  /** Whether it takes the focus when it opens or is pressed (template no-focus flag 0). */
  readonly focusable: boolean;
  /**
   * Per column (window x) of the picture's first row, 1 where a caption drawn again after the
   * picture left its rectangle's black bottom border (rendering.md §7.3); `null` where none did.
   */
  readonly captionLine: Uint8Array | null;
}

/** Template fields that shape a window (rendering.md §7.1). */
export function windowStyle(template: Template): { caption: number; shadow: number; focusable: boolean } {
  return {
    caption: template.unknown3 !== 0 ? CAPTION_STRIP_HEIGHT : 0,
    shadow: Math.max(0, template.unknown4),
    focusable: template.unknown5 === 0,
  };
}

/**
 * The position of the reference panel named by a template's flag A block (template id, panel id),
 * which popup origins are relative to: (94,4) on the disc. (0,0) when there is none.
 */
export function referencePanelPosition(database: PageDatabase, template: Template): Point {
  if (template.unknown1 === null) return { x: 0, y: 0 };
  const [templateId, panelId] = template.unknown1;
  const slot = database.product.templates
    .find((candidate) => candidate.id === templateId)
    ?.panels.find((candidate) => candidate.panelId === panelId);
  return slot === undefined ? { x: 0, y: 0 } : { x: slot.x, y: slot.y };
}

/**
 * Where a window opens (rendering.md §7.2): the main window's outer top-left + the reference
 * panel's position + the page origin + the caption height. With `opening` false, as when a
 * ChangePage resizes an existing popup window (§7.7), the caption height is left out.
 */
export function windowPosition(
  database: PageDatabase,
  page: PageInstance,
  presentation: Presentation,
  opening = true,
): Point {
  const reference = referencePanelPosition(database, page.template);
  return {
    x: presentation.frameOffset.x + reference.x + page.page.origin.x,
    y:
      presentation.frameOffset.y +
      reference.y +
      page.page.origin.y +
      (opening ? presentation.captionHeight : 0),
  };
}

/** The window's full size: picture plus shadow, by caption plus picture plus shadow. */
export function windowSize(window: Pick<PageWindow, 'page' | 'caption' | 'shadow'>): {
  width: number;
  height: number;
} {
  return {
    width: window.page.width + window.shadow,
    height: window.caption + window.page.height + window.shadow,
  };
}

/**
 * Draws a window over what is already in the canvas (page coordinates): the shadow, the caption
 * strip, the page's panels below the strip, then the line a redrawn caption left on the picture.
 */
export function drawWindow(
  canvas: IndexedCanvas,
  window: PageWindow,
  active: boolean,
  presentation: Presentation,
  colours: CaptionColours,
): void {
  const { x, y, caption, shadow, page } = window;
  const { width: total, height: totalHeight } = windowSize(window);
  const frame = canvas.view(x, y, total, totalHeight);

  if (shadow > 0) {
    if (presentation.shadowBackground === 'white') {
      // The strips the window uncovers while it shrinks, corners included.
      frame.fill(page.width, 0, shadow, totalHeight, StaticColour.white);
      frame.fill(0, caption + page.height, total, shadow, StaticColour.white);
    }
    const parity = presentation.shadowBlackParity;
    const stipple = (index: number, px: number, py: number): number =>
      (px + py) % 2 === parity ? StaticColour.black : index;
    frame.map(total - shadow, shadow, shadow, totalHeight - shadow, stipple);
    frame.map(shadow, totalHeight - shadow, total - 2 * shadow, shadow, stipple);
  }

  if (caption > 0) {
    drawCaptionStrip(frame, page.width, active ? colours.active : colours.inactive, colours.frame);
  }

  paintPage(frame.view(0, caption, page.width, page.height), page);

  const line = window.captionLine;
  if (caption > 0 && line !== null) {
    for (let column = CAPTION_RECT_LEFT; column < Math.min(page.width, line.length); column++) {
      if (line[column] !== 0) frame.fill(column, caption, 1, 1, StaticColour.black);
    }
  }
}

/**
 * The 8-pixel caption strip (rendering.md §7.3), in window coordinates, for a picture `width`
 * wide. Row 8 of the bordered rectangle is drawn too; the picture covers it.
 */
function drawCaptionStrip(canvas: IndexedCanvas, width: number, fill: number, frame: number): void {
  const black = StaticColour.black;
  // Rectangle (11,0)–(width,9), exclusive, with a 1-pixel black pen, filled with the caption colour.
  canvas.fill(CAPTION_RECT_LEFT, 0, width - CAPTION_RECT_LEFT, 9, black);
  canvas.fill(12, 1, width - 13, 7, fill);
  // The system box.
  canvas.fill(0, 0, 12, 1, frame);
  canvas.fill(0, 0, 1, 8, frame);
  canvas.fill(1, 1, 11, 7, StaticColour.lightGrey);
  canvas.fill(12, 1, 1, 7, frame);
  canvas.fill(4, 4, 7, 3, StaticColour.darkGrey);
  canvas.fill(3, 3, 7, 3, black);
  canvas.fill(4, 4, 5, 1, StaticColour.white);
}
