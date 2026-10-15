// The engine with real playback (PlaybackMedia) on the synthetic interaction disc: autostart and
// the finished event, "a click while something plays only stops it", navigation buttons waiting
// for their animation, frames on screen and under popups, AnimationControl strips, the A–Z dial,
// and settling on a virtual clock (docs/formats/playback.md, behaviour.md §3, §6, §7).
import { describe, expect, it } from 'vitest';
import { VirtualClock, type Clock } from './clock.ts';
import { Engine } from './engine.ts';
import { PlaybackMedia } from './media/playback.ts';
import { createFramebuffer } from './screen.ts';
import { ManualClock, RecordingAudioSink, SYNTHETIC_BITMAP_FILL } from './testing/index.ts';
import {
  CONTENT,
  interactionDisc,
  interactionRef as ref,
  MEDIA_DURATION_MS,
  MEDIA_FRAME_FILL,
  NAV_BUTTON_TOP,
  PICTURE,
} from './testing/interaction-disc.ts';

async function start<C extends Clock>(page: string, clock: C) {
  const sink = new RecordingAudioSink(clock);
  const errors: string[] = [];
  const media = new PlaybackMedia({
    source: interactionDisc.source,
    sink,
    onError: (error, path) => errors.push(`${path}: ${String(error)}`),
  });
  const engine = await Engine.load(interactionDisc.source, { startPage: ref(page), media, clock });
  await media.loading();
  engine.update();
  return { engine, media, sink, clock, errors };
}

const content = (x: number, y: number): [number, number] => [CONTENT.x + x, CONTENT.y + y];
const navButton = (k: number): [number, number] => [40, NAV_BUTTON_TOP(k) + 15];

async function click(engine: Engine, [x, y]: [number, number]): Promise<void> {
  await engine.pointerDown(x, y);
  await engine.pointerUp(x, y);
  await engine.idle();
}

function pixelAt(engine: Engine, [x, y]: [number, number]): number {
  const framebuffer = createFramebuffer();
  engine.render(framebuffer);
  return framebuffer.pixels[y * framebuffer.width + x]!;
}

/** Where frame k of the synthetic animations shows, in the content panel (only k covers it). */
const frameK = (k: number): [number, number] => content(100 + 10 * k + 15, 205);

describe('autostart and the finished event (playback.md §6)', () => {
  it('plays as the page opens, drawing frames on screen, then follows its finished handler', async () => {
    const { engine, clock } = await start('auto', new ManualClock());
    expect(engine.media.isPlaying()).toBe(true);
    expect(pixelAt(engine, content(100, 200))).toBe(MEDIA_FRAME_FILL.auto);
    clock.advance(200);
    engine.update();
    expect(pixelAt(engine, frameK(1))).toBe(MEDIA_FRAME_FILL.auto + 1);
    clock.advance(MEDIA_DURATION_MS - 201);
    engine.update();
    expect(engine.basePage?.ref).toBe(ref('auto'));
    clock.advance(1);
    engine.update();
    await engine.idle();
    expect(engine.basePage?.ref).toBe(ref('home'));
    // The new page is painted at rest: the old page's frames went with it.
    expect(pixelAt(engine, content(100, 200))).toBe(PICTURE.back);
  });

  it('settles on a virtual clock: everything plays out and the page moves on', async () => {
    const { engine, clock, errors } = await start('auto', new VirtualClock());
    expect(await engine.settle()).toBe(true);
    expect(engine.basePage?.ref).toBe(ref('home'));
    expect(clock.now()).toBe(MEDIA_DURATION_MS);
    expect(engine.media.isPlaying()).toBe(false);
    expect(errors).toEqual([]);
  });

  it('settle gives up after its limit', async () => {
    const { engine } = await start('auto', new VirtualClock());
    expect(await engine.settle(300)).toBe(false);
    expect(engine.basePage?.ref).toBe(ref('auto'));
  });
});

describe('a click while something plays (behaviour.md §3)', () => {
  it('only stops it, leaving its last frame on screen; the next click acts', async () => {
    const { engine, clock } = await start('home', new ManualClock());
    await click(engine, content(30, 80)); // the AnimHotspot
    await engine.media.loading?.();
    clock.advance(250);
    engine.update();
    expect(engine.media.isPlaying()).toBe(true);
    // The cursor over a 0x4 hotspot is the arrow while something plays (§8).
    engine.pointerMove(...content(80, 20));
    expect(engine.cursor).toBe('arrow');
    await click(engine, content(80, 20)); // would change to the article
    expect(engine.basePage?.ref).toBe(ref('home'));
    expect(engine.media.isPlaying()).toBe(false);
    expect(pixelAt(engine, frameK(1))).toBe(MEDIA_FRAME_FILL.anim + 1);
    expect(engine.cursor).toBe('hand');
    // Stopped, the animation never fires its finished event.
    clock.advance(5000);
    engine.update();
    await engine.idle();
    expect(engine.basePage?.ref).toBe(ref('home'));
    await click(engine, content(80, 20));
    expect(engine.basePage?.ref).toBe(ref('article'));
  });

  it('acts anyway on a 0x5 hotspot', async () => {
    const { engine } = await start('home', new ManualClock());
    await click(engine, content(30, 80));
    await engine.media.loading?.();
    await click(engine, content(30, 50));
    expect(engine.basePage?.ref).toBe(ref('article'));
    expect(engine.media.isPlaying()).toBe(false);
  });

  it('plays a sound that goes on over the page it changed to', async () => {
    const { engine, sink, clock } = await start('home', new ManualClock());
    await click(engine, content(180, 20)); // PLAYWAVE SND, CHANGEPAGE article
    await engine.media.loading?.();
    expect(engine.basePage?.ref).toBe(ref('article'));
    expect(sink.voices.map((voice) => voice.clip.length)).toEqual([300]);
    expect(engine.media.isPlaying()).toBe(true);
    clock.advance(300);
    engine.update();
    expect(engine.media.isPlaying()).toBe(false);
  });
});

describe('navigation buttons (behaviour.md §6.1)', () => {
  it('stay busy while their animation plays, then go', async () => {
    const { engine, clock } = await start('article', new ManualClock());
    await engine.pointerDown(...navButton(0));
    const release = engine.pointerUp(...navButton(0));
    await engine.media.loading?.();
    engine.update();
    expect(engine.busy).toBe(true);
    clock.advance(MEDIA_DURATION_MS);
    engine.update();
    await release;
    await engine.idle();
    expect(engine.busy).toBe(false);
    expect(engine.basePage?.ref).toBe(ref('home'));
  });

  it('on a virtual clock, an awaited click returns once the button has acted', async () => {
    const { engine, clock } = await start('article', new VirtualClock());
    await click(engine, navButton(0));
    expect(engine.basePage?.ref).toBe(ref('home'));
    expect(clock.now()).toBe(MEDIA_DURATION_MS);
  });

  it('do nothing more when the app loses activation during the animation', async () => {
    const { engine } = await start('article', new ManualClock());
    await engine.pointerDown(...navButton(0));
    const release = engine.pointerUp(...navButton(0));
    await engine.media.loading?.();
    engine.setActive(false);
    await release;
    expect(engine.basePage?.ref).toBe(ref('article'));
    expect(engine.media.isPlaying()).toBe(false);
  });
});

describe('frames on screen (playback.md §3)', () => {
  it('stay under a popup and are repainted away where a closing popup uncovers them', async () => {
    const { engine, clock } = await start('home', new ManualClock());
    await click(engine, content(30, 80));
    await engine.media.loading?.();
    clock.advance(MEDIA_DURATION_MS);
    engine.update();
    await engine.idle(); // the finished handler changed to the article
    // Back at home, draw frames again by playing the animation to just before its end.
    await engine.changePage(ref('home'));
    await click(engine, content(30, 80));
    await engine.media.loading?.();
    clock.advance(MEDIA_DURATION_MS - 1);
    engine.update();
    await click(engine, content(160, 80)); // a click that only stops it
    // Frames now cover content (100,200)–(140,210), page (194,204)–(234,214).
    expect(pixelAt(engine, [200, 210])).toBe(MEDIA_FRAME_FILL.anim);
    expect(pixelAt(engine, [220, 204])).toBe(MEDIA_FRAME_FILL.anim + 2);
    // pop2's window covers page (213,164)–(257,206); rows 202–205 are its shadow, black where
    // x + y is even.
    await engine.openPage(ref('pop2'));
    expect(pixelAt(engine, [220, 204])).toBe(0);
    expect(pixelAt(engine, [221, 204])).toBe(MEDIA_FRAME_FILL.anim + 2);
    await engine.closePage(ref('pop2'));
    expect(pixelAt(engine, [220, 204])).toBe(PICTURE.back);
    expect(pixelAt(engine, [221, 205])).toBe(PICTURE.back);
    expect(pixelAt(engine, [220, 207])).toBe(MEDIA_FRAME_FILL.anim + 2);
    expect(pixelAt(engine, [200, 210])).toBe(MEDIA_FRAME_FILL.anim);
  });

  it('a direct start stops what plays', async () => {
    const { engine } = await start('auto', new ManualClock());
    await engine.reset(ref('home'));
    expect(engine.media.isPlaying()).toBe(false);
  });
});

describe('AnimationControl (playback.md §7)', () => {
  const strip = (x: number, y: number): [number, number] => content(200 + x, 300 + y);

  it('starts the movie from the page open message and shows its strip states', async () => {
    const { engine, clock } = await start('movie', new ManualClock());
    expect(engine.media.isPlaying()).toBe(true);
    expect(pixelAt(engine, strip(20, 3))).toBe(SYNTHETIC_BITMAP_FILL[119]); // pause
    expect(pixelAt(engine, strip(3, 3))).toBe(SYNTHETIC_BITMAP_FILL[117]); // rewind
    expect(pixelAt(engine, strip(39, 7))).toBe(SYNTHETIC_BITMAP_FILL[159]); // progress
    expect(pixelAt(engine, strip(45, 7))).toBe(SYNTHETIC_BITMAP_FILL[101]);
    expect(pixelAt(engine, content(100, 200))).toBe(MEDIA_FRAME_FILL.movie);
    // The pause button pauses.
    await click(engine, strip(25, 8));
    expect(engine.media.isPlaying()).toBe(false);
    expect(pixelAt(engine, strip(20, 3))).toBe(SYNTHETIC_BITMAP_FILL[116]);
    // A hotspot sending the message presses play: it resumes and plays to its end.
    await click(engine, content(30, 20));
    expect(engine.media.isPlaying()).toBe(true);
    clock.advance(MEDIA_DURATION_MS);
    engine.update();
    expect(engine.media.isPlaying()).toBe(false);
    expect(pixelAt(engine, strip(20, 3))).toBe(SYNTHETIC_BITMAP_FILL[120]); // ended
    expect(pixelAt(engine, strip(68, 7))).toBe(SYNTHETIC_BITMAP_FILL[159]); // full
    // Rewind returns the strip to rest; the last frame stays.
    await click(engine, strip(8, 8));
    expect(pixelAt(engine, strip(20, 3))).toBe(SYNTHETIC_BITMAP_FILL[116]);
    expect(pixelAt(engine, strip(3, 3))).toBe(SYNTHETIC_BITMAP_FILL[115]);
    expect(pixelAt(engine, strip(39, 7))).toBe(SYNTHETIC_BITMAP_FILL[101]);
    expect(pixelAt(engine, frameK(2))).toBe(MEDIA_FRAME_FILL.movie + 2);
  });
});

describe('the A–Z dial (behaviour.md §7)', () => {
  it('turns with its sound, and "go" plays the letter, then goes to its page', async () => {
    const { engine, sink, clock } = await start('dial', new ManualClock());
    await click(engine, content(35, 15)); // B
    expect(sink.voices.map((voice) => voice.clip.length)).toEqual([100]);
    await click(engine, content(340, 340)); // go
    await engine.media.loading?.();
    engine.update();
    expect(engine.media.isPlaying()).toBe(true);
    expect(pixelAt(engine, content(100, 200))).toBe(MEDIA_FRAME_FILL.letter);
    clock.advance(MEDIA_DURATION_MS);
    engine.update();
    await engine.idle();
    expect(engine.basePage?.ref).toBe(ref('article'));
  });

  it('takes presses again when the letter animation is stopped', async () => {
    const { engine } = await start('dial', new ManualClock());
    await click(engine, content(340, 340));
    await engine.media.loading?.();
    const dial = engine.basePage!.panels[0]!.dial!;
    expect(dial.going).toBe(true);
    engine.setActive(false);
    expect(dial.going).toBe(false);
    engine.setActive(true);
    await click(engine, content(35, 15));
    expect(dial.letter).toBe(1);
  });

  it('draws a new letter over what an animation left there', async () => {
    const { engine } = await start('dial', new ManualClock());
    const panel = engine.basePage!.panels[0]!;
    panel.layer.draw({
      rect: { left: 150, top: 95 },
      width: 30,
      height: 20,
      stride: 30,
      indices: new Uint8Array(600).fill(9),
    });
    await click(engine, content(35, 15)); // B: its picture is 5×5 at (161,101)
    expect(panel.layer.pixelAt(161, 101)).toBeNull();
    expect(panel.layer.pixelAt(160, 101)).toBe(9);
  });
});
