# @twtw/engine

The DOM-free engine. It reads the original disc through a `DataSource`, keeps what is on screen (a base page and a stack of popup windows), takes pointer and keyboard input, runs event handlers and page actions, and draws into an 8-bit indexed 640×480 framebuffer. It runs unchanged in the browser and in Node. Behaviour follows `docs/formats/behaviour.md`, drawing `docs/formats/rendering.md`; the formats come from `@twtw/formats`.

Phase 4 adds interaction: hit-testing, clicks, events and actions, popup ownership, the navigation bar and its history, the A–Z machine, the zoom effect, cursors and keys. Sound and animation playback is Phase 5; the engine reaches it only through the `Media` hooks.

## Using it

```ts
import { createFramebuffer, Engine } from '@twtw/engine';

const engine = await Engine.load(source, { clock, media }); // database, palette, startup page
await engine.pointerDown(x, y); // page (framebuffer) coordinates
engine.pointerMove(x, y);
await engine.pointerUp(x, y); // a click acts on release; resolves when its page actions are done
engine.key({ key: 'F4', altKey: true });

const framebuffer = createFramebuffer();
requestAnimationFrame(function frame() {
  if (engine.update()) engine.render(framebuffer); // palette indices; engine.palette converts them
  canvas.style.cursor = cursors[engine.cursor]; // 'arrow' | 'hand' | 'wait'
  requestAnimationFrame(frame);
});
```

- **Input** (`pointerDown`, `pointerMove`, `pointerUp`, `pointerCancel`, `pointerLeave`, `key`, `setActive`): behaviour.md §1, §5, §9, §10. Input is one task at a time: while a task runs (`busy`, the hourglass) further pointer input is dropped, as in the original. `pointerDown(x, y, { doubleClick: true })` is the second press of a double click, which the original ignores with its release; `DoubleClickDetector` decides it as Windows does. `hitTest(x, y)` reports the window, area (client, caption, system box, shadow), panel and object under a point.
- **Page operations** (`reset`, `changePage`, `openPage`, `closePage`): the actions of behaviour.md §4, also used by tools. `reset` is a direct start: everything closes, the history is emptied and the page is not recorded.
- **State**: `basePage`, `windows` (popups bottom first, each with its `owner`), `activeWindow`, `focusWindow`, `history`, `busy`, `zooming`, `cursor`.
- **Time**: a `Clock` (`now`, `wait`) drives the zoom outlines and the A–Z lamp. The default `VirtualClock` jumps ahead whenever something waits, so headless use never blocks; the web app passes the browser's clock. `update()` advances time-based state and says whether to render again.
- **Media** (`Media`): `isPlaying`, `stopAll` (the rule "a click while something plays only stops it"), `runAction` (PlayWave, PlayPics, …), `playAnimation` (AnimHotspot clicks and autostart, nav buttons, the A–Z letter; its `ended` callback fires the finished event or continues the navigation), `control` (AnimationControl clicks and SendMessage), `pageClosed`. `SilentMedia` plays nothing; its animations end at once (or never, with `stalledAutostartMedia()` for rendering pages as they open).
- **Events** (`on`): `productOption` (copy, print, print setup; Phase 8), `quit` (Alt+F4 in the main window), `actionFailed`, `error`.

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
- `media.ts`: the `Media` hooks and `SilentMedia`. `clock.ts`: `Clock`, `VirtualClock`. `history.ts`: the 32-entry history. `zoom.ts`: the zoom rectangles, timing and inverted outlines.
- `content.ts`: loads `DKCODE/TWTW.PNG`, the program's resources and the master palette.
- `pictures.ts`: `PictureStore`, decoding `.DIB` files (with a bounded cache) and program bitmaps once each.
- `page.ts`: `instantiatePage` builds a `PageInstance`: the panel list, panel rectangles, panel colours as palette indices, and every object placed with what it draws. The A–Z dial's letter, lamp and "go" button are mutable `DialState`.
- `render/paint.ts`: panel painting, scroll bars and the dial. `render/window.ts`: popup windows: placement per `Presentation`, caption strip, drop shadow. `render/focus-rect.ts`: the dotted drag rectangle. `render/canvas.ts`: `IndexedCanvas`.
- `screen.ts`: framebuffer, `SCREEN_*` (640×480) and `CLIENT_*` (638×459, the original client area).

`@twtw/engine/testing` builds synthetic discs (pictures, a program with a palette and the engine's bitmaps) and provides `ManualClock` and `RecordingMedia` for tests.
