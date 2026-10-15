/**
 * What the engine does with each type the page database defines (special-screens.md §8, the
 * Phase 6 coverage table): every page, panel, object, action and event type, and the template
 * fields, is implemented or consciously dropped. Corpus tests check that every type occurring on
 * the disc is implemented.
 */
import type { ActionKind, DisplayObjectKind, PageType, PanelType } from '@twtw/formats';

export type Support = 'implemented' | 'dropped';

export interface TypeSupport {
  readonly support: Support;
  /** Where it is specified, or why it is dropped. */
  readonly note: string;
  /** Dropped although the disc uses it: the original does nothing with it either. */
  readonly noEffect?: boolean;
}

const implemented = (note: string): TypeSupport => ({ support: 'implemented', note });
const dropped = (note: string): TypeSupport => ({ support: 'dropped', note });

export const PAGE_TYPE_SUPPORT: Readonly<Record<PageType, TypeSupport>> = {
  popup: implemented('rendering.md §7, behaviour.md'),
  base: implemented('rendering.md, behaviour.md'),
  index: implemented('special-screens.md §1'),
  child: dropped('a child window; none on the disc. Opening or changing to one fails (actionFailed)'),
};

export const PANEL_TYPE_SUPPORT: Readonly<Record<PanelType, TypeSupport>> = {
  display: implemented('rendering.md §3'),
  azDial: implemented('rendering.md §6, behaviour.md §7'),
  navPanel: implemented('behaviour.md §6'),
};

export const OBJECT_TYPE_SUPPORT: Readonly<Record<DisplayObjectKind, TypeSupport>> = {
  bitmap: implemented('rendering.md §4'),
  animationControl: implemented('rendering.md §5, playback.md §7'),
  hotspot: implemented('behaviour.md §3; the pressed highlight styles 1–4 are dropped (style 0 everywhere)'),
  azHotspot: implemented('behaviour.md §7'),
  wordBox: implemented('behaviour.md §1.3: invisible, catches panel pixel (0,0) only'),
  navHotspot: implemented('behaviour.md §6'),
  animHotspot: implemented('playback.md §6'),
  cancelButton: implemented('special-screens.md §4.2'),
  scrollBitmap: implemented('special-screens.md §3'),
  scrollBar: implemented('special-screens.md §3'),
  azAnimHotspot: implemented('none on the disc; handled as an AnimHotspot'),
};

export const ACTION_TYPE_SUPPORT: Readonly<Record<ActionKind, TypeSupport>> = {
  openPage: implemented('behaviour.md §4.1, §4.2 (zoom)'),
  sendMessage: implemented('behaviour.md §4.5'),
  changePage: implemented('behaviour.md §4.3; the transition id is dropped (0 on the whole disc)'),
  playWave: implemented('playback.md §4'),
  stopWave: implemented('playback.md §4; none on the disc'),
  seekWave: implemented('playback.md §4 (does nothing); none on the disc'),
  playPics: implemented('playback.md §4'),
  playPicsNoLoad: implemented('playback.md §4; none on the disc'),
  playNonQueuedPics: implemented('playback.md §4; none on the disc'),
  stopPics: implemented('playback.md §4; none on the disc'),
  productOption: implemented(
    'special-screens.md §4: the copy and print picture; the web app copies and prints it (§4.8)',
  ),
  closePage: implemented('behaviour.md §4.4'),
  seekPics: implemented('playback.md §4; none on the disc'),
};

/** Handler event codes (behaviour.md §2.1). Other codes never fire. */
export const EVENT_SUPPORT: Readonly<Record<number, TypeSupport>> = {
  1: implemented('open: pages and panels (rendering.md §8)'),
  2: dropped('app activated: no handler on the disc, and when the original fires it is not established'),
  3: dropped('close: no handler on the disc, and when the original fires it is not established'),
  4: implemented('click (behaviour.md §3)'),
  5: implemented('before open: popup pages (rendering.md §8)'),
  6: implemented('finished: AnimHotspot animations (playback.md §6)'),
};

/** Template fields (rendering.md §7.1), by the model's field name. */
export const TEMPLATE_FIELD_SUPPORT: Readonly<Record<string, TypeSupport>> = {
  unknown1: implemented('flag A: the reference panel popup origins are relative to'),
  unknown2: dropped('centre the window: 0 on the disc'),
  size: implemented('fixed content size (template 2108)'),
  position: dropped('flag B, a fixed origin: never set'),
  unknown3: implemented('the 8-pixel caption strip'),
  unknown4: implemented('the drop shadow width'),
  unknown5: implemented('no focus: 0 on the disc'),
  unknown6: dropped('centre in the main client area: 0 on the disc'),
  unknownRect: dropped('flag C, centre in a rectangle: never set'),
  unknownList1: { ...dropped('read and freed by the original, no other use found'), noEffect: true },
  unknownList2: { ...dropped('no use found'), noEffect: true },
  handlers: implemented('template handlers run after the page’s (behaviour.md §2.2); none on the disc'),
};

/**
 * Whether a template field holds a value: anything but its unused default (0, `null` or an empty
 * list).
 */
export function templateFieldInUse(value: unknown): boolean {
  if (value === null || value === 0) return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}
