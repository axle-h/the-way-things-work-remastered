/**
 * Sound and animation playback (docs/formats/playback.md): one player per file, shared by
 * everything that names it; animation frames timed by the sound; queueing, stopping and
 * rewinding; AnimHotspots, navigation buttons, the A–Z letters and AnimationControls.
 *
 * Time comes from an {@link AudioSink}: a player hands the sink the whole soundtrack and draws
 * frame *k* once the sink's clock reaches the voice's start time + the start of sound chunk *k*
 * (playback.md §2, "For the remake"). Frames are drawn into the layer of the panel that plays
 * them, in panel coordinates and clipped to it (§3), when {@link PlaybackMedia.update} runs.
 * Nothing here touches the DOM: the web app passes a Web Audio sink, headless use a
 * {@link ClockAudioSink} on a virtual clock.
 */
import {
  decodePcm,
  decodeWave,
  parsePics,
  parseWave,
  picsDuration,
  picsFrameTimes,
  picsSoundtrack,
  resolveMedia,
  unpackPicsImage,
  type Action,
  type Handler,
  type MediaKind,
  type PicsFile,
} from '@twtw/formats';
import type { DataSource } from '../data/data-source.ts';
import type { AnimationRequest, ControlRequest, Media, MediaAction, MediaTarget } from '../media.ts';
import {
  CONTROL_PARTS,
  CONTROL_PROGRESS,
  CONTROL_HEIGHT,
  CONTROL_WIDTH,
  type ControlState,
  type ControlStrip,
  type PageInstance,
  type PlacedObject,
} from '../page.ts';
import type { Clock } from '../clock.ts';
import { ClockAudioSink, clipDuration, type AudioClip, type AudioSink, type AudioVoice } from './audio.ts';

export interface PlaybackMediaOptions {
  /** Where the `.ANI` and `.WAV` files come from. */
  readonly source: DataSource;
  readonly sink: AudioSink;
  /** A file that cannot be read or decoded (its playback then ends at once), or a frame that cannot be unpacked. */
  readonly onError?: (error: unknown, path: string) => void;
  /** Told about every frame drawn (frame chunk index, from 0), for tests and tools. */
  readonly onFrame?: (path: string, frame: number) => void;
}

/** Player states (playback.md §1). `starting`: asked to play while its file is still loading. */
export type PlayerState = 'idle' | 'starting' | 'playing' | 'paused' | 'ended';

/** A file's decoded content. */
interface Content {
  readonly clip: AudioClip;
  /** Seconds. */
  readonly duration: number;
  /** For animations: the file and when each frame chunk shows (seconds from the start). */
  readonly pics: PicsFile | null;
  readonly times: readonly number[];
}

/** One playback from start (or resume) to end: who started it and who hears how it ends. */
interface Run {
  /** Where frames draw; `null` for sounds. */
  readonly target: MediaTarget | null;
  readonly ended?: (() => void) | undefined;
  readonly stopped?: (() => void) | undefined;
  /** At the end: rewind to the start (AnimHotspot `0x40`, nav buttons) or stay ended. */
  readonly rewindAtEnd: boolean;
  /** The AnimationControl strip that shows this playback. */
  readonly strip: ControlBinding | null;
}

interface ControlBinding {
  readonly strip: ControlStrip;
  readonly target: MediaTarget;
  readonly object: PlacedObject;
}

/** Small tolerance for comparing clock times with frame times. */
const EPSILON = 1e-9;

class Player {
  readonly key: string;
  readonly path: string;
  readonly kind: 'wave' | 'animation';
  content: Content | null = null;
  loading: Promise<void> | null = null;
  failed = false;
  state: PlayerState = 'idle';
  /** Seconds into the file: where it is paused, or 0 at rest. */
  position = 0;
  /** The next frame chunk to draw. */
  nextFrame = 0;
  voice: AudioVoice | null = null;
  /** Sink time of the file's start for the current voice. */
  startTime = 0;
  run: Run | null = null;
  /** Requests waiting for this player to finish (PlayPics, PlayWave; playback.md §4.2). */
  queue: Run[] = [];
  /** Pages using this player; it is released when none is left and it is not playing. */
  users = 0;
  /** Order of the last start, for SeekPics. */
  started = 0;

  constructor(key: string, path: string, kind: 'wave' | 'animation') {
    this.key = key;
    this.path = path;
    this.kind = kind;
  }

  get active(): boolean {
    return this.state === 'playing' || this.state === 'starting';
  }

  rewind(): void {
    this.state = 'idle';
    this.position = 0;
    this.nextFrame = 0;
  }
}

export class PlaybackMedia implements Media {
  readonly sink: AudioSink;
  readonly #source: DataSource;
  readonly #onError: (error: unknown, path: string) => void;
  readonly #onFrame: ((path: string, frame: number) => void) | null;
  readonly #players = new Map<string, Player>();
  /** Player keys each shown page holds. */
  readonly #pages = new Map<PageInstance, string[]>();
  #starts = 0;
  #dirty = false;
  /** Callbacks due after the current update or action (never called while a player is changing). */
  #due: (() => void)[] = [];

  constructor(options: PlaybackMediaOptions) {
    this.#source = options.source;
    this.sink = options.sink;
    this.#onError = options.onError ?? (() => {});
    this.#onFrame = options.onFrame ?? null;
  }

  // -------------------------------------------------------------------------------------------
  // Media

  isPlaying(): boolean {
    for (const player of this.#players.values()) if (player.active) return true;
    return false;
  }

  /** Stop all media (playback.md §5): stop and rewind every playing player. */
  stopAll(): boolean {
    let was = false;
    for (const player of [...this.#players.values()]) {
      if (player.active) {
        was = true;
        this.#stop(player, true);
      }
    }
    this.#flush();
    return was;
  }

  runAction(action: MediaAction, target: MediaTarget): void {
    const directory = target.page.page.directory;
    switch (action.kind) {
      case 'playWave':
      case 'playPics':
      case 'playPicsNoLoad': {
        if (action.file === null) return;
        const kind = action.kind === 'playWave' ? 'wave' : 'animation';
        const player = this.#player(resolvePath(directory, action.file, kind), kind);
        const run: Run = { target: kind === 'animation' ? target : null, rewindAtEnd: false, strip: null };
        // An idle player starts now; a playing one queues the request (playback.md §4.2–4.3).
        if (player.active) player.queue.push(run);
        else this.#start(player, run, true);
        break;
      }
      case 'playNonQueuedPics': {
        if (action.file === null) return;
        const player = this.#player(resolvePath(directory, action.file, 'animation'), 'animation');
        if (!player.active) this.#start(player, { target, rewindAtEnd: false, strip: null }, true);
        break;
      }
      case 'stopWave':
      case 'stopPics': {
        if (action.name === null) return;
        const kind = action.kind === 'stopWave' ? 'wave' : 'animation';
        const player = this.#players.get(keyOf(resolvePath(directory, action.name, kind), kind));
        if (player?.active === true) this.#stop(player, true);
        break;
      }
      case 'seekPics': {
        // The most recently started animation goes back to its start (playback.md §4.4).
        const latest = [...this.#players.values()]
          .filter((player) => player.kind === 'animation' && player.started > 0)
          .sort((a, b) => b.started - a.started)[0];
        if (latest === undefined) break;
        if (latest.active) this.#stop(latest, true);
        else this.#rewindQuietly(latest);
        break;
      }
      case 'seekWave':
        // Does nothing in the original (playback.md §4.4).
        break;
    }
    this.#flush();
  }

  playAnimation(request: AnimationRequest, ended: () => void, stopped?: () => void): void {
    const player = this.#player(request.path, 'animation');
    if (player.active) return;
    const object = request.target.object?.object;
    const flags = object !== undefined && 'flags' in object ? object.flags : 0;
    // AnimHotspot 0x40 rewinds at the end; a nav button rewinds before it acts (behaviour.md §6.1).
    const rewindAtEnd = request.reason === 'nav' || (flags & 0x40) !== 0;
    this.#start(player, { target: request.target, ended, stopped, rewindAtEnd, strip: null }, true);
    this.#flush();
  }

  control(request: ControlRequest): void {
    const { control, target } = request;
    const object = target.object;
    const strip = object?.look?.kind === 'control' ? object.look.strip : null;
    if (control.file === null || object === null || strip === null) {
      this.stopAll();
      return;
    }
    const binding: ControlBinding = { strip, target, object };
    const player = this.#player(
      resolvePath(target.page.page.directory, control.file, 'animation'),
      'animation',
    );
    if (request.kind === 'message') {
      // The control answers only its own message number, as a press of play (playback.md §7).
      if (request.message === control.unknown4) this.#pressPlay(player, binding, control.unknown3 === 1);
      this.#flush();
      return;
    }
    const rect = object.rect;
    const x = request.x - (rect?.left ?? 0);
    const y = request.y - (rect?.top ?? 0);
    if (inPart(CONTROL_PARTS.play, x, y)) this.#pressPlay(player, binding, control.unknown3 === 1);
    else if (inPart(CONTROL_PARTS.rewind, x, y)) this.#pressRewind(player, binding);
    else this.stopAll();
    this.#flush();
  }

  /** Opens the players of a page's objects and actions as it opens (playback.md §1). */
  pageOpened(page: PageInstance): void {
    const keys: string[] = [];
    const open = (name: string | null, kind: 'wave' | 'animation'): void => {
      if (name === null) return;
      const player = this.#player(resolvePath(page.page.directory, name, kind), kind);
      player.users++;
      keys.push(player.key);
    };
    const handlers = (list: readonly Handler[]): void => {
      for (const handler of list) for (const action of handler.actions) openAction(action);
    };
    const openAction = (action: Action): void => {
      if (action.kind === 'playWave') open(action.file, 'wave');
      // PlayPicsNoLoad opens its file only when it runs (playback.md §4.4).
      else if (action.kind === 'playPics' || action.kind === 'playNonQueuedPics')
        open(action.file, 'animation');
    };
    handlers(page.page.handlers);
    for (const panel of page.panels) {
      handlers(panel.panel?.handlers ?? []);
      if (panel.panel?.kind === 'azDial') open('\\AZAZ\\DIAL', 'wave');
      for (const { object } of panel.objects) {
        if ('handlers' in object) handlers(object.handlers);
        switch (object.kind) {
          case 'animHotspot':
          case 'azAnimHotspot':
            // Load on demand (0x10): opened at the click instead (rendering.md §5).
            if ((object.flags & 0x10) === 0) open(object.file, 'animation');
            break;
          case 'navHotspot':
          case 'animationControl':
            open(object.file, 'animation');
            break;
          default:
            break;
        }
      }
    }
    this.#pages.set(page, [...(this.#pages.get(page) ?? []), ...keys]);
  }

  /**
   * A page left the screen: animations drawing into it stop (silently), and players no page uses
   * any more are released once they are not playing. Sounds play on (playback.md §4.2 [H]).
   */
  pageClosed(page: PageInstance): void {
    for (const player of [...this.#players.values()]) {
      player.queue = player.queue.filter((run) => run.target?.page !== page);
      if (player.run?.target?.page === page) {
        if (player.active) this.#stop(player, false);
        player.run = null;
      }
    }
    for (const key of this.#pages.get(page) ?? []) {
      const player = this.#players.get(key);
      if (player !== undefined) player.users--;
    }
    this.#pages.delete(page);
    for (const player of [...this.#players.values()]) this.#release(player);
    this.#flush();
  }

  update(): boolean {
    const now = this.sink.now();
    for (const player of [...this.#players.values()]) {
      if (player.state === 'playing') this.#advance(player, now);
    }
    this.#flush();
    const dirty = this.#dirty;
    this.#dirty = false;
    return dirty;
  }

  nextEventDelay(): number | null {
    const now = this.sink.now();
    let next: number | null = null;
    for (const player of this.#players.values()) {
      if (player.state !== 'playing' || player.content === null) continue;
      const { times, duration } = player.content;
      const at = player.startTime + (player.nextFrame < times.length ? times[player.nextFrame]! : duration);
      next = next === null ? at : Math.min(next, at);
    }
    return next === null ? null : Math.max(0, next - now);
  }

  loading(): Promise<void> | null {
    const pending = [...this.#players.values()].flatMap((player) =>
      player.loading === null ? [] : [player.loading],
    );
    return pending.length === 0 ? null : Promise.all(pending).then(() => {});
  }

  // -------------------------------------------------------------------------------------------
  // Inspection (tests, tools)

  /** The state of the player for a file, or `null` if none is open. */
  playerState(path: string, kind: 'wave' | 'animation' = 'animation'): PlayerState | null {
    return this.#players.get(keyOf(path, kind))?.state ?? null;
  }

  /** Paths of the open players, by kind. */
  openPlayers(): {
    readonly path: string;
    readonly kind: 'wave' | 'animation';
    readonly state: PlayerState;
  }[] {
    return [...this.#players.values()].map(({ path, kind, state }) => ({ path, kind, state }));
  }

  // -------------------------------------------------------------------------------------------
  // Players

  #player(path: string, kind: 'wave' | 'animation'): Player {
    const key = keyOf(path, kind);
    let player = this.#players.get(key);
    if (player === undefined) {
      player = new Player(key, path, kind);
      this.#players.set(key, player);
      this.#load(player);
    }
    return player;
  }

  #load(player: Player): void {
    const loading = Promise.resolve()
      .then(() => this.#source.read(player.path))
      .then((bytes) => {
        player.content = decodeContent(bytes, player.path, player.kind);
      })
      .catch((error: unknown) => {
        player.failed = true;
        this.#onError(error, player.path);
      })
      .finally(() => {
        player.loading = null;
        if (player.state === 'starting') this.#begin(player);
        this.#flush();
      });
    player.loading = loading;
  }

  /** Starts a run, from the start or (`fromStart` false) from where the player is paused. */
  #start(player: Player, run: Run, fromStart: boolean): void {
    if (fromStart) player.rewind();
    player.run = run;
    player.started = ++this.#starts;
    player.state = 'starting';
    if (run.strip !== null) this.#showStrip(run.strip, 'playing', player);
    if (player.loading === null) this.#begin(player);
  }

  /** The file is loaded: hand the sound to the sink and draw what is due (frame 0 at once). */
  #begin(player: Player): void {
    const content = player.content;
    if (player.failed || content === null) {
      // Nothing to play: it ends at once.
      player.state = 'playing';
      this.#end(player);
      return;
    }
    let voice: AudioVoice;
    try {
      voice = this.sink.start(content.clip, player.position);
    } catch (error) {
      this.#onError(error, player.path);
      voice = { startTime: this.sink.now() - player.position, stop: () => {} };
    }
    player.voice = voice;
    player.startTime = voice.startTime;
    player.state = 'playing';
    this.#advance(player, this.sink.now());
  }

  /** Draws the frames due at `now` and ends the player when its sound has played out. */
  #advance(player: Player, now: number): void {
    const content = player.content;
    if (content === null) return;
    const elapsed = now - player.startTime;
    const { times, duration } = content;
    while (player.nextFrame < times.length && times[player.nextFrame]! <= elapsed + EPSILON) {
      this.#drawFrame(player, player.nextFrame++);
    }
    player.position = Math.min(Math.max(0, elapsed), duration);
    const strip = player.run?.strip ?? null;
    if (strip !== null) this.#showStrip(strip, 'playing', player);
    if (elapsed + EPSILON >= duration) {
      // A late update still draws every frame, in order (playback.md §2).
      while (player.nextFrame < times.length) this.#drawFrame(player, player.nextFrame++);
      this.#end(player);
    }
  }

  #drawFrame(player: Player, index: number): void {
    const chunk = player.content?.pics?.frames[index];
    const layer = player.run?.target?.panel.layer;
    if (chunk === undefined || layer === undefined || chunk.unpackedSize === 0) return;
    try {
      const image = unpackPicsImage(chunk);
      if (image === null) return;
      layer.draw(image);
      this.#dirty = true;
      this.#onFrame?.(player.path, index);
    } catch (error) {
      this.#onError(error, player.path);
    }
  }

  /** All frames shown and the sound played out (playback.md §2 step 4, §6 "End"). */
  #end(player: Player): void {
    const run = player.run;
    player.voice = null;
    player.run = null;
    if (run === null || run.rewindAtEnd) {
      player.rewind();
    } else {
      player.state = 'ended';
      player.position = player.content?.duration ?? 0;
      player.nextFrame = player.content?.times.length ?? 0;
    }
    if (run?.strip != null) {
      if (run.rewindAtEnd) this.#showStrip(run.strip, 'rest', player);
      else {
        // The strip stays in its ended state with the movie on its last frame (playback.md §7).
        player.run = { target: run.target, rewindAtEnd: false, strip: run.strip };
        this.#showStrip(run.strip, 'ended', player);
      }
    }
    if (run?.ended !== undefined) this.#due.push(run.ended);
    const next = player.queue.shift();
    if (next !== undefined) this.#start(player, next, true);
    else this.#release(player);
  }

  /** Stops a playing player and rewinds it (playback.md §5); the screen keeps its last frame. */
  #stop(player: Player, notify: boolean): void {
    player.voice?.stop();
    player.voice = null;
    const run = player.run;
    player.run = null;
    player.queue = [];
    player.rewind();
    if (run?.strip != null) this.#showStrip(run.strip, 'rest', player);
    if (notify && run?.stopped !== undefined) this.#due.push(run.stopped);
    this.#release(player);
  }

  /** Rewinds a player that is not playing (SeekPics, the rewind button). */
  #rewindQuietly(player: Player): void {
    const run = player.run;
    player.run = null;
    player.rewind();
    if (run?.strip != null) this.#showStrip(run.strip, 'rest', player);
  }

  /** Forgets a player no page uses that is not playing (playback.md §1). */
  #release(player: Player): void {
    if (player.users > 0 || player.active || player.queue.length > 0) return;
    if (player.state === 'paused' && player.run !== null) return;
    if (this.#players.get(player.key) === player) this.#players.delete(player.key);
  }

  /** Calls the callbacks due, after every player has reached a consistent state. */
  #flush(): void {
    while (this.#due.length > 0) {
      const due = this.#due;
      this.#due = [];
      for (const callback of due) callback();
    }
  }

  // -------------------------------------------------------------------------------------------
  // AnimationControl (playback.md §7)

  /** The play button: pause while playing; otherwise stop all media, then (if nothing was playing) play. */
  #pressPlay(player: Player, binding: ControlBinding, rewindAtEnd: boolean): void {
    if (player.active && player.run?.strip?.strip === binding.strip) {
      this.#pause(player);
      return;
    }
    if (this.stopAll()) return;
    const resume = player.state === 'paused' && player.run?.strip?.strip === binding.strip;
    const run: Run = { target: binding.target, rewindAtEnd, strip: binding };
    this.#start(player, run, !resume);
  }

  /** The rewind button: stop all media; if nothing was playing, back to the start and the strip to rest. */
  #pressRewind(player: Player, binding: ControlBinding): void {
    if (this.stopAll()) return;
    if (player.run?.strip?.strip === binding.strip || player.state !== 'idle') this.#rewindQuietly(player);
    this.#showStrip(binding, 'rest', player);
  }

  #pause(player: Player): void {
    if (player.state === 'playing') {
      player.position = Math.min(this.sink.now() - player.startTime, player.content?.duration ?? 0);
    }
    player.voice?.stop();
    player.voice = null;
    player.state = 'paused';
    const strip = player.run?.strip ?? null;
    if (strip !== null) this.#showStrip(strip, 'paused', player);
  }

  /**
   * Updates what a strip shows. The strip is redrawn over anything animations drew there, so the
   * panel layer forgets its rectangle.
   */
  #showStrip(binding: ControlBinding, state: ControlState, player: Player): void {
    const { strip } = binding;
    const duration = player.content?.duration ?? 0;
    const progress =
      state === 'rest'
        ? 0
        : state === 'ended' || duration <= 0
          ? CONTROL_PROGRESS.width
          : Math.max(1, Math.ceil((CONTROL_PROGRESS.width * player.position) / duration));
    if (strip.state === state && strip.progress === progress) return;
    strip.state = state;
    strip.progress = progress;
    const rect = binding.object.rect;
    if (rect !== null) {
      binding.target.panel.layer.clear({
        left: rect.left,
        top: rect.top,
        right: rect.left + CONTROL_WIDTH,
        bottom: rect.top + CONTROL_HEIGHT,
      });
    }
    this.#dirty = true;
  }
}

/**
 * Playback without sound, timed by an engine clock: for tests and tools. With the engine's
 * `VirtualClock`, `Engine.settle` plays everything to its end at once.
 */
export function headlessMedia(
  source: DataSource,
  clock: Clock,
  onError?: (error: unknown, path: string) => void,
): PlaybackMedia {
  return new PlaybackMedia({
    source,
    sink: new ClockAudioSink(clock),
    ...(onError === undefined ? {} : { onError }),
  });
}

/** Decodes a sound or animation file. Throws on damaged files. */
function decodeContent(bytes: Uint8Array, path: string, kind: 'wave' | 'animation'): Content {
  if (kind === 'wave') {
    const clip = decodeWave(parseWave(bytes, path));
    return { clip, duration: clipDuration(clip), pics: null, times: [] };
  }
  const pics = parsePics(bytes, path);
  const format = pics.header.soundFormat;
  const channels = decodePcm(picsSoundtrack(pics), format.channels, format.bitsPerSample);
  const clip: AudioClip = { sampleRate: format.samplesPerSecond, channels, length: channels[0]?.length ?? 0 };
  return { clip, duration: picsDuration(pics), pics, times: picsFrameTimes(pics) };
}

/** The disc path of a media name used on a page (page-database.md, "Paths"). */
function resolvePath(directory: string | null, name: string, kind: 'wave' | 'animation'): string {
  const location = resolveMedia(directory, { kind: kind satisfies MediaKind, name });
  return location.kind === 'file' ? location.path : name;
}

function keyOf(path: string, kind: 'wave' | 'animation'): string {
  return `${kind}:${path.toLowerCase()}`;
}

function inPart(
  part: { x: number; y: number; width: number; height: number },
  x: number,
  y: number,
): boolean {
  return x >= part.x && y >= part.y && x < part.x + part.width && y < part.y + part.height;
}
