# @twtw/engine

The DOM-free engine. It reads the original disc through a `DataSource`, keeps what is on screen (a base page and a stack of popup windows) and draws it into an 8-bit indexed 640×480 framebuffer. It runs unchanged in the browser and in Node. Behaviour follows `docs/formats/rendering.md`; the formats come from `@twtw/formats`.

Phase 3 covers static rendering: pages as they look at rest. No handlers run, nothing animates, and there is no input yet. The places where open handlers and autostart animations will hook in are marked in `src/engine.ts`.

## Using it

```ts
import { createFramebuffer, Engine } from '@twtw/engine';

const engine = await Engine.load(source); // database, palette, startup page
await engine.changePage(ref); // base page, or the page in the top popup window
await engine.openPopup(ref); // popup or index page in a new window
engine.closePopup(); // top window (or closePopup(ref))

const framebuffer = createFramebuffer();
engine.render(framebuffer); // synchronous; palette indices
// engine.palette: 256 RGB triplets for converting to RGBA when presenting
```

State operations load everything the new page draws before they take effect, so `render` always sees a complete state. `Engine.load` takes options: `presentation` (`'win31'`, the default, or `'wine'` to match the Wine reference captures: popup offset, shadow over white, nearest-colour captions), `startPage` (a page ref, or `null` for none) and `cacheBytes` (decoded pictures kept for reuse).

## Data sources

All file access goes through `DataSource` (`read(path)`, `exists(path)`): paths relative to the disc root, `/` separators, matched ignoring case.

| Implementation | Where | Use |
|---|---|---|
| `MemoryDataSource` | here | unit tests, files supplied in memory |
| `HttpDataSource` | `apps/web` | the web app: `/data/manifest.json`, then `/data/<path as on disc>` |
| `DirectoryDataSource` | `@twtw/node` | tests and tools: an extracted disc in a directory |

`FileIndex` resolves any spelling of a path to the stored one, from a manifest or a file list.

## Pieces

- `content.ts`: loads `DKCODE/TWTW.PNG`, the program's resources and the master palette.
- `pictures.ts`: `PictureStore`, decoding `.DIB` files (with a bounded cache) and program bitmaps once each.
- `page.ts`: `instantiatePage` builds a `PageInstance`: the panel list (own panels, then the template's shared and empty slots), panel rectangles (size 0 = extent of the objects), panel colours as palette indices, and every object placed with what it draws at rest. The A–Z dial's letter and lamp are mutable `DialState`.
- `render/paint.ts`: panel painting (fill, objects in data order, clipped to the panel), scroll bars and the dial.
- `render/window.ts`: popup windows: placement per `Presentation`, caption strip, drop shadow.
- `render/canvas.ts`: `IndexedCanvas`, clipped and translated drawing into an indexed image.
- `screen.ts`: framebuffer, `SCREEN_*` (640×480) and `CLIENT_*` (638×459, the original client area; pixels outside it stay index 0 unless a popup reaches there).

`@twtw/engine/testing` builds synthetic discs (pictures, a program with a palette and the engine's bitmaps) for tests.
