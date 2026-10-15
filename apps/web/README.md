# @twtw/web

The browser app: a full-viewport canvas showing the engine's indexed framebuffer at a crisp integer scale, pointer and keyboard input, the original's cursors, and sound through Web Audio. `pnpm dev` serves it with the extracted disc under `/data` (`vendor/cd`, or `$TWTW_CD`).

## Presentation (Phase 7)

**Scaling** (`src/stage.ts`, pure and unit-tested; `src/presenter.ts` draws). Everything is decided in device pixels, as PLAN §3 "Scaling rules" says:
- The canvas covers the viewport. Its backing store is its box in device pixels, from `ResizeObserver`'s `devicePixelContentBoxSize`, or `clientWidth × devicePixelRatio` where that is missing (Safari). So the browser never resamples; `image-rendering: pixelated` and `imageSmoothingEnabled = false` are there as well.
- The presented area is drawn at the largest whole scale k ≥ 1 that fits, with nearest neighbour, centred and letterboxed in black. Below 1× it is shrunk with nearest neighbour at the largest scale that fits, and the debug overlay then shows a "BELOW NATIVE" line.
- **Fill mode** (a setting, off by default) uses the largest non-integer scale instead: still nearest neighbour, the pixels a little uneven.
- Pointer positions go back through the same layout in one place, `clientToFramebuffer`. Presses in the letterbox are ignored.
- The original's cursors are scaled to match: each cursor pixel is about one picture pixel on screen (`cursorScale`, 1–4 CSS pixels). Off the picture the browser's own arrow shows.
- Chromium's emulated device pixel ratio (DevTools device mode, Playwright) is not applied to `devicePixelContentBoxSize`. When that box disagrees with `clientWidth × devicePixelRatio` by more than 2 pixels, the presenter uses the latter.

**Presented area.** The original's window client area is 638×459, while the engine's framebuffer is 640×480 with the page at (0,0). The app shows and hit-tests only the client area: `PRESENTED_AREA` in `src/stage.ts` is `CLIENT_AREA`, 638×459 at (0,0). Setting it to `FRAMEBUFFER_AREA` shows the full 640×480 instead; scaling and hit-testing both follow it. *Open for Alex: 638×459 (the default) or 640×480.* On a 1080p screen both give 2×.

**Phones and tablets.**
- **Portrait phones** get a "Turn your device sideways" screen. The test is a portrait viewport whose short side is under 500 CSS pixels (`isPortraitPhone`). Tablets in portrait still show the stage, letterboxed.
- **Gestures.** The stage takes every touch, with no double-tap zoom, pinch, panning, long-press menu or text selection. The page never scrolls or bounces, and the viewport cannot be zoomed. A tap is a click that acts on release, as with the mouse.
- **Soft keyboard for the Index.** A tap on the Index's edit box focuses a hidden text field, which brings up the keyboard. The field mirrors the edit box, and its changes go to the engine (`Engine.setIndexEditText`; special-screens.md §1.12).

**Full screen and installing.**
- **Settings → Full screen** uses the Fullscreen API. On a phone it also asks the browser to keep the screen in landscape, where the browser allows it.
- iPhone Safari has no element fullscreen, so the menu suggests Share → Add to Home Screen instead. `public/manifest.webmanifest` asks for `fullscreen`, falling back to `standalone`, in landscape. The Apple meta tags in `index.html` do the same on iOS.
- The icons (`public/icons/`) are our own: two gears drawn by `scripts/icons.ts`. Run `node apps/web/scripts/icons.ts` to redraw them.

**Settings** (the gear in the top-right corner, in the letterbox where there is one):
- fill mode;
- volume, through the Web Audio output gain;
- full screen;
- **Copy picture** and **Print picture** (Phase 8, below);
- "Show page info", the debug overlay listing the pages on screen, the history, loading problems and the stage's scale.

Settings are kept in `localStorage` (`twtw.settings`), and the app works without storage. While the menu is open, keys go to the menu and not to the engine.

**Prefetching** makes navigation snappy:
- **What.** Once a page is on screen and the engine is idle (after 400 ms), the engine lists the files the next tap may need (`filesToPrefetch` in `@twtw/engine`). First come the sounds and animations the pages on screen play, then the pictures of the pages their hotspots, navigation buttons and link block lead to (plus the Back target), then those pages' sounds and animations.
- **How.** `src/prefetch.ts` fetches them two at a time at low network priority. It skips files over 1 MB (long animations) and stops after 16 MB per page. A new page replaces the list.
- **Where they go.** The HTTP data source keeps fetched and recently read files in a 64 MB least-recently-used memory cache (`src/byte-cache.ts`), and a read joins a prefetch already in flight.
- Prefetching starts only after the first page shows, behind the "tap to start" gate, and needs no gesture. There is no Service Worker.

**Device checks** (PLAN §5.7): `pnpm test:devices` runs Playwright (`e2e/devices.e2e.ts`, Chromium) against the dev server on port 47391 (`$TWTW_E2E_PORT`), with `/data` from `$TWTW_CD` or `vendor/cd`. Without the disc the tests skip.
- **Viewports:** 1920×1080@1, 1366×768@1, 1440×900@2, 1024×768@2 (touch), 768×1024@2 (touch), 844×390@3 (touch), 568×320@2 (touch), 390×844@3 (portrait) and 600×400@1 (below native).
- **Checks:** the scale and fit; that the backing store equals the viewport in device pixels; centring; the portrait screen; that a tap or click on a hotspot of the Airplane page reaches its target page; the Index soft keyboard; the fill setting surviving a reload; and Copy and Print (below).
- **Screenshots:** set `TWTW_SCREENSHOTS=<dir>` to save one per device, and the printouts as PDFs (`print-base-A4.pdf`, `print-popup-Letter.pdf`, …). They show disc content, so keep them out of the repository. Playwright's own output goes to the gitignored `test-results/`.

## Copy and print (Phase 8)

What the original copies and prints is in `docs/formats/special-screens.md` §4: the page's picture with a 40-row white band and the copyright line, 638×499 for a base page, W×(H+40) for a popup. The engine builds it (`Engine.copyImage`); `src/picture-output.ts` copies and prints it; the sizes and layout are pure functions in `src/print-layout.ts`, and the PNG encoder is `src/png.ts` (a palette PNG, deflated with the platform's `CompressionStream`; the canvas encoder stands in where that is missing).

**Where from.**
- The original's Options popup (navigation bar → Options): Copy active window, Print active window, Printer setup. They act on the page that was on top when Options was pressed.
- The settings menu's **Copy picture** and **Print picture**, which act on the page on top by the same rule (`Engine.pictureTarget`; never the Options popup itself).
- **Ctrl+P** (⌘P) prints the page on top in the same way. Printing from the browser's menu does too, best effort (the picture is made in `beforeprint`). The original has no keyboard shortcuts for copy or print, so there is no Ctrl+C.

**Copy** puts the picture on the clipboard as a PNG at **2×** (`COPY_SCALE`: 1276×998 for a base page) with `navigator.clipboard.write` and a `ClipboardItem`, called within the click so that the browser allows it, and shows "Picture copied". 2× rather than 1×: at its own size the picture is small on today's screens and the application it is pasted into enlarges it with smoothing; at 2× it is the size it appears on a high-density screen, and it stays a small palette PNG. The clipboard needs a secure context (`localhost` or HTTPS). Where it is missing or refuses, the app shows the picture instead, at a whole scale, to copy with a long press or right click, with **Save picture** (a download) and **Close** (Esc).

**Print** opens the browser's print dialog (`window.print()`) with a print-only element (`#print`, hidden on screen) holding only the captioned picture; the stage, the menus and the letterbox are hidden on paper.
- The picture is a **4×** PNG (`PRINT_SCALE`: 2552×1996 for a base page, about 300 pixels to the inch on paper), shown with `image-rendering: pixelated`.
- **Size:** every picture prints at one scale, the one at which a full 640×520 screen with its band fits the printable area (`printedSize`). So a full-screen picture spans the printable width or height, and a popup prints at W/640 of a full screen's width, as in the original (special-screens.md §4.8 has the small difference from the original's rule).
- **Orientation and margins:** landscape for a picture wider than tall (every base page), portrait otherwise, with 10 mm margins (`@page`, written per picture into `#print-page`).
- **Placement: centred** on the sheet, **Alex's decision**, instead of the original's top-left. `PRINT_PLACEMENT` in `src/print-layout.ts` is the one place to change it: `'centred'` (the default) or `'top-left'` (the original's). There is no setting for it.
- **Printer setup** (the Options popup's third option) opens the print dialog for the same page, because that is where the browser chooses the printer and paper. Cancelling it prints nothing, as cancelling the original's dialog changes nothing.
- Checked with Chromium's PDF output on A4 and Letter (`pnpm test:devices` with `TWTW_SCREENSHOTS`): one page each, the picture embedded at full resolution and not interpolated. Still to check by hand: Safari and Firefox print preview, and on paper.

## Sound and the "tap to start" gate

Browsers start audio only from a user gesture, so the app loads the page database behind a plain "Tap to start" button over the stage. The tap creates the `AudioContext` and then the title starts, with its animation and sound.

- The engine decodes the disc's sounds itself (MS-ADPCM and 8-bit PCM, `@twtw/formats`) and hands clips to `WebAudioSink` (`src/audio.ts`), which makes each into an `AudioBuffer` once and schedules it slightly ahead.
- Animation frames are timed by the audio clock (`docs/formats/playback.md` §2): the sink reports `AudioContext.currentTime` less the output latency, i.e. what is being heard, and the engine draws frame *k* when that reaches the start of sound chunk *k*.
- If iOS suspends audio (a call, the app in the background), the next tap or key resumes it. Switching tabs or apps stops all media, as the original does when it loses activation.

In development builds, `window.twtw` holds the engine, the media, the sink, the presenter and the data source, and `twtw.playbackLog` lists every voice start and every frame drawn with its audio-clock time, for checking sync from the console.

`#page=<ref>` in the URL starts at another page (after the gate), `#page=<ref>,popup=<ref>` opens popups over it, and `presentation=wine` places popups as in the Wine captures.

## Special screens (Phase 6)

- **Index**: typing, Tab, Enter, Esc, the arrows and Page Up/Down go to the Index while it is open; the list scrolls with its scroll bar, and by swiping on a touch screen (a tap on a row selects it, a tap on the selected row goes).
- **Help**: the scrolling Help pages scroll with their bar; on a touch screen the thumb keeps following the finger off the bar, and swiping the picture scrolls it.
- **Copy and print** (Options): see "Copy and print (Phase 8)" above.
- The page title is fixed: "The Way Things Work", as the original's window title.

## Playtest checklist (Phase 5)

Run on a laptop or desktop browser (Chrome, Firefox, Safari), a tablet and a phone in landscape, with sound on. Note the device, browser and anything that fails.

1. **Gate.** The page shows "Tap to start". One tap starts the title, with sound. Nothing plays before the tap.
2. **Title animation.** The title animation plays for about 16 seconds with its music; the pictures keep pace with the sound from start to end (no drift by the end), then the still title appears.
3. **Title to Workshop.** A tap on the still title plays the transition (about 38 seconds), which builds the Workshop picture in step with its sound and ends on the Workshop.
4. **Airplane.** Open the Airplane (`#page=1538`). Tap the propeller: it turns, in step with its sound, and stops on its last picture. Tap the other animated parts (controls, flaps): each plays with its sound.
5. **Click to stop.** While an Airplane animation plays, tap another hotspot: the animation and sound stop, the picture stays as it was, and nothing else happens. A second tap acts.
6. **Workshop sounds.** On the Workshop, tap the objects that make sounds: each plays once; tapping during a sound only stops it.
7. **Navigation buttons.** Each button plays its press-in animation (with its sound, about 2–3 seconds, hourglass cursor on desktop) before the page changes. Pressing a button while a sound plays only stops the sound.
8. **Movie pages.** Principles of Science → any principle with a film screen (e.g. Cams, `#page=295516`). The film starts by itself with its sound; the strip shows the pause button and a growing progress bar. Pause, then play: it resumes where it stopped. Rewind: it stops and the strip returns to rest. Let one play to the end: the last picture stays, the play button is greyed, the progress bar is full; play then starts it again from the beginning. Tapping the film screen or its labels while it plays stops it.
9. **A–Z dial.** On the Machines page, turn the dial (arrows and letters): each turn clicks. Press "go": the letter's animation plays with its sound, then the list for that letter opens.
10. **Popups over animations.** Start an animation, stop it with a tap, open a popup over the animated area and close it: the part the popup covered shows the page's still picture again (as in the original), the rest keeps the last frame.
11. **Background.** Start a long animation or film, switch to another tab or app and back: everything has stopped and the page is usable.
12. **Sync feel.** On each device, watch for frames lagging the sound (lip-sync style). Report any device where pictures run visibly ahead of or behind the sound, and whether Bluetooth headphones change it.
