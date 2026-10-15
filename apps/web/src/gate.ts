// The "tap to start" gate (docs/PLAN.md Phase 5): browsers start Web Audio only from a user
// gesture, so the title, whose animation is timed by its sound, waits behind a plain button.
import type { AudioContextLike } from './audio.ts';

/**
 * Shows the gate as ready and resolves on the first tap, click or key on it, with what `onTap`
 * returns. `onTap` runs inside the gesture's event handler, where audio may be started.
 */
export function waitForTap<T>(gate: HTMLButtonElement, onTap: () => T, label = 'Tap to start'): Promise<T> {
  gate.textContent = label;
  gate.disabled = false;
  gate.hidden = false;
  gate.focus();
  return new Promise((resolve) => {
    gate.addEventListener(
      'click',
      () => {
        gate.hidden = true;
        resolve(onTap());
      },
      { once: true },
    );
  });
}

/**
 * Creates and starts an audio context. Call it inside the gesture's event handler: that is what
 * lets the browser start it. Returns `null` if the browser has no Web Audio.
 */
export function startAudio():
  (AudioContextLike & { resume(): Promise<void>; readonly state: string }) | null {
  const Context = globalThis.AudioContext as typeof AudioContext | undefined;
  if (Context === undefined) return null;
  const context = new Context({ latencyHint: 'interactive' });
  void context.resume();
  // Older iOS Safari unlocks output only once something has been started in the gesture.
  const silence = context.createBufferSource();
  silence.buffer = context.createBuffer(1, 1, context.sampleRate);
  silence.connect(context.destination);
  silence.start();
  return context;
}

/**
 * Restarts the context after the system suspended it (iOS does after a call or when the page was
 * in the background), on the next gesture.
 */
export function keepAudioRunning(
  target: EventTarget,
  context: { readonly state: string; resume(): Promise<void> },
): void {
  const resume = (): void => {
    if (context.state !== 'running') void context.resume();
  };
  target.addEventListener('pointerdown', resume);
  target.addEventListener('keydown', resume);
}
