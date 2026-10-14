/**
 * The engine's hooks into sound and animation playback. Input and actions decide *when* media
 * starts or stops (behaviour.md §3, §6, §7); playing it is Phase 5 (playback.md). Until then
 * {@link SilentMedia} stands in: nothing ever plays.
 */
import type { Action, AnimationControlObject, PlayWaveAction } from '@twtw/formats';
import type { PageInstance, PanelInstance, PlacedObject } from './page.ts';
import type { PageWindow } from './render/window.ts';

/** The sound and animation actions of the page database, run where they stand in a list. */
export type MediaAction = Extract<
  Action,
  {
    kind:
      | 'playWave'
      | 'stopWave'
      | 'seekWave'
      | 'playPics'
      | 'playPicsNoLoad'
      | 'playNonQueuedPics'
      | 'stopPics'
      | 'seekPics';
  }
>;

/** Where media plays: the panel (and its window and page) whose object or handler started it. */
export interface MediaTarget {
  /** The popup window, or `null` for the main window (the base page). */
  readonly window: PageWindow | null;
  readonly page: PageInstance;
  /** Animation frames draw in this panel's coordinates, clipped to it (playback.md §3). */
  readonly panel: PanelInstance;
  /** The object whose handler or click started it; `null` for a panel's own handlers. */
  readonly object: PlacedObject | null;
}

/** Why an object's animation is played. */
export type AnimationReason =
  /** An AnimHotspot with flag `0x20`, when its panel opens (rendering.md §8). */
  | 'autostart'
  /** A click on an AnimHotspot (behaviour.md §3). */
  | 'click'
  /** A navigation button's press-in animation (behaviour.md §6.1). */
  | 'nav'
  /** The A–Z machine's letter animation after "go" (behaviour.md §7). */
  | 'dial';

export interface AnimationRequest {
  readonly reason: AnimationReason;
  /** The animation's name as stored in the database (no extension); resolve it with the page directory. */
  readonly name: string;
  /** The `.ANI` path on the disc. */
  readonly path: string;
  readonly target: MediaTarget;
}

/** An AnimationControl's button click, or a SendMessage addressed to it (playback.md §7). */
export type ControlRequest =
  | {
      readonly kind: 'click';
      readonly control: AnimationControlObject;
      /** Panel coordinates of the click. */
      readonly x: number;
      readonly y: number;
      readonly target: MediaTarget;
    }
  | {
      readonly kind: 'message';
      readonly control: AnimationControlObject;
      readonly message: number;
      readonly target: MediaTarget;
    };

export interface Media {
  /** Whether any sound or animation is playing (cursor rule, behaviour.md §8). */
  isPlaying(): boolean;
  /** Stop all media (playback.md §5): stop and rewind everything; returns whether anything was playing. */
  stopAll(): boolean;
  /** A sound or animation action from a handler, run at once (behaviour.md §2.3). */
  runAction(action: MediaAction, target: MediaTarget): void;
  /**
   * Plays an object's animation. `ended` is called once its last frame has shown (not when it is
   * stopped), and may be called before this returns. A click on an AnimHotspot whose animation is
   * already playing does nothing (behaviour.md §3).
   */
  playAnimation(request: AnimationRequest, ended: () => void): void;
  /** An AnimationControl's buttons and messages. */
  control(request: ControlRequest): void;
  /** A page left the screen: its objects' players can go (playback.md §1). */
  pageClosed(page: PageInstance): void;
}

export interface SilentMediaOptions {
  /**
   * Whether an animation "ends" at once (its `ended` call follows immediately) or never. By
   * default every animation ends at once, so navigation buttons work and pages that move on when
   * their animation finishes do so straight away.
   */
  readonly animationEnds?: (request: AnimationRequest) => boolean;
}

/** No sound and no animation: nothing ever plays, and animations end at once (or never). */
export class SilentMedia implements Media {
  readonly #ends: (request: AnimationRequest) => boolean;

  constructor(options: SilentMediaOptions = {}) {
    this.#ends = options.animationEnds ?? (() => true);
  }

  isPlaying(): boolean {
    return false;
  }

  stopAll(): boolean {
    return false;
  }

  runAction(): void {}

  playAnimation(request: AnimationRequest, ended: () => void): void {
    if (this.#ends(request)) ended();
  }

  control(): void {}

  pageClosed(): void {}
}

/**
 * Animations that start with their page never end, as under Wine, where they stall (reference
 * captures); all others end at once. For rendering pages as they look when they open.
 */
export function stalledAutostartMedia(): SilentMedia {
  return new SilentMedia({ animationEnds: (request) => request.reason !== 'autostart' });
}

/** The A–Z dial's turning sound, played like a PlayWave with the data's usual values (behaviour.md §7). */
export const DIAL_SOUND: PlayWaveAction = {
  kind: 'playWave',
  file: '\\AZAZ\\DIAL',
  unknown1: -1,
  unknown2: -1,
  unknown3: 1,
  unknown4: 1,
  unknown5: 0,
};
