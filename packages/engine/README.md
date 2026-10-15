# @twtw/engine

The DOM-free engine. It reads the original disc through a `DataSource`, keeps what is on screen (a base page and a stack of popup windows), takes pointer and keyboard input, runs event handlers and page actions, and draws into an 8-bit indexed 640×480 framebuffer. It runs unchanged in the browser and in Node. Behaviour follows `docs/formats/behaviour.md`, drawing `docs/formats/rendering.md`; the formats come from `@twtw/formats`.

Phase 4 added interaction: hit-testing, clicks, events and actions, popup ownership, the navigation bar and its history, the A–Z machine, the zoom effect, cursors and keys. Phase 5 adds sound and animation playback (`docs/formats/playback.md`): `PlaybackMedia` behind the `Media` hooks, timed by an audio sink's clock.

## Using it

```ts
import { createFramebuffer, Engine } from '@twtw/engine';

const media = new PlaybackMedia({ source, sink }); // sink: Web Audio in the app, ClockAudioSink headless
const engine = await Engine.load(source, { clock, media }); // database, palette, startup page
await engine.pointerDown(x, y); // page (framebuffer) coordinates
engine.pointerMove(x, y);
await engine.pointerUp(x, y); // a click acts on release; resolves when its page actions are done
engine.key({ key: 'F4', altKey: true });

const framebuffer = createFramebuffer();
requestAnimationFrame(function frame() {
  if (engine.update()) engine.render(framebuffer); // playback, lamp, zoom; palette indices out
  canvas.style.cursor = cursors[engine.cursor]; // 'arrow' | 'hand' | 'wait'
  requestAnimationFrame(frame);
});
```

- **Input** (`pointerDown`, `pointerMove`, `pointerUp`, `pointerCancel`, `pointerLeave`, `key`, `setActive`): behaviour.md §1, §5, §9, §10. Input is one task at a time: while a task runs (`busy`, the hourglass) further pointer input is dropped, as in the original. `pointerDown(x, y, { doubleClick: true })` is the second press of a double click, which the original ignores with its release; `DoubleClickDetector` decides it as Windows does. `hitTest(x, y)` reports the window, area (client, caption, system box, shadow), panel and object under a point.
- **Page operations** (`reset`, `changePage`, `openPage`, `closePage`): the actions of behaviour.md §4, also used by tools. `reset` is a direct start: everything closes, the history is emptied and the page is not recorded.
- **State**: `basePage`, `windows` (popups bottom first, each with its `owner`), `activeWindow`, `focusWindow`, `history`, `busy`, `zooming`, `cursor`.
- **Time**: a `Clock` (`now`, `wait`) drives the zoom outlines and the A–Z lamp. The default `VirtualClock` jumps ahead whenever something waits, so headless use never blocks; the web app passes the browser's clock. `update()` advances time-based state and says whether to render again.
- **Media** (`Media`): `isPlaying`, `stopAll` (the rule "a click while something plays only stops it"), `runAction` (PlayWave, PlayPics, …), `playAnimation` (AnimHotspot clicks and autostart, nav buttons, the A–Z letter; `ended` fires the finished event or continues the navigation, `stopped` frees the dial), `control` (AnimationControl clicks and SendMessage), `pageOpened`/`pageClosed`, and for timing `update`, `nextEventDelay`, `loading`. `PlaybackMedia` plays the disc (below). `SilentMedia` plays nothing; its animations end at once (or never, with `stalledAutostartMedia()` for rendering pages as they open, as Wine's captures show them).
- **Settling** (`settle(limitMs)`): runs an advancing clock (`VirtualClock`, `ManualClock`) on until everything has played out and no input or page action is pending: the true settled state, e.g. the title chain arriving at the still title. On a `VirtualClock`, input that waits for an animation (a nav button) also moves the clock on by itself, so `await engine.pointerUp(…)` returns once the button has acted.
- **Events** (`on`): `productOption` (copy, print, print setup; Phase 8), `quit` (Alt+F4 in the main window), `actionFailed`, `error`.

## Playback

```
 Engine ── Media hooks ──▶ PlaybackMedia ── AudioSink.start(clip, offset) ──▶ Web Audio (apps/web)
   ▲  update() each frame      │  players: one per file             ◀── AudioSink.now(): audio clock
   │                           │  frame k due at voice.startTime + start of sound chunk k
   └── render() ◀── PanelLayer ┘  (drawn into the panel's layer, panel coordinates, clipped)
```

- **Players** (`media/playback.ts`, playback.md §1): one per file and kind, shared, opened (fetched and decoded) in the background when a page that names it opens (`pageOpened`), except load-on-demand AnimHotspots (`0x10`) and PlayPicsNoLoad. Released when no page uses them and they are not playing; sounds play on after their page closes. States: idle, starting (asked to play while loading), playing, paused, ended.
- **Timing** (§2): a player hands the whole soundtrack (pre-roll included) to the sink and draws frame *k* once the sink's clock passes the voice's `startTime` + `picsFrameTimes(file)[k]`, the start of sound chunk *k*. Late updates draw every due frame in order. It ends when the sound has played out (the AnimHotspot's finished event, the nav button's action). Nothing in the engine reads a system clock: the audio clock is the sink's.
- **Sinks** (`media/audio.ts`): `AudioSink` = `now()` (seconds heard) + `start(clip, offset)` → `{ startTime, stop }`. `ClockAudioSink` is silent and reads an engine `Clock`, for tests and tools; `headlessMedia(source, clock)` builds one. The web app's `WebAudioSink` turns clips into `AudioBuffer`s.
- **Frames on screen** (§3): drawn into the panel's `PanelLayer` (an indexed buffer with a mask) and painted over the panel's objects on every render, so they stay after the animation stops or ends, show under popups, and go when the panel is repainted: a page change, or a window closing or moving off them (the uncovered part). A ChangePage keeps the layer of a shared panel that stays (rendering.md §2). The A–Z letter, lamp and go button, and an AnimationControl strip that changes, draw over what is in the layer there.
- **Queueing, stopping** (§4–5): PlayPics/PlayWave of a playing file queue; stop all media stops and rewinds what plays (paused and ended players keep their place); StopWave/StopPics by name; SeekPics rewinds the latest animation.
- **AnimationControl** (§7): the strip (`ControlStrip` on the object's look) shows rest, playing, paused or ended (bitmaps 115/117 rewind, 116/119/120 play/pause/ended, 159 progress). Play toggles pause; starting first stops all media; rewind stops all media and goes back to rest. The message number in its last `i16` presses play.

`Engine.load` options: `presentation` (`'win31'`, the default, or `'wine'` to match the Wine reference captures), `startPage` (a page ref, or `null` for none), `cacheBytes` (decoded pictures kept for reuse), `clock`, `media`.

## Data sources

All file access goes through `DataSource` (`read(path)`, `exists(path)`): paths relative to the disc root, `/` separators, matched ignoring case.

| Implementation | Where | Use |
|---|---|---|
| `MemoryDataSource` | here | unit tests, files supplied in memory |
| `HttpDataSource` | `apps/web` | the web app: `/data/manifest.json`, then `/data/<path as on disc>` |
| `DirectoryDataSource` | `@twtw/node` | tests and tools: an extracted disc in a directory |

`FileIndex` resolves any spelling of a path to the stored one, from a manifest or a file list.

## Pieces

- `engine.ts`: the `Engine`: state, input tasks, event dispatch, page actions, the navigation bar, the A–Z dial, rendering.
- `input/`: hit-testing (`hit-test.ts`), cursor names and the EXE cursor images (`cursor.ts`), `DoubleClickDetector`.
- `media.ts`: the `Media` hooks and `SilentMedia`. `media/playback.ts`: `PlaybackMedia`, `headlessMedia`. `media/audio.ts`: `AudioSink`, `ClockAudioSink`. `clock.ts`: `Clock`, `VirtualClock`, `AdvancingClock`. `history.ts`: the 32-entry history. `zoom.ts`: the zoom rectangles, timing and inverted outlines.
- `content.ts`: loads `DKCODE/TWTW.PNG`, the program's resources and the master palette.
- `pictures.ts`: `PictureStore`, decoding `.DIB` files (with a bounded cache) and program bitmaps once each.
- `page.ts`: `instantiatePage` builds a `PageInstance`: the panel list, panel rectangles, panel colours as palette indices, and every object placed with what it draws. The A–Z dial's letter, lamp and "go" button are mutable `DialState`.
- `render/paint.ts`: panel painting, scroll bars, AnimationControl strips and the dial. `render/layer.ts`: `PanelLayer`, the frames drawn over a panel. `render/window.ts`: popup windows: placement per `Presentation`, caption strip, drop shadow. `render/focus-rect.ts`: the dotted drag rectangle. `render/canvas.ts`: `IndexedCanvas`.
- `screen.ts`: framebuffer, `SCREEN_*` (640×480) and `CLIENT_*` (638×459, the original client area).

`@twtw/engine/testing` builds synthetic discs (pictures, animations with `syntheticPics`, sounds with `syntheticWave`, a program with a palette and the engine's bitmaps) and provides `ManualClock`, `RecordingMedia` and `RecordingAudioSink` for tests.
