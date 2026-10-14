/**
 * Painting panels and their objects at rest (rendering.md §3, §5, §6).
 */
import {
  DIAL_POSITIONS,
  type DialState,
  type PageInstance,
  type PanelInstance,
  type PlacedObject,
} from '../page.ts';
import type { IndexedImage } from '../screen.ts';
import type { IndexedCanvas } from './canvas.ts';

/** Paints every panel of a page, in panel-list order; `canvas` has the page's content origin. */
export function paintPage(canvas: IndexedCanvas, page: PageInstance): void {
  for (const panel of page.panels) {
    paintPanel(canvas.view(panel.x, panel.y, panel.width, panel.height), panel);
  }
}

/**
 * Paints one panel into a canvas whose origin is the panel's top-left and which clips to the
 * panel: fill with the panel colour, then draw the objects in data order (later ones on top).
 */
export function paintPanel(canvas: IndexedCanvas, panel: PanelInstance): void {
  canvas.fill(0, 0, panel.width, panel.height, panel.colour);
  for (const placed of panel.objects) drawObject(canvas, placed);
  if (panel.dial !== null) drawDial(canvas, panel.dial);
}

function drawObject(canvas: IndexedCanvas, { rect, look }: PlacedObject): void {
  if (rect === null || look === null) return;
  switch (look.kind) {
    case 'picture':
    case 'button':
      if (look.picture !== null) canvas.draw(look.picture, rect.left, rect.top);
      break;
    case 'scrollBitmap':
      // The rectangle's size of the picture, from row (scroll position) 0, column 0.
      if (look.picture !== null) {
        canvas.draw(look.picture, rect.left, rect.top, 0, 0, rect.right - rect.left, rect.bottom - rect.top);
      }
      break;
    case 'scrollBar':
      drawScrollBar(canvas, rect, look.parts, 0);
      break;
  }
}

/**
 * A scroll bar for the rectangle (L, T, R, B), with the thumb `offset` pixels below the top of
 * the track (rendering.md §5). Parts in data order: up arrow, down arrow, thumb, track, then the
 * four pressed variants.
 */
export function drawScrollBar(
  canvas: IndexedCanvas,
  rect: { left: number; top: number; right: number; bottom: number },
  parts: readonly (IndexedImage | null)[],
  offset: number,
): void {
  const [up = null, down = null, thumb = null, track = null] = parts;
  const width = rect.right - rect.left;
  const trackTop = rect.top + (up?.height ?? 0);
  const trackBottom = rect.bottom - (down?.height ?? 0);
  const thumbTop = trackTop + offset;
  const thumbBottom = thumbTop + (thumb?.height ?? 0);
  if (thumb !== null) canvas.draw(thumb, rect.left, thumbTop, 0, 0, width, thumb.height);
  if (track !== null) {
    canvas.draw(track, rect.left, trackTop, 0, 0, width, thumbTop - trackTop);
    canvas.draw(track, rect.left, thumbBottom, 0, thumbBottom - trackTop, width, trackBottom - thumbBottom);
  }
  if (up !== null) canvas.draw(up, rect.left, rect.top);
  if (down !== null) canvas.draw(down, rect.left, rect.bottom - down.height);
}

/**
 * The A–Z dial's current letter picture, its lamp and, after "go", the pressed go button, after
 * the normal panel paint. The button covers the lamp until the lamp's next tick draws over it.
 */
function drawDial(canvas: IndexedCanvas, dial: DialState): void {
  const letter = dial.letters[dial.letter] ?? null;
  if (letter !== null) canvas.draw(letter, DIAL_POSITIONS.letter.x, DIAL_POSITIONS.letter.y);
  const lamp = dial.lampOn ? dial.lampOnPicture : dial.lampOffPicture;
  const drawLamp = (): void => {
    if (lamp !== null) canvas.draw(lamp, DIAL_POSITIONS.lamp.x, DIAL_POSITIONS.lamp.y);
  };
  const drawGo = (): void => {
    if (dial.goPressed && dial.goPicture !== null)
      canvas.draw(dial.goPicture, DIAL_POSITIONS.go.x, DIAL_POSITIONS.go.y);
  };
  if (dial.lampOverGo) {
    drawGo();
    drawLamp();
  } else {
    drawLamp();
    drawGo();
  }
}
