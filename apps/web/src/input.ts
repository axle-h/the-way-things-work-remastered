// Pointer and keyboard input for the stage (docs/PLAN.md §3, "Responsive input"): Pointer Events
// for mouse, touch and pen, a tap or click acting on release; the browser's own gestures (double-tap
// zoom, pinch, long-press menu) are kept off the stage.
import { DoubleClickDetector, type Engine } from '@twtw/engine';

/** Converts a pointer event's client position to framebuffer coordinates (the one place, stage.ts). */
export type ToFramebuffer = (clientX: number, clientY: number) => { x: number; y: number };

/**
 * Forwards input on `canvas` to the engine. Only the primary pointer counts, so a second finger
 * does nothing. Mouse double clicks are treated as the original does (the second click is ignored,
 * behaviour.md §1.7); taps never make a double click. Returns a function that detaches everything.
 */
export function attachInput(
  canvas: HTMLCanvasElement,
  engine: Engine,
  toFramebuffer: ToFramebuffer,
): () => void {
  const doubleClicks = new DoubleClickDetector();
  let active: number | null = null;
  const point = (event: PointerEvent) => toFramebuffer(event.clientX, event.clientY);

  const down = (event: PointerEvent): void => {
    if (!event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    active = event.pointerId;
    canvas.setPointerCapture(event.pointerId);
    const { x, y } = point(event);
    let doubleClick = false;
    if (event.pointerType === 'mouse') doubleClick = doubleClicks.press(x, y, event.timeStamp);
    else doubleClicks.reset();
    // Touch: scroll thumbs keep following the finger, and swipes scroll (special-screens.md §1.12, §3.4).
    void engine.pointerDown(x, y, { doubleClick, touch: event.pointerType === 'touch' });
  };
  const move = (event: PointerEvent): void => {
    if (!event.isPrimary) return;
    const { x, y } = point(event);
    engine.pointerMove(x, y);
  };
  const up = (event: PointerEvent): void => {
    if (event.pointerId !== active) return;
    event.preventDefault();
    active = null;
    const { x, y } = point(event);
    void engine.pointerUp(x, y);
  };
  const cancel = (event: PointerEvent): void => {
    if (event.pointerId !== active) return;
    active = null;
    doubleClicks.reset();
    engine.pointerCancel();
  };
  const leave = (event: PointerEvent): void => {
    if (event.pointerId !== active) engine.pointerLeave();
  };
  const prevent = (event: Event): void => event.preventDefault();
  const key = (event: KeyboardEvent): void => {
    const input = {
      key: event.key,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
    };
    if (engine.key(input)) event.preventDefault();
  };
  const visibility = (): void =>
    engine.setActive(document.visibilityState === 'visible' && document.hasFocus());
  const blur = (): void => engine.setActive(false);
  const focus = (): void => engine.setActive(true);

  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', cancel);
  canvas.addEventListener('pointerleave', leave);
  canvas.addEventListener('contextmenu', prevent);
  canvas.addEventListener('dblclick', prevent);
  // iOS Safari's pinch gestures.
  canvas.addEventListener('gesturestart', prevent);
  window.addEventListener('keydown', key);
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('blur', blur);
  window.addEventListener('focus', focus);
  return () => {
    canvas.removeEventListener('pointerdown', down);
    canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('pointerup', up);
    canvas.removeEventListener('pointercancel', cancel);
    canvas.removeEventListener('pointerleave', leave);
    canvas.removeEventListener('contextmenu', prevent);
    canvas.removeEventListener('dblclick', prevent);
    canvas.removeEventListener('gesturestart', prevent);
    window.removeEventListener('keydown', key);
    document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('blur', blur);
    window.removeEventListener('focus', focus);
  };
}
