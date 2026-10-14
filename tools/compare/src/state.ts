/**
 * What is on screen, in the terms of the reference captures' sidecars, and replaying a capture's
 * clicks through the engine's own input (behaviour.md): each step is a press and a release at the
 * point where refcapture clicked the original.
 */
import type { DisplayObjectKind, PageRef } from '@twtw/formats';
import type { Engine } from '@twtw/engine';

/** The base page and the popups open over it, bottom first. */
export interface ScreenState {
  readonly base: PageRef;
  readonly popups: readonly PageRef[];
}

/** One recorded click: object number `object` of panel `panel` on page `page`, at a client point. */
export interface ClickStep {
  readonly page: PageRef;
  readonly panel: number;
  /** The object's position in the panel's object list (object ids repeat). */
  readonly object: number;
  /** Where refcapture clicked, in client (page) coordinates. */
  readonly clientPoint: { readonly x: number; readonly y: number };
}

/** Puts the engine in `state` with a direct start at the base page, then opens the popups bottom first. */
export async function showState(engine: Engine, state: ScreenState): Promise<void> {
  await engine.reset(state.base);
  for (const popup of state.popups) await engine.openPage(popup);
}

/** The engine's current state, in the same terms. */
export function engineState(engine: Engine): ScreenState | null {
  const base = engine.basePage;
  if (base === null) return null;
  return { base: base.ref, popups: engine.windows.map((window) => window.page.ref) };
}

export function sameState(a: ScreenState, b: ScreenState): boolean {
  return (
    a.base === b.base &&
    a.popups.length === b.popups.length &&
    a.popups.every((ref, i) => ref === b.popups[i])
  );
}

export function formatClickStep(step: Pick<ClickStep, 'page' | 'panel' | 'object'>): string {
  return `${step.page}:${step.panel}:${step.object}`;
}

/** What a replayed click hit. */
export interface ReplayedStep {
  readonly kind: DisplayObjectKind;
  /** Set when the click hit another object of the same page and panel than refcapture named. */
  readonly note: string | null;
}

/**
 * Clicks at the step's point (press and release) and waits for what it does. Throws if the point
 * does not hit an object of the page and panel refcapture meant to click: then the engine's window
 * placement disagrees with the capture's. Another object of the same panel is accepted with a
 * note: refcapture picks points by its own reading of the rectangles, while the engine includes
 * every edge and lets the last object win (behaviour.md §1.3); the final state decides.
 */
export async function replayStep(engine: Engine, step: ClickStep): Promise<ReplayedStep> {
  const { x, y } = step.clientPoint;
  const hit = engine.hitTest(x, y);
  if (
    hit?.panel == null ||
    hit.object === null ||
    hit.page.ref !== step.page ||
    hit.panel.id !== step.panel
  ) {
    const found =
      hit === null
        ? 'nothing'
        : hit.panel === null || hit.object === null
          ? `the ${hit.area} of page ${hit.page.ref}`
          : formatClickStep({ page: hit.page.ref, panel: hit.panel.id, object: hit.objectIndex });
    throw new Error(`step ${formatClickStep(step)}: the click at (${x}, ${y}) hits ${found}`);
  }
  const note =
    hit.objectIndex === step.object
      ? null
      : `step ${formatClickStep(step)}: the click at (${x}, ${y}) hits object ${hit.objectIndex} (edges are inclusive, the last object wins)`;
  await engine.pointerDown(x, y);
  await engine.pointerUp(x, y);
  await engine.idle();
  return { kind: hit.object.object.kind, note };
}
