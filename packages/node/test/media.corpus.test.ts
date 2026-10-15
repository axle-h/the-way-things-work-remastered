/**
 * Corpus test: every sound and animation the database plays opens and plays to its
 * end on a virtual clock (playback.md): PlayPics, PlayWave, AnimHotspots, navigation buttons,
 * AnimationControls, the A–Z letters and the dial sound. Each one's playing time must equal its
 * soundtrack's length (pics.md, `picsDuration`; the WAV's sample count), and every frame with a
 * picture must be drawn. Also the title chain from a cold start: it must arrive at the Workshop.
 * Frames are drawn into the panels' indexed layers only, never converted to colour. Only counts
 * are asserted; nothing from the disc is stored.
 */
import {
  collectReachable,
  decodeWave,
  parsePics,
  parseWave,
  picsDuration,
  resolveMedia,
  type Action,
  type Handler,
  type PicsFile,
} from '@twtw/formats';
import {
  ClockAudioSink,
  DIAL_SOUND,
  Engine,
  PlaybackMedia,
  VirtualClock,
  type MediaTarget,
  type PageInstance,
} from '@twtw/engine';
import { beforeAll, expect, it } from 'vitest';
import { DirectoryDataSource } from '../src/index.ts';
import { describeIfAvailable, discRoot, missingDiscFile } from './disc.ts';

/** One thing to play: how to start it, and the file it plays. */
interface Job {
  readonly what: string;
  readonly path: string;
  readonly kind: 'wave' | 'animation';
  /** In a shared panel (the navigation bar): the same on many pages. */
  readonly shared?: boolean;
  readonly start: (media: PlaybackMedia, ended: () => void) => void;
}

/** Runs the clock on until nothing is scheduled or loading. */
async function playOut(media: PlaybackMedia, clock: VirtualClock): Promise<void> {
  for (let guard = 0; guard < 1_000_000; guard++) {
    const loading = media.loading();
    if (loading !== null) {
      await loading;
      continue;
    }
    media.update();
    const delay = media.nextEventDelay();
    if (delay === null) return;
    clock.advance(Math.ceil(delay * 1e6) / 1e3);
  }
  throw new Error('playback did not end');
}

function pathOf(page: PageInstance, name: string, kind: 'wave' | 'animation'): string {
  const location = resolveMedia(page.page.directory, { kind, name });
  if (location.kind !== 'file') throw new Error(`${name} is not a file`);
  return location.path;
}

/** Everything a page plays, with the panel each plays in. */
function jobsOf(page: PageInstance): Job[] {
  const jobs: Job[] = [];
  const actions = (handlers: readonly Handler[], target: MediaTarget, owner: string): void => {
    for (const handler of handlers) {
      for (const action of handler.actions) {
        if (action.kind !== 'playWave' && action.kind !== 'playPics') continue;
        if (action.file === null) continue;
        const kind = action.kind === 'playWave' ? 'wave' : 'animation';
        const media: Action = action;
        jobs.push({
          what: `${owner} ${action.kind}`,
          path: pathOf(page, action.file, kind),
          kind,
          start: (player) =>
            player.runAction(media as Extract<Action, { kind: 'playWave' | 'playPics' }>, target),
        });
      }
    }
  };
  for (const panel of page.panels) {
    const panelTarget: MediaTarget = { window: null, page, panel, object: null };
    actions(panel.panel?.handlers ?? [], panelTarget, `page ${page.ref} panel ${panel.id}`);
    if (panel.panel?.kind === 'azDial') {
      const dial = panel.panel;
      jobs.push({
        what: `page ${page.ref} dial sound`,
        path: pathOf(page, DIAL_SOUND.file!, 'wave'),
        kind: 'wave',
        start: (player) => player.runAction(DIAL_SOUND, panelTarget),
      });
      for (const name of dial.letterAnimations) {
        if (name === null) continue;
        const path = pathOf(page, name, 'animation');
        jobs.push({
          what: `page ${page.ref} letter ${name}`,
          path,
          kind: 'animation',
          start: (player, ended) =>
            player.playAnimation({ reason: 'dial', name, path, target: panelTarget }, ended),
        });
      }
    }
    for (const placed of panel.objects) {
      const { object } = placed;
      const target: MediaTarget = { window: null, page, panel, object: placed };
      const owner = `page ${page.ref} panel ${panel.id} ${object.kind} ${object.id}`;
      if ('handlers' in object) actions(object.handlers, target, owner);
      switch (object.kind) {
        case 'animHotspot':
        case 'azAnimHotspot':
        case 'navHotspot': {
          if (object.file === null) break;
          const name = object.file;
          const path = pathOf(page, name, 'animation');
          const reason =
            object.kind === 'navHotspot' ? 'nav' : (object.flags & 0x20) !== 0 ? 'autostart' : 'click';
          jobs.push({
            what: owner,
            path,
            kind: 'animation',
            shared: panel.source === 'shared',
            start: (player, ended) => player.playAnimation({ reason, name, path, target }, ended),
          });
          break;
        }
        case 'animationControl':
          if (object.file === null) break;
          jobs.push({
            what: owner,
            path: pathOf(page, object.file, 'animation'),
            kind: 'animation',
            start: (player) =>
              player.control({ kind: 'message', control: object, message: object.unknown4, target }),
          });
          break;
        default:
          break;
      }
    }
  }
  return jobs;
}

/**
 * Plays on the disc: 712 animations (393 PlayPics, 225 AnimHotspots, 59 AnimationControls, 9
 * navigation buttons, 26 A–Z letters) and 286 sounds (285 PlayWave and the dial sound), in 585
 * distinct files; 4,535 references counting the navigation bar on every base page.
 */
const EXPECTED_COUNTS = { references: 4535, plays: 998, animations: 712, sounds: 286 };
const EXPECTED_FILES = 585;

describeIfAvailable('playing every sound and animation (disc)', missingDiscFile('DKCODE/TWTW.PNG'), () => {
  let source: DirectoryDataSource;

  beforeAll(async () => {
    source = await DirectoryDataSource.open(discRoot);
  });

  it('plays every reference to its end, timed by its soundtrack, drawing every frame', async () => {
    const clock = new VirtualClock();
    const errors: string[] = [];
    const drawn: number[] = [];
    const media = new PlaybackMedia({
      source,
      sink: new ClockAudioSink(clock),
      onError: (error, path) => errors.push(`${path}: ${String(error)}`),
      onFrame: (_path, frame) => drawn.push(frame),
    });
    const engine = await Engine.load(source, { startPage: null, clock, media });
    const pages = [...collectReachable(engine.content.database).pages.values()];
    // The navigation bar is a shared panel on every base page: its buttons are played once.
    const seen = new Set<string>();
    const files = new Map<string, { duration: number; images: number }>();
    const counts = { references: 0, plays: 0, animations: 0, sounds: 0 };
    const problems: string[] = [];

    for (const entry of pages) {
      const page = await engine.loadPage(entry.ref);
      for (const job of jobsOf(page)) {
        counts.references++;
        if (job.shared) {
          if (seen.has(job.path.toLowerCase())) continue;
          seen.add(job.path.toLowerCase());
        }
        counts.plays++;
        let file = files.get(job.path.toLowerCase());
        if (file === undefined) {
          const bytes = await source.read(job.path);
          if (job.kind === 'animation') {
            const pics: PicsFile = parsePics(bytes, job.path);
            file = {
              duration: picsDuration(pics),
              images: pics.frames.filter((f) => f.unpackedSize > 0).length,
            };
          } else {
            const audio = decodeWave(parseWave(bytes, job.path));
            file = { duration: audio.length / audio.sampleRate, images: 0 };
          }
          files.set(job.path.toLowerCase(), file);
        }
        if (job.kind === 'animation') counts.animations++;
        else counts.sounds++;

        media.stopAll();
        drawn.length = 0;
        let endedAt: number | null = null;
        // Wait for the file to load, so the start is when playback begins.
        job.start(media, () => (endedAt ??= clock.now()));
        const loading = media.loading();
        if (loading !== null) await loading;
        const started = clock.now();
        await playOut(media, clock);
        const elapsed = (endedAt ?? clock.now()) - started;
        if (media.isPlaying()) problems.push(`${job.what}: still playing`);
        if (Math.abs(elapsed - file.duration * 1000) > 0.01) {
          problems.push(
            `${job.what} ${job.path}: played ${elapsed} ms, soundtrack ${file.duration * 1000} ms`,
          );
        }
        if (drawn.length !== file.images) {
          problems.push(`${job.what} ${job.path}: drew ${drawn.length} of ${file.images} frames`);
        }
        if (drawn.some((frame, i) => i > 0 && frame <= drawn[i - 1]!)) {
          problems.push(`${job.what}: frames out of order`);
        }
      }
      media.pageClosed(page);
    }
    expect(errors).toEqual([]);
    expect(problems).toEqual([]);
    expect(media.isPlaying()).toBe(false);
    expect(counts).toEqual(EXPECTED_COUNTS);
    expect(files.size).toBe(EXPECTED_FILES);
  }, 300_000);

  it('runs the title chain from a cold start to the Workshop', async () => {
    const clock = new VirtualClock();
    const errors: string[] = [];
    const media = new PlaybackMedia({
      source,
      sink: new ClockAudioSink(clock),
      onError: (error, path) => errors.push(`${path}: ${String(error)}`),
    });
    const engine = await Engine.load(source, { clock, media });
    const database = engine.content.database;
    const durationOf = async (ref: number): Promise<number> => {
      const page = database.getPage(ref);
      const object = page.panels.flatMap((panel) => panel.objects).find((o) => o.kind === 'animHotspot');
      if (object?.kind !== 'animHotspot' || object.file === null)
        throw new Error(`page ${ref}: no animation`);
      const path = resolveMedia(page.directory, { kind: 'animation', name: object.file });
      return picsDuration(parsePics(await source.read((path as { path: string }).path)));
    };
    const title = database.product.startupPage!;
    expect(engine.basePage?.ref).toBe(title);

    // The title animation plays (with its sound) and moves on to the still title.
    expect(await engine.settle()).toBe(true);
    expect(engine.basePage?.ref).toBe(410886);
    expect(clock.now()).toBeCloseTo((await durationOf(title)) * 1000, 3);
    expect(engine.history).toEqual([410886]);

    // A click anywhere starts the transition, which ends at the Workshop.
    const before = clock.now();
    await engine.pointerDown(320, 240);
    await engine.pointerUp(320, 240);
    expect(engine.basePage?.ref).toBe(410962);
    expect(await engine.settle()).toBe(true);
    expect(engine.basePage?.ref).toBe(438408);
    expect(engine.history).toEqual([410886, 410962, 438408]);
    expect(clock.now() - before).toBeCloseTo((await durationOf(410962)) * 1000, 3);
    expect(media.isPlaying()).toBe(false);
    expect(errors).toEqual([]);
  }, 60_000);
});
