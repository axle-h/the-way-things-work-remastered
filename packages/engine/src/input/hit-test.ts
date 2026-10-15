/**
 * Which part of a window, which panel and which object a point falls on (behaviour.md §1.2–1.3,
 * §5). Every rectangle includes all four of its edges.
 */
import type { Rect } from '@twtw/formats';
import type { PageInstance, PanelInstance } from '../page.ts';

/** Parts of a popup window: its client area, and the caption strip and shadow the program draws. */
export type WindowArea = 'client' | 'caption' | 'systemBox' | 'shadow';

/** Width of the system box at the left of the caption strip (behaviour.md §5). */
export const SYSTEM_BOX_WIDTH = 12;

/** Inclusive containment: left ≤ x ≤ right and top ≤ y ≤ bottom. */
export function rectContains(rect: Rect, x: number, y: number): boolean {
  return rect.left <= x && x <= rect.right && rect.top <= y && y <= rect.bottom;
}

/**
 * Classifies a point in a popup window, in window coordinates (behaviour.md §5): the shadow bands
 * (right and bottom, corners included), then the caption rows 0 to `caption` (the strip plus the
 * picture's first row, a quirk of the original), whose first 12 columns are the system box.
 */
export function classifyWindowPoint(
  window: { readonly caption: number; readonly shadow: number; readonly page: PageInstance },
  x: number,
  y: number,
): WindowArea {
  const { caption, shadow, page } = window;
  const width = page.width + shadow;
  const height = caption + page.height + shadow;
  if (shadow > 0 && (x >= width - shadow || y >= height - shadow)) return 'shadow';
  if (caption > 0 && y <= caption) return x < SYSTEM_BOX_WIDTH ? 'systemBox' : 'caption';
  return 'client';
}

/**
 * The first panel, in panel-list order, whose rectangle (x, y, x + width, y + height) contains the
 * point, in the page's content coordinates.
 */
export function panelAt(page: PageInstance, x: number, y: number): PanelInstance | null {
  for (const panel of page.panels) {
    const rect = {
      left: panel.x,
      top: panel.y,
      right: panel.x + panel.width,
      bottom: panel.y + panel.height,
    };
    if (rectContains(rect, x, y)) return panel;
  }
  return null;
}

/**
 * The index of the last object, in data order, whose rectangle (after loading) contains the point,
 * in panel coordinates; −1 for none.
 */
export function objectAt(panel: PanelInstance, x: number, y: number): number {
  for (let index = panel.objects.length - 1; index >= 0; index--) {
    const rect = panel.objects[index]!.rect;
    if (rect !== null && rectContains(rect, x, y)) return index;
  }
  return -1;
}
