/**
 * Painting panels and their objects at rest (rendering.md §3, §5, §6).
 */
import {
  CONTROL_HEIGHT,
  CONTROL_PARTS,
  CONTROL_PROGRESS,
  CONTROL_WIDTH,
  DIAL_POSITIONS,
  type ControlStrip,
  type DialState,
  type PageInstance,
  type PanelInstance,
  type PlacedObject,
} from '../page.ts';
import type { IndexedImage } from '../screen.ts';
import { scrollBarLayout, scrollPictureRow, SCROLL_PART_SIZE, type ScrollPart } from '../special/scroll.ts';
import type { IndexedCanvas } from './canvas.ts';

export interface PaintOptions {
  /**
   * Only what the panels paint themselves, as for a copied or printed picture
   * (special-screens.md §4.4): no animation frames and no A–Z lamp or pressed "go" button.
   */
  readonly atRest?: boolean;
}

/** Paints every panel of a page, in panel-list order; `canvas` has the page's content origin. */
export function paintPage(canvas: IndexedCanvas, page: PageInstance, options: PaintOptions = {}): void {
  for (const panel of page.panels) {
    paintPanel(canvas.view(panel.x, panel.y, panel.width, panel.height), panel, options);
  }
}

/**
 * Paints one panel into a canvas whose origin is the panel's top-left and which clips to the
 * panel: fill with the panel colour, then draw the objects in data order (later ones on top),
 * then what animations have drawn over it since (playback.md §3).
 */
export function paintPanel(canvas: IndexedCanvas, panel: PanelInstance, options: PaintOptions = {}): void {
  canvas.fill(0, 0, panel.width, panel.height, panel.colour);
  for (const placed of panel.objects) drawObject(canvas, placed);
  if (panel.dial !== null) drawDial(canvas, panel.dial, options.atRest !== true);
  if (options.atRest !== true) panel.layer.paint(canvas);
}

function drawObject(canvas: IndexedCanvas, { rect, look }: PlacedObject): void {
  if (rect === null || look === null) return;
  switch (look.kind) {
    case 'picture':
    case 'button':
      if (look.picture !== null) canvas.draw(look.picture, rect.left, rect.top);
      break;
    case 'scrollBitmap':
      // The rectangle's size of the picture, from the row of the scroll position, column 0.
      if (look.picture !== null) {
        canvas.draw(
          look.picture,
          rect.left,
          rect.top,
          0,
          scrollPictureRow(look.scroll),
          rect.right - rect.left,
          rect.bottom - rect.top,
        );
      }
      break;
    case 'scrollBar': {
      const layout = scrollBarLayout(rect.right - rect.left, rect.bottom - rect.top, look.scroll);
      drawScrollBar(canvas, rect, look.parts, layout.thumbTop - layout.trackTop, look.pressed);
      break;
    }
    case 'control':
      drawControlStrip(canvas.view(rect.left, rect.top, CONTROL_WIDTH, CONTROL_HEIGHT), look.strip);
      break;
  }
}

/**
 * An AnimationControl strip, composed in a 74×22 view (rendering.md §5, playback.md §7): the
 * background, the rewind button (greyed at rest), the play button (pause while playing, greyed at
 * the end), and the progress indicator, bitmap 159 from its left edge, as wide as the progress.
 */
export function drawControlStrip(canvas: IndexedCanvas, strip: ControlStrip): void {
  if (strip.background !== null) canvas.draw(strip.background, 0, 0);
  const rewind = strip.state === 'rest' ? strip.rewind : strip.rewindActive;
  if (rewind !== null) canvas.draw(rewind, CONTROL_PARTS.rewind.x, CONTROL_PARTS.rewind.y);
  const play =
    strip.state === 'playing' ? strip.pause : strip.state === 'ended' ? strip.playEnded : strip.play;
  if (play !== null) canvas.draw(play, CONTROL_PARTS.play.x, CONTROL_PARTS.play.y);
  const progress = Math.min(strip.progress, CONTROL_PROGRESS.width);
  if (strip.indicator !== null && progress > 0) {
    canvas.draw(
      strip.indicator,
      CONTROL_PROGRESS.x,
      CONTROL_PROGRESS.y,
      0,
      0,
      progress,
      CONTROL_PROGRESS.height,
    );
  }
}

/**
 * A scroll bar for the rectangle (L, T, R, B), with the thumb `offset` pixels below the top of
 * the track (rendering.md §5). Parts in data order: up arrow, down arrow, thumb, track, then the
 * four pressed variants, drawn for the `pressed` part (an arrow while held, the track while
 * paging, the thumb while dragged; special-screens.md §3.3).
 */
export function drawScrollBar(
  canvas: IndexedCanvas,
  rect: { left: number; top: number; right: number; bottom: number },
  parts: readonly (IndexedImage | null)[],
  offset: number,
  pressed: ScrollPart | null = null,
): void {
  const pick = (normal: number, part: ScrollPart | readonly ScrollPart[]): IndexedImage | null => {
    const isPressed =
      pressed !== null && (typeof part === 'string' ? part === pressed : part.includes(pressed));
    return (isPressed ? parts[normal + 4] : null) ?? parts[normal] ?? null;
  };
  const up = pick(0, 'lineUp');
  const down = pick(1, 'lineDown');
  const thumb = pick(2, 'thumb');
  const track = pick(3, ['pageUp', 'pageDown']);
  const width = rect.right - rect.left;
  const trackTop = rect.top + (up?.height ?? SCROLL_PART_SIZE);
  const trackBottom = rect.bottom - (down?.height ?? SCROLL_PART_SIZE);
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
 * `live` false draws the letter only: the lamp and the button are drawn by timers and presses,
 * not by the panel's paint (special-screens.md §4.4).
 */
function drawDial(canvas: IndexedCanvas, dial: DialState, live: boolean): void {
  const letter = dial.letters[dial.letter] ?? null;
  if (letter !== null) canvas.draw(letter, DIAL_POSITIONS.letter.x, DIAL_POSITIONS.letter.y);
  if (!live) return;
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
