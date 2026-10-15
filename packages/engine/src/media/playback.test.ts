// The players of docs/formats/playback.md on synthetic PICS and WAV files with a manual clock:
// frame times against sound chunk starts (pre-roll included), queueing, stopping, rewinding,
// AnimationControl buttons and page lifetimes.
import type { AnimationControlObject, AnimHotspotObject, Handler, Page } from '@twtw/formats';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryDataSource } from '../data/memory-source.ts';
import type { MediaTarget } from '../media.ts';
import type { ControlStrip, PageInstance, PanelInstance, PlacedObject } from '../page.ts';
import { PanelLayer } from '../render/layer.ts';
import { ManualClock, RecordingAudioSink, syntheticPics, syntheticWave } from '../testing/index.ts';
import { PlaybackMedia } from './playback.ts';

/** 1,000 bytes per second: a 200-byte chunk lasts 0.2 s. */
const RATE = 1000;

/**
 * Two pre-roll chunks (A × B = 2 × 1) of 0.2 s, then four frame chunks of 0.2 s with images of
 * colours 101–104, then two silent-picture chunks of sound only: 1.6 s in all. Frame k shows
 * when sound chunk k starts: 0, 0.2, 0.4, 0.6 s.
 */
const ANIM = syntheticPics({
  preRoll: [2, 1],
  preRollSound: 200,
  rate: RATE,
  frames: [
    { sound: 200, image: { left: 10, top: 10, width: 4, height: 3, fill: 101 } },
    { sound: 200, image: { left: 12, top: 10, width: 4, height: 3, fill: 102 } },
    { sound: 200, image: { left: 14, top: 10, width: 4, height: 3, fill: 103 } },
    { sound: 200, image: { left: 95, top: 78, width: 10, height: 10, fill: 104 } },
    { sound: 200 },
    { sound: 200 },
  ],
});

let clock: ManualClock;
let sink: RecordingAudioSink;
let source: MemoryDataSource;
let media: PlaybackMedia;
let errors: string[];
let frames: number[];

beforeEach(() => {
  clock = new ManualClock();
  sink = new RecordingAudioSink(clock);
  source = new MemoryDataSource([
    ['ART/ANIM.ANI', ANIM],
    ['ART/OTHER.ANI', ANIM],
    ['ART/SND.WAV', syntheticWave(500, RATE)],
    ['ART/MOVIE.ANI', ANIM],
  ]);
  errors = [];
  frames = [];
  media = new PlaybackMedia({
    source,
    sink,
    onError: (error, path) => errors.push(`${path}: ${String(error)}`),
    onFrame: (_path, frame) => frames.push(frame),
  });
});

/** A page with one 100×80 panel holding `objects`, in directory `\ART\`. */
function fakePage(
  objects: PlacedObject[] = [],
  handlers: Handler[] = [],
): { page: PageInstance; panel: PanelInstance } {
  const panel = {
    id: 1,
    type: 'display',
    source: 'page',
    slot: null,
    panel: { kind: 'display', id: 1, objects: objects.map((o) => o.object), handlers },
    x: 0,
    y: 0,
    width: 100,
    height: 80,
    colour: 0,
    objects,
    dial: null,
    layer: new PanelLayer(100, 80),
  } as PanelInstance;
  const page = {
    ref: 1,
    page: { directory: '\\ART\\', handlers: [], panels: [] } as unknown as Page,
    template: null,
    panels: [panel],
    width: 100,
    height: 80,
    problems: [],
  } as unknown as PageInstance;
  return { page, panel };
}

function animHotspot(flags: number, file = 'ANIM'): PlacedObject {
  const object: AnimHotspotObject = {
    kind: 'animHotspot',
    id: 7,
    flags,
    rect: { left: 0, top: 0, right: 5, bottom: 5 },
    cursor: 'Hand',
    handlers: [],
    file,
    unknown1: 1,
  };
  return { object, rect: object.rect, look: null };
}

function control(rewindAtEnd: number): {
  placed: PlacedObject;
  object: AnimationControlObject;
  strip: ControlStrip;
} {
  const rect = { left: 10, top: 50, right: 84, bottom: 72 };
  const object: AnimationControlObject = {
    kind: 'animationControl',
    id: 181,
    flags: 0,
    rect,
    cursor: 'Hand',
    handlers: [],
    unknown1: 0,
    unknownRect: rect,
    file: 'MOVIE',
    unknownCursor: 'Hand',
    unknown2: 0,
    unknown3: rewindAtEnd,
    unknown4: 59,
  };
  const strip: ControlStrip = {
    state: 'rest',
    progress: 0,
    background: null,
    rewind: null,
    rewindActive: null,
    play: null,
    pause: null,
    playEnded: null,
    indicator: null,
  };
  return { placed: { object, rect, look: { kind: 'control', strip } }, object, strip };
}

function target(page: PageInstance, panel: PanelInstance, object: PlacedObject | null = null): MediaTarget {
  return { window: null, page, panel, object };
}

/** Moves the clock on by `ms` and updates playback. */
function advance(ms: number): void {
  clock.advance(ms);
  media.update();
}

async function loaded(): Promise<void> {
  await media.loading();
}

const playPics = (file: string) =>
  ({ kind: 'playPics', file, unknown1: -1, unknown2: -1, unknown3: 1, unknown4: 1, unknown5: 0 }) as const;
const playWave = (file: string) =>
  ({ kind: 'playWave', file, unknown1: -1, unknown2: -1, unknown3: 1, unknown4: 1, unknown5: 0 }) as const;

describe('animation timing (playback.md §2)', () => {
  it('draws frame k when sound chunk k starts, counting the pre-roll, and ends with the sound', async () => {
    const { page, panel } = fakePage([animHotspot(0)]);
    const ended: number[] = [];
    media.playAnimation(
      { reason: 'click', name: 'ANIM', path: 'ART/ANIM.ANI', target: target(page, panel, panel.objects[0]!) },
      () => ended.push(clock.now()),
    );
    expect(media.isPlaying()).toBe(true); // asked to play while loading
    await loaded();
    // The whole soundtrack goes to the sink at once, pre-roll first: 8 chunks of 200 samples.
    expect(sink.voices).toHaveLength(1);
    expect(sink.voices[0]!.clip.length).toBe(1600);
    expect(sink.voices[0]!.clip.sampleRate).toBe(RATE);
    expect(sink.voices[0]!.clip.channels[0]![0]).toBeCloseTo((0 - 128) / 128); // chunk 0's samples
    expect(sink.voices[0]!.offset).toBe(0);
    // Frame 0 shows at the start.
    expect(frames).toEqual([0]);
    expect(panel.layer.pixelAt(10, 10)).toBe(101);
    expect(media.nextEventDelay()).toBeCloseTo(0.2);
    advance(199);
    expect(frames).toEqual([0]);
    advance(1);
    expect(frames).toEqual([0, 1]);
    expect(panel.layer.pixelAt(12, 10)).toBe(102);
    expect(panel.layer.pixelAt(10, 10)).toBe(101); // the earlier frame stays where not covered
    advance(200);
    expect(frames).toEqual([0, 1, 2]);
    advance(200);
    expect(frames).toEqual([0, 1, 2, 3]);
    // Frame 3 is clipped to the 100×80 panel.
    expect(panel.layer.pixelAt(99, 79)).toBe(104);
    expect(panel.layer.bounds).toEqual({ left: 10, top: 10, right: 100, bottom: 80 });
    // Two more frame chunks (without pictures) are due, then the sound plays on for the
    // pre-roll's worth: the end comes at 1.6 s.
    expect(media.nextEventDelay()).toBeCloseTo(0.2);
    advance(400);
    expect(frames).toEqual([0, 1, 2, 3]);
    expect(media.nextEventDelay()).toBeCloseTo(0.6);
    advance(599);
    expect(ended).toEqual([]);
    expect(media.isPlaying()).toBe(true);
    advance(1);
    expect(ended).toEqual([1600]);
    expect(media.isPlaying()).toBe(false);
    expect(media.nextEventDelay()).toBeNull();
    // The last frame stays on screen.
    expect(panel.layer.pixelAt(17, 12)).toBe(103);
    expect(errors).toEqual([]);
  });

  it('draws every frame due, in order, when updated late', async () => {
    const { page, panel } = fakePage();
    media.runAction(playPics('ANIM'), target(page, panel));
    await loaded();
    advance(700);
    expect(frames).toEqual([0, 1, 2, 3]);
    advance(5000);
    expect(media.isPlaying()).toBe(false);
  });

  it('times frames by the voice, which may start later than asked', async () => {
    const { page, panel } = fakePage();
    // A sink whose output starts 50 ms after the request (as Web Audio schedules ahead).
    const late = new (class extends RecordingAudioSink {
      override start(...args: Parameters<RecordingAudioSink['start']>) {
        const voice = super.start(...args);
        return { startTime: voice.startTime + 0.05, stop: voice.stop };
      }
    })(clock);
    media = new PlaybackMedia({ source, sink: late, onFrame: (_p, f) => frames.push(f) });
    media.runAction(playPics('ANIM'), target(page, panel));
    await loaded();
    expect(frames).toEqual([]);
    advance(50);
    expect(frames).toEqual([0]);
    advance(199);
    expect(frames).toEqual([0]);
    advance(1);
    expect(frames).toEqual([0, 1]);
  });
});

describe('PlayPics and PlayWave (playback.md §4)', () => {
  it('queues a request for a file that is playing until it ends', async () => {
    const { page, panel } = fakePage();
    media.runAction(playPics('ANIM'), target(page, panel));
    await loaded();
    advance(300);
    media.runAction(playPics('ANIM'), target(page, panel));
    expect(sink.voices).toHaveLength(1);
    advance(1300);
    // The first ended at 1.6 s; the queued one starts from its first frame then.
    expect(sink.voices.map((voice) => voice.at)).toEqual([0, 1.6]);
    expect(frames).toEqual([0, 1, 2, 3, 0]);
    expect(media.isPlaying()).toBe(true);
  });

  it('plays sounds, queueing a sound that is already playing', async () => {
    const { page, panel } = fakePage();
    media.runAction(playWave('SND'), target(page, panel));
    await loaded();
    expect(sink.voices[0]!.clip.length).toBe(500);
    media.runAction(playWave('SND'), target(page, panel));
    advance(499);
    expect(sink.voices).toHaveLength(1);
    advance(1);
    expect(sink.voices.map((voice) => voice.at)).toEqual([0, 0.5]);
    advance(500);
    expect(media.isPlaying()).toBe(false);
  });

  it('starts PlayNonQueuedPics at once unless it plays; StopPics and StopWave stop by name', async () => {
    const { page, panel } = fakePage();
    const nonQueued = { ...playPics('ANIM'), kind: 'playNonQueuedPics' } as const;
    media.runAction(nonQueued, target(page, panel));
    media.runAction(playWave('SND'), target(page, panel));
    await loaded();
    media.runAction(nonQueued, target(page, panel));
    expect(sink.voices).toHaveLength(2);
    media.runAction({ kind: 'stopPics', name: 'anim' }, target(page, panel));
    expect(media.playerState('ART/ANIM.ANI')).not.toBe('playing');
    expect(media.playerState('ART/SND.WAV', 'wave')).toBe('playing');
    media.runAction({ kind: 'stopWave', name: 'SND' }, target(page, panel));
    expect(media.isPlaying()).toBe(false);
    expect(sink.voices.every((voice) => voice.stopped === 0)).toBe(true);
  });

  it('SeekPics rewinds the latest animation; SeekWave does nothing', async () => {
    const { page, panel } = fakePage([animHotspot(0)]);
    media.pageOpened(page);
    media.runAction(playPics('ANIM'), target(page, panel));
    await loaded();
    advance(300);
    media.runAction({ kind: 'seekWave' }, target(page, panel));
    expect(media.isPlaying()).toBe(true);
    media.runAction({ kind: 'seekPics' }, target(page, panel));
    expect(media.isPlaying()).toBe(false);
    expect(media.playerState('ART/ANIM.ANI')).toBe('idle');
  });
});

describe('stop all media (playback.md §5)', () => {
  it('stops and rewinds what plays, keeps the last frame and reports it', async () => {
    const { page, panel } = fakePage([animHotspot(0)]);
    media.pageOpened(page);
    const calls: string[] = [];
    const request = {
      reason: 'click',
      name: 'ANIM',
      path: 'ART/ANIM.ANI',
      target: target(page, panel, panel.objects[0]!),
    } as const;
    media.playAnimation(
      request,
      () => calls.push('ended'),
      () => calls.push('stopped'),
    );
    await loaded();
    advance(250);
    expect(media.stopAll()).toBe(true);
    expect(calls).toEqual(['stopped']);
    expect(sink.voices[0]!.stopped).toBe(0.25);
    expect(media.playerState('ART/ANIM.ANI')).toBe('idle');
    expect(panel.layer.pixelAt(12, 10)).toBe(102);
    expect(media.stopAll()).toBe(false);
    advance(5000);
    expect(calls).toEqual(['stopped']);
    // Played again, it starts from the first frame.
    media.playAnimation(request, () => calls.push('ended'));
    expect(frames).toEqual([0, 1, 0]);
  });

  it('a request while it plays does nothing', async () => {
    const { page, panel } = fakePage([animHotspot(0)]);
    const request = {
      reason: 'click',
      name: 'ANIM',
      path: 'ART/ANIM.ANI',
      target: target(page, panel, panel.objects[0]!),
    } as const;
    media.playAnimation(request, () => {});
    await loaded();
    media.playAnimation(request, () => {});
    expect(sink.voices).toHaveLength(1);
  });
});

describe('AnimHotspot ends (playback.md §6)', () => {
  it.each([
    [0, 'ended'],
    [0x40, 'idle'],
  ] as const)('with flags %s it is %s after its end', async (flags, state) => {
    const { page, panel } = fakePage([animHotspot(flags)]);
    let ended = 0;
    media.playAnimation(
      {
        reason: 'autostart',
        name: 'ANIM',
        path: 'ART/ANIM.ANI',
        target: target(page, panel, panel.objects[0]!),
      },
      () => ended++,
    );
    media.pageOpened(page);
    await loaded();
    advance(1600);
    expect(ended).toBe(1);
    expect(media.playerState('ART/ANIM.ANI')).toBe(state);
    // The last frame stays either way.
    expect(panel.layer.pixelAt(99, 79)).toBe(104);
  });

  it('ends at once, reporting the error, when the file is missing', async () => {
    const { page, panel } = fakePage([animHotspot(0, 'GONE')]);
    let ended = 0;
    media.playAnimation(
      { reason: 'nav', name: 'GONE', path: 'ART/GONE.ANI', target: target(page, panel, panel.objects[0]!) },
      () => ended++,
    );
    await loaded();
    expect(ended).toBe(1);
    expect(errors).toHaveLength(1);
    expect(media.isPlaying()).toBe(false);
  });
});

describe('players and pages (playback.md §1)', () => {
  it('opens a page’s players when it opens, except load-on-demand ones, and releases them when it closes', async () => {
    const handlers: Handler[] = [
      { event: 4, actions: [playWave('SND'), { ...playPics('OTHER'), kind: 'playPicsNoLoad' }] },
    ];
    const { page } = fakePage([animHotspot(0), { ...animHotspot(0x10, 'MOVIE') }], handlers);
    media.pageOpened(page);
    await loaded();
    expect(source.reads.sort()).toEqual(['ART/ANIM.ANI', 'ART/SND.WAV']);
    expect(
      media
        .openPlayers()
        .map((player) => player.path)
        .sort(),
    ).toEqual(['ART/ANIM.ANI', 'ART/SND.WAV']);
    media.pageClosed(page);
    expect(media.openPlayers()).toEqual([]);
  });

  it('shares one player per file', async () => {
    const one = fakePage([animHotspot(0)]);
    const two = fakePage([animHotspot(0)]);
    media.pageOpened(one.page);
    media.pageOpened(two.page);
    await loaded();
    expect(source.reads).toEqual(['ART/ANIM.ANI']);
    media.pageClosed(one.page);
    expect(media.openPlayers()).toHaveLength(1);
  });

  it('stops animations drawing into a page that closes, but lets sounds play on', async () => {
    const { page, panel } = fakePage();
    media.pageOpened(page);
    media.runAction(playPics('ANIM'), target(page, panel));
    media.runAction(playWave('SND'), target(page, panel));
    await loaded();
    media.pageClosed(page);
    expect(media.playerState('ART/ANIM.ANI')).toBeNull();
    expect(media.playerState('ART/SND.WAV', 'wave')).toBe('playing');
    advance(500);
    expect(media.isPlaying()).toBe(false);
    expect(media.openPlayers()).toEqual([]);
  });
});

describe('AnimationControl (playback.md §7)', () => {
  /** Panel points of the strip's buttons (strip at (10,50)). */
  const PLAY = { x: 10 + 25, y: 50 + 8 };
  const REWIND = { x: 10 + 8, y: 50 + 8 };

  function setUp(rewindAtEnd = 0) {
    const movie = control(rewindAtEnd);
    const { page, panel } = fakePage([movie.placed]);
    media.pageOpened(page);
    const at = target(page, panel, movie.placed);
    const press = (point: { x: number; y: number }) =>
      media.control({ kind: 'click', control: movie.object, ...point, target: at });
    const message = (number: number) =>
      media.control({ kind: 'message', control: movie.object, message: number, target: at });
    return { ...movie, page, panel, press, message };
  }

  it('plays on its message, pauses and resumes with the play button, rewinds with rewind', async () => {
    const { strip, press, message } = setUp();
    message(58); // not its message number
    expect(media.isPlaying()).toBe(false);
    message(59);
    await loaded();
    expect(strip.state).toBe('playing');
    expect(strip.progress).toBe(1);
    advance(800);
    expect(strip.progress).toBe(15); // half way
    press(PLAY);
    expect([strip.state, media.isPlaying()]).toEqual(['paused', false]);
    expect(sink.voices[0]!.stopped).toBe(0.8);
    advance(1000);
    expect(frames).toEqual([0, 1, 2, 3]);
    // Stop all media leaves a paused movie paused.
    expect(media.stopAll()).toBe(false);
    press(PLAY);
    expect(strip.state).toBe('playing');
    expect(sink.voices[1]!.offset).toBeCloseTo(0.8);
    advance(400);
    press(PLAY);
    press(REWIND);
    expect([strip.state, strip.progress]).toEqual(['rest', 0]);
    press(PLAY);
    expect(sink.voices[2]!.offset).toBe(0);
    expect(frames.at(-1)).toBe(0);
  });

  it('a press of play while something else plays only stops it', async () => {
    const { strip, press, page, panel } = setUp();
    media.runAction(playWave('SND'), target(page, panel));
    await loaded();
    press(PLAY);
    expect(media.isPlaying()).toBe(false);
    expect(strip.state).toBe('rest');
    press(PLAY);
    expect(strip.state).toBe('playing');
  });

  it('ends in its ended state, or (second flag 1) back at rest', async () => {
    const first = setUp(0);
    first.message(59);
    await loaded();
    advance(1600);
    expect([first.strip.state, first.strip.progress]).toEqual(['ended', 30]);
    expect(media.playerState('ART/MOVIE.ANI')).toBe('ended');
    // Play again starts from the beginning.
    first.press(PLAY);
    expect([first.strip.state, sink.voices.at(-1)!.offset]).toEqual(['playing', 0]);
    media.stopAll();
    expect(first.strip.state).toBe('rest');

    const second = setUp(1);
    second.message(59);
    await loaded();
    advance(1600);
    expect([second.strip.state, second.strip.progress]).toEqual(['rest', 0]);
  });

  it('clears frames under its strip when the strip changes', async () => {
    const { strip, panel, message } = setUp();
    panel.layer.draw({
      rect: { left: 0, top: 40 },
      width: 100,
      height: 30,
      stride: 100,
      indices: new Uint8Array(3000).fill(9),
    });
    message(59);
    await loaded();
    expect(strip.state).toBe('playing');
    expect(panel.layer.pixelAt(10, 50)).toBeNull();
    expect(panel.layer.pixelAt(9, 50)).toBe(9);
  });
});
