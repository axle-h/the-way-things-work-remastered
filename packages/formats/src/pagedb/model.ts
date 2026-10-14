/**
 * Typed model of the page database (`DKCODE/TWTW.PNG`), as specified in
 * docs/formats/page-database.md. Field names are ours; fields whose meaning is not known are kept
 * as `unknownN` so that nothing in the file is dropped.
 *
 * String-table references (`str`) are resolved to their text, or `null` for index 0 ("no string").
 * The string table holds no duplicates on the disc, so the index can be recovered from the text.
 */

/** Byte offset of a page or shared panel from the start of the page heap. */
export type PageRef = number;

export interface Rect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface Rgb {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

// ---------------------------------------------------------------------------------------------
// Header records

export interface Product {
  readonly title: string | null;
  readonly width: number;
  readonly height: number;
  readonly version: string | null;
  readonly defaultCursor: string | null;
  readonly backgroundColour: Rgb;
  readonly unknown1: number;
  /** The first page shown (the title screen). */
  readonly startupPage: PageRef | null;
  readonly templates: readonly Template[];
  /** Product-level event handlers. */
  readonly handlers: readonly Handler[];
}

export type PageType = 'popup' | 'base' | 'index' | 'child';

export interface Template {
  /** The page type this template applies to. */
  readonly pageType: PageType;
  /** Matched against {@link Page.templateId}. */
  readonly id: number;
  /** Flag A block: present when its `u16` flag is set. */
  readonly unknown1: readonly [number, number] | null;
  readonly unknown2: number;
  readonly width: number;
  readonly height: number;
  /** Flag B block (x, y): present when its `u16` flag is set. */
  readonly position: Point | null;
  readonly unknown3: number;
  readonly unknown4: number;
  readonly unknown5: number;
  readonly unknown6: number;
  /** Flag C block: present when its `u16` flag is set. */
  readonly unknownRect: Rect | null;
  /** [H] panel ids; on this disc popup and index templates list the base template's panels. */
  readonly unknownList1: readonly number[];
  readonly unknownList2: readonly number[];
  readonly panels: readonly PanelRef[];
  readonly handlers: readonly Handler[];
}

/** A panel slot of a template: where the panel goes and, for shared panels, where it is. */
export interface PanelRef {
  readonly panelType: PanelType;
  readonly panelId: number;
  /** Heap offset of the shared panel filling this slot, or `null` when the page supplies it. */
  readonly sharedPanel: PageRef | null;
  readonly colour: Rgb;
  readonly width: number;
  readonly height: number;
  /** Screen position of the panel; object rectangles inside it are relative to this. */
  readonly x: number;
  readonly y: number;
}

/** An entry of the A–Z index. */
export interface IndexEntry {
  readonly name: string | null;
  readonly nameLength: number;
  readonly unknown1: number;
  readonly page: PageRef | null;
  readonly seeAlso: readonly (PageRef | null)[];
}

// ---------------------------------------------------------------------------------------------
// Page heap

export interface Page {
  /** Heap offset of this page. */
  readonly ref: PageRef;
  /** Bytes the page occupies in the heap. */
  readonly byteLength: number;
  readonly pageType: PageType;
  readonly templateId: number;
  /** Screen position of a popup page. */
  readonly origin: Point;
  /** Media folder for the page's files, e.g. `\ARTICLE1\AIRP\`. */
  readonly directory: string | null;
  readonly panels: readonly Panel[];
  readonly handlers: readonly Handler[];
  /** [H] four related pages (perhaps previous, next, up, see also); `null` when absent. */
  readonly links: readonly [PageRef | null, PageRef | null, PageRef | null, PageRef | null] | null;
}

/** A panel stored on its own in the heap and referenced by templates (navigation bar, frame). */
export interface SharedPanel {
  readonly ref: PageRef;
  readonly byteLength: number;
  /** The leading `i16`, ignored by the program; 0 on the disc. */
  readonly unknown1: number;
  readonly panel: Panel;
}

export type PanelType = 'display' | 'azDial' | 'navPanel';

interface PanelCommon {
  readonly id: number;
  readonly objects: readonly DisplayObject[];
  readonly handlers: readonly Handler[];
}

export interface DisplayPanel extends PanelCommon {
  readonly kind: 'display';
}

/** The A–Z machine's dial: one target page and one name per letter A–Z. */
export interface AzDialPanel extends PanelCommon {
  readonly kind: 'azDial';
  readonly letterPages: readonly (PageRef | null)[];
  /** [H] one animation per letter (`AZAZ0MAA` …), played when the letter is chosen. */
  readonly letterAnimations: readonly (string | null)[];
}

/** The navigation bar: nine buttons, each with a value and a target page. */
export interface NavPanel extends PanelCommon {
  readonly kind: 'navPanel';
  /** [H] the object id of each button's NavHotspot. */
  readonly buttonIds: readonly number[];
  readonly buttonPages: readonly (PageRef | null)[];
}

export type Panel = DisplayPanel | AzDialPanel | NavPanel;

// ---------------------------------------------------------------------------------------------
// Display objects

/** Fields shared by every object type except the two scroll objects. */
interface ObjectCommon {
  readonly id: number;
  readonly flags: number;
  /** Panel-relative rectangle; `null` when `flags & 0x100` is set (never on the disc). */
  readonly rect: Rect | null;
  readonly cursor: string | null;
  readonly handlers: readonly Handler[];
}

export interface BitmapObject extends ObjectCommon {
  readonly kind: 'bitmap';
  /** Picture file (`.DIB`). */
  readonly file: string | null;
}

export interface AnimationControlObject extends ObjectCommon {
  readonly kind: 'animationControl';
  readonly unknown1: number;
  readonly unknownRect: Rect;
  /** Animation file (`.ANI`). */
  readonly file: string | null;
  readonly unknownCursor: string | null;
  readonly unknown2: number;
  readonly unknown3: number;
  readonly unknown4: number;
}

export interface HotspotObject extends ObjectCommon {
  readonly kind: 'hotspot';
  readonly unknown1: number;
}

export interface AzHotspotObject extends ObjectCommon {
  readonly kind: 'azHotspot';
  readonly unknown1: number;
  readonly unknown2: number;
}

export interface WordBoxObject extends ObjectCommon {
  readonly kind: 'wordBox';
}

export interface NavHotspotObject extends ObjectCommon {
  readonly kind: 'navHotspot';
  /** Animation file (`.ANI`). */
  readonly file: string | null;
  readonly unknown1: number;
}

export interface AnimHotspotObject extends ObjectCommon {
  readonly kind: 'animHotspot';
  /** Animation file (`.ANI`). */
  readonly file: string | null;
  readonly unknown1: number;
}

export interface AzAnimHotspotObject extends ObjectCommon {
  readonly kind: 'azAnimHotspot';
  /** Animation file (`.ANI`). */
  readonly file: string | null;
  readonly unknown1: number;
}

export interface CancelButtonObject extends ObjectCommon {
  readonly kind: 'cancelButton';
  readonly unknownStrings: readonly [string | null, string | null, string | null];
}

/** Fields shared by the two scroll objects, which have no flags and no handlers. */
interface ScrollCommon {
  readonly id: number;
  readonly rect: Rect;
  readonly cursor: string | null;
  readonly unknown1: number;
  /** [H] the id of the partner object (scroll bar ↔ scrolled bitmap). */
  readonly unknown2: number;
  readonly unknown3: number;
  readonly unknown4: number;
  readonly unknown5: number;
}

export interface ScrollBitmapObject extends ScrollCommon {
  readonly kind: 'scrollBitmap';
  /** Picture file (`.DIB`), taller than `rect`. */
  readonly file: string | null;
}

export interface ScrollBarObject extends ScrollCommon {
  readonly kind: 'scrollBar';
  /** Eight part bitmaps; `@NAME` is a bitmap resource in `TWTW.EXE`. */
  readonly parts: readonly (string | null)[];
}

export type DisplayObject =
  | BitmapObject
  | AnimationControlObject
  | HotspotObject
  | AzHotspotObject
  | WordBoxObject
  | NavHotspotObject
  | AnimHotspotObject
  | CancelButtonObject
  | ScrollBitmapObject
  | ScrollBarObject
  | AzAnimHotspotObject;

export type DisplayObjectKind = DisplayObject['kind'];

// ---------------------------------------------------------------------------------------------
// Handlers and actions

/** Event codes of {@link Handler.event}. */
export const HandlerEvent = {
  Open: 1,
  AppActivated: 2,
  Close: 3,
  Click: 4,
  BeforeOpen: 5,
  /** An animation ended. */
  Finished: 6,
} as const;

export interface Handler {
  /** One of {@link HandlerEvent}; kept as a number so unexpected codes survive. */
  readonly event: number;
  readonly actions: readonly Action[];
}

/** Replace the base page. */
export interface ChangePageAction {
  readonly kind: 'changePage';
  readonly page: PageRef | null;
  readonly unknown1: number;
}

/** Show a popup over the current base page. */
export interface OpenPageAction {
  readonly kind: 'openPage';
  readonly page: PageRef | null;
  readonly unknown1: number;
}

export interface ClosePageAction {
  readonly kind: 'closePage';
  readonly page: PageRef | null;
}

export interface SendMessageAction {
  readonly kind: 'sendMessage';
  readonly message: number;
  readonly parameter: number;
}

export interface PlayWaveAction {
  readonly kind: 'playWave';
  /** Sound file (`.WAV`). */
  readonly file: string | null;
  readonly unknown1: number;
  readonly unknown2: number;
  readonly unknown3: number;
  readonly unknown4: number;
  readonly unknown5: number;
}

export interface StopWaveAction {
  readonly kind: 'stopWave';
  readonly name: string | null;
}

export interface SeekWaveAction {
  readonly kind: 'seekWave';
}

/** Fields of the three animation-playing actions. */
interface PlayPicsFields {
  /** Animation file (`.ANI`). */
  readonly file: string | null;
  readonly unknown1: number;
  readonly unknown2: number;
  readonly unknown3: number;
  readonly unknown4: number;
  readonly unknown5: number;
}

export interface PlayPicsAction extends PlayPicsFields {
  readonly kind: 'playPics';
}

export interface PlayPicsNoLoadAction extends PlayPicsFields {
  readonly kind: 'playPicsNoLoad';
}

export interface PlayNonQueuedPicsAction extends PlayPicsFields {
  readonly kind: 'playNonQueuedPics';
}

export interface StopPicsAction {
  readonly kind: 'stopPics';
  readonly name: string | null;
}

export interface SeekPicsAction {
  readonly kind: 'seekPics';
}

/** Product-specific behaviour (the Options screen), program keyword `TWTWOPTION`. */
export interface ProductOptionAction {
  readonly kind: 'productOption';
  readonly option: number;
}

export type Action =
  | OpenPageAction
  | SendMessageAction
  | ChangePageAction
  | PlayWaveAction
  | StopWaveAction
  | SeekWaveAction
  | PlayPicsAction
  | PlayPicsNoLoadAction
  | PlayNonQueuedPicsAction
  | StopPicsAction
  | ProductOptionAction
  | ClosePageAction
  | SeekPicsAction;

export type ActionKind = Action['kind'];

// ---------------------------------------------------------------------------------------------
// Type codes as stored in the file

export const PAGE_TYPE_CODES: Readonly<Record<PageType, number>> = {
  popup: 101,
  base: 102,
  index: 103,
  child: 104,
};

export const PANEL_TYPE_CODES: Readonly<Record<PanelType, number>> = {
  display: 201,
  azDial: 202,
  navPanel: 203,
};

export const OBJECT_TYPE_CODES: Readonly<Record<DisplayObjectKind, number>> = {
  bitmap: 601,
  animationControl: 602,
  hotspot: 603,
  azHotspot: 604,
  wordBox: 605,
  navHotspot: 606,
  animHotspot: 607,
  cancelButton: 608,
  scrollBitmap: 609,
  scrollBar: 610,
  azAnimHotspot: 611,
};

export const ACTION_TYPE_CODES: Readonly<Record<ActionKind, number>> = {
  openPage: 1,
  sendMessage: 2,
  changePage: 3,
  playWave: 4,
  stopWave: 5,
  seekWave: 6,
  playPics: 7,
  playPicsNoLoad: 8,
  playNonQueuedPics: 9,
  stopPics: 10,
  productOption: 11,
  closePage: 12,
  seekPics: 13,
};
