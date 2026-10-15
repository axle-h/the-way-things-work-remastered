# Behaviour: input, events, actions, history, cursors, keyboard

How the original program reacts to the user: which window and object receive a mouse event, when a click counts, how handlers and actions run, what each page action does, the navigation bar and its history, the cursors and the keyboard. It is written for Phase 4 (interaction). Sound and animation playback, which several rules here refer to, is in [playback.md](playback.md). Drawing is in [rendering.md](rendering.md). Markers: [V] verified against the original running under Wine, [C] read from the code, [H] hypothesis. Addresses are provenance only.

Terms used throughout:
- **Page window**: the base page draws into the main window; each popup (and the index page) has its own window (rendering.md §7). The program keeps a list of open page windows, oldest first. The base page's window is always the oldest, so it heads the list; popups are appended as they open [C] (`1008:9346`).
- **Active page**: the page that most recently received a mouse press. It also changes when a page opens or changes (below). New popups are **owned** by the active page's window [C] (`1020:134c`).
- **Focus page**: the popup (or base page) with the keyboard focus; its caption strip is drawn active (rendering.md §7.3).
- **Stop all media**: stop every sound and animation that is playing and rewind it to its start (playback.md §5). It reports whether anything was playing. Many input rules use that report.
- **Busy**: while the program is busy (a page change, a popup opening, a click being handled), it shows the Windows hourglass and ignores all mouse buttons and mouse moves aimed at page windows [C] (`1010:64ba`, `1010:64e4`, window procedure `1018:8782`).

## Rules in short

1. A mouse **press** goes to the page window under the pointer. Inside it, the first panel (in panel-list order) whose rectangle contains the point is chosen, then the **last** object (in data order) whose rectangle contains it. Rectangles include all four edges. That object captures the mouse. Nothing visible happens on a press [C].
2. The **release** decides. In content panels (and popups), if the page's window owns open popups, they are closed and the click does nothing else. Otherwise the click goes to the pressed object if the release point is still inside it [C].
3. Most clicks first **stop all media**. If something was playing, the click usually does nothing else ("click to stop"). Hotspots with flag `0x1` act anyway [C].
4. **Page actions are deferred.** OpenPage, ChangePage and ClosePage are queued and run after the click has been handled, in order. Sound, animation and the other actions run at once, in list order. No action ends the list early [C].
5. ChangePage of the base page closes all popups. OpenPage of a page already open does nothing [C].
6. **Back** returns to the previous base page in a history of up to 32 base pages. Popups are never recorded [C].
7. The keyboard does nothing on ordinary pages [C][V].

## 1. Mouse routing

### 1.1 Which window [C]
- Windows sends the press to the window under the pointer: the topmost popup there, or the main window. The press makes that page the **active page**, and, if it is a focusable popup (template no-focus flag 0, every popup on the disc), the focus page (`1018:8782`, `WM_LBUTTONDOWN`).
- While an object holds the capture (after a press), moves and the release go to the capturing page wherever the pointer is.
- The point is in the receiving window's client coordinates. For a popup with a caption strip, the panel coordinates are found by subtracting the panel position and the 8-pixel caption height (rendering.md §7.2). For base pages the caption height is 0.
- Clicks on a popup's caption strip and shadow are not client clicks; see §5.

### 1.2 Which panel [C]
Panels are tested in panel-list order (rendering.md §2: the page's own panels, then the template's). The first panel whose rectangle contains the point wins. A panel's rectangle is (x, y, x + width, y + height) **including** the right and bottom edges, so neighbouring panels share a row or column. The page's own panel, which comes first, wins on the shared line: page column 94 and row 454 belong to the content panel, not to the nav bar or the bottom frame (`1008:c8a2`, `1010:09a8`).

### 1.3 Which object [C]
- Objects are tested from the **last to the first** in data order, so the topmost drawn object wins (`1010:0936`).
- An object's rectangle (left, top, right, bottom) contains a point when left ≤ x ≤ right and top ≤ y ≤ bottom: **every edge is inside** (`1008:4aa2`). A hotspot stored as (171,170,199,195) answers on a 29×26 area.
- Every object type is a candidate, including Bitmaps, which usually cover the whole panel and so catch every click that misses the hotspots, and WordBoxes. All 660 WordBoxes have the rectangle (0,0,0,0), no cursor and no handlers [V], so at most they catch a click on panel pixel (0,0), which then only stops media.
- Bitmap rectangles are the picture's size after loading (rendering.md §4).

### 1.4 Press [C]
- The object found captures the mouse: later moves and the release go to it (`1010:03d0`). Object flag `0x2` would prevent this; it never occurs on the disc.
- No object type does anything visible on a press, except the CancelButton (draws its pressed picture, §3) and the A–Z dial (§7).
- A press that hits no object does nothing.

### 1.5 Release in a content panel (Display panels) [C]
Provenance `1020:2bba`. Display panels are the content panel of every base page, the frame pieces, and the panels of popups and the index page.
1. Become busy (hourglass).
2. If no object was pressed in this panel, close the popups owned by this page's window and stop.
3. Release the capture.
4. If this page's window owns open popups, **stop all media**.
5. **Close every popup owned by this page's window.** If any was closed, the click ends here: the hotspot under the pointer is not activated. This is why a click on the base page outside a popup closes the popup and does not reach the base page [V]. Closing a popup also closes the popups it owns (they are owned windows) [C].
6. Otherwise test the release point against the rectangle of the **pressed** object, using the point **one pixel lower** than the pointer (y + 1; a quirk of this code path only). Inside: the object's click behaviour runs (§3). Outside: stop all media, nothing else. So a click counts only if the press and the release are on the same object.
7. Stop being busy. The cursor is then recomputed as if the mouse had moved (§6).

### 1.6 Release in the nav bar and the A–Z dial [C]
The NavPanel and the AZDial panel use a simpler release (`1010:04a8`):
- release the capture;
- find the object at the release point afresh (§1.3, no y + 1), which need not be the object pressed;
- give it the click.

They do **not** close popups first. So nav buttons work while popups are open; the actions they trigger close popups where needed (§4.4, §6).

### 1.7 Double clicks [C]
The window class asks Windows for double clicks (`CS_DBLCLKS`, `1018:86ce`). The second press of a double click therefore arrives as a double-click message, not as a press. The program then ignores the next release. **A double click acts as a single click**; the second click is lost. The shared window procedure also sets "ignore the next release" on the private message `0x403`, but the only sender of that message, the Index page's keyboard hook, sends it to the Index window, whose own procedure consumes it (special-screens.md §1.9), so in practice only double clicks trigger it.

### 1.8 Moves [C]
A move updates the cursor (§6); nothing else reacts to hover. No hover highlights or hover animations exist. Moves are routed like presses (§1.2, §1.3), or to the capturing object.

## 2. Events and handlers

### 2.1 Events [C][V]
| Event | Name | Fired |
|---|---|---|
| 1 | open | page and panel open (rendering.md §8) |
| 2 | app activated | no use on the disc |
| 3 | close | no use on the disc |
| 4 | click | a click accepted by a Hotspot or the CancelButton (§3) |
| 5 | before open | popup pages, before their panels open |
| 6 | finished | an AnimHotspot's animation has ended (playback.md) |

On the disc only object click handlers (10,540), object finished handlers (191, all on AnimHotspots) and 22 panel open handlers occur. Pages, templates and the product have no handlers [V].

### 2.2 Who runs [C]
Firing event *e* at an object (`1010:8938`) runs, in order, all handlers for *e* of:
1. the object itself;
2. the active page (if it is still open);
3. the active page's template;
4. the product.

Every level runs; none stops the others. Because only object and panel handlers exist on the disc, a remake can run just the object's handlers, but must keep the order if it supports the others.

### 2.3 Running an action list [C]
Provenance `1010:883e`, queue `1010:5694`, `1010:5606`, `1010:56b4`.
- Actions run in list order.
- **OpenPage, ChangePage and ClosePage are deferred**: each is copied into an application-wide queue, and the main window posts itself a private message (`0x400`) once per batch. When that message arrives, after the current input handling has returned, the queued page actions run in queue order, and the queue is emptied.
- All other actions (PlayWave, PlayPics and its variants, Stop/Seek, SendMessage, ProductOption) **run immediately**, where they stand in the list.
- No action ends the list. Examples from the disc:
  - `PLAYWAVE, CHANGEPAGE` (96 handlers, popup to popup on the Principles pages): the sound starts, then the page changes;
  - `CHANGEPAGE, OPENPAGE` (2, the A–Z machine): both run, in order, after the click;
  - `OPENPAGE, OPENPAGE` of the same popup (3): the second does nothing (§4.1).
- If an action fails, the busy state is cleared.

## 3. What a click does, by object type

"Was playing" below is the report of stop all media.

| Object | On an accepted click (§1.5 step 6, or §1.6) [C] |
|---|---|
| Hotspot (603) | See below |
| AnimHotspot (607) | Stop all media. If something was playing, nothing else. Otherwise, if its animation is not already playing (and, with flag `0x10`, after loading it), start it (playback.md §6). Provenance `1028:3c02` |
| NavHotspot (606) | Become busy, then as AnimHotspot with the button's own animation (`NAV\NAVB0MnA`). When that animation ends, perform the button's action (§6). If something was playing, the press only stops it, and the button must be pressed again. Provenance `1020:c874`, `1020:c8a2` |
| AZHotspot (604) | Turn the dial (§7). No media stop |
| CancelButton (608) | Press: stop all media and draw EXE bitmap 171. While pressed, moves show 171 inside the rectangle and 170 outside. Release: draw 170; inside, fire click (its handler is a ClosePage). Provenance `1030:2eb2`, `1030:2f18`, `1030:2fb2` |
| AnimationControl (602) | Its buttons (playback.md §7) |
| ScrollBitmap (609) | Stop all media, nothing else (special-screens.md §3.3) |
| ScrollBar (610) | Its own press, drag and auto-repeat; no media stop, no events (special-screens.md §3.3) |
| Bitmap (601), WordBox (605), anything else | Stop all media, nothing else |

**Hotspot** (`1010:b8d8`), with its flags:
1. If flag `0x4` is set, stop all media.
2. If something was playing, and flag `0x1` is clear, stop here: the click only stopped the media.
3. If the point is inside the rectangle: draw the pressed highlight (style = the Hotspot's `i16`; it is 0 everywhere on the disc, so nothing is drawn), then fire the **click** event (§2.2).

Flag values on the disc [V]: 10,338 Hotspots have `0x4` ("a click while something plays only stops it"); 200 have `0x5`, all on Principles of Science and title pages ("stop, then act anyway"); one title-page Hotspot has `0x1` alone ("act without stopping anything").

## 4. Page actions

### 4.1 OpenPage [C]
Provenance: execute `1018:d956`, `1010:4ee6`, `1010:4fec`, popup open `1020:134c`, window creation `1018:22a4`.
1. Become busy and release any mouse capture.
2. If any open window already shows this page, **do nothing**: the window is not raised and no zoom plays.
3. Load the page and remember its effect flag (the action's `u16`: 0 none, 1 zoom).
4. For a popup: compute its window rectangle (rendering.md §7.2). If the effect is zoom, play the opening zoom (§4.2). Then create the window, owned by the **active page's** window.
5. The new popup becomes the active page. If it can take the focus, it becomes the focus page, the previous focus popup's caption is redrawn inactive, and it gets the keyboard focus. It remembers which page was active before it, for §4.4.
6. Its first paint and open events follow (rendering.md §8).

A page that is not a popup could only be "opened" by the two `OPENPAGE` actions that follow a `CHANGEPAGE` to the same base page (the A–Z machine). By then the page is open, so they do nothing (step 2).

### 4.2 Zoom effect (OpenPage flag 1) [C]
Provenance `1018:2700`, called from `1018:22a4` (open) and `1018:24f0` (close).
- **Endpoints.** The start is a point: the position of the **last mouse press**, in the receiving window's client coordinates, offset by the main window's outer top-left and the caption height. (Under Windows 3.1 that is one pixel left of the pressed pixel. A press inside a popup is offset as if it were in the main window, a quirk.) The end is the new window's full rectangle, caption strip and shadow included.
- **Ten rectangles** are interpolated. With *p* the percentage of the way to the window, the open uses *p* = 0, 1, 3, 10, 17, 25, 33, 50, 70, 100 (slow start, fast finish). Each edge is `point × (100 − p) / 100 + window edge × p / 100`, each product truncated toward zero separately and then added. The first rectangle is therefore the bare point.
- **Drawing.** Each rectangle is an outline drawn with an inverting pen on the screen, over everything: four one-pixel lines from (left, top) to (right, top) to (right, bottom) to (left, bottom) and back, each line leaving out its end pixel, so the outline covers columns left…right and rows top…bottom once. Inverting an 8-bit palette index *v* gives 255 − *v*. Drawing the same outline again restores the pixels.
- **Timing.** One step every 50 ms, starting at once, 12 steps: at step *s* (0–11), draw rectangle *s* if *s* < 10, and erase rectangle *s* − 3 if *s* ≥ 3. After step 11 erase rectangle 9. So up to three outlines are visible at a time, and the effect lasts about 550 ms. Mouse messages arriving meanwhile are discarded; other messages are processed.
- The zoom runs **before** the window exists, so the base page shows under it, with the hourglass cursor.
- **Closing.** When a popup opened with zoom closes, the same effect runs in reverse after its window has gone: from the window rectangle to the same start point, with *p* = 100, 70, 50, 33, 25, 17, 10, 3, 1, 0 towards the point (fast start, slow finish).
- **Sounds.** The code would play a sound from `NAV\` while zooming (open: `nav\` + name, close: `nav\r` + name), but its table of names is empty in this build, so nothing plays [C]. `NAV\ZM.WAV` and `NAV\RZM.WAV` on the disc are therefore unused, though they are evidently the zoom sounds. Worth confirming by watching file opens under Wine.

### 4.3 ChangePage [C]
Provenance `1018:c1a0`; rendering.md §2 and §7.7 describe the repaint and window placement.
1. Become busy and release any capture. Load the new page.
2. **Pick the window.** Count the open windows whose page type equals the new page's. If exactly one, use it. Otherwise, if the focus page has that type, use it. Otherwise the action fails. In practice a change to a base page always uses the main window, and a change to a popup uses the popup when only one is open, else the focused popup.
3. If that window **already shows the new page**, only close the popups it owns, and stop.
4. Otherwise replace the window's page: close the popups owned by this window, discard the old panels, load and paint the new ones (with the transition id, rendering.md §3), run the panels' open handlers and start their objects (rendering.md §8). The window becomes the active page.
5. After success, the history records the base page (§6.3).

Consequences:
- A **base-page change closes every popup**: they are owned by the main window, or by popups that are. This happens during step 4, before the new page is painted, whichever window issued the change. Observed under Wine: Airplane (1538) → See Also popup (1188) → its Airship hotspot → base page 3330 with no popup left [V].
- A **popup-to-popup change** keeps other popups open, except those owned by the changing popup.
- The old page's objects go with it; their players are closed. Whether a sound started by the old page keeps playing is in playback.md §5.

### 4.4 ClosePage [C]
Provenance `1030:3d62`, popup close around `1020:1900`.
- If an open window shows the page, close it; otherwise nothing.
- Closing a popup: close the popups it owns; if it was focusable, give the focus back to the page that was active when it opened, and make that the active page again; destroy the window; if it was opened with zoom, play the closing zoom (§4.2).
- The program uses the same close for the popup's system box and shadow (§5).

### 4.5 SendMessage (target, message) [C]
Provenance `1020:e598`. The two `i16` fields are the **target object id** first, then the **message**. The target is looked up among the objects of the panel that owns the handler: the object's own panel for an object's handler, or the panel itself for a panel handler. The first object with that id receives the message; if none, nothing happens. The only data value, (181, 59), always names an AnimationControl with id 181 in the same panel [V] (76 object handlers and the 22 panel open handlers). The AnimationControl answers only the message number stored in its own last `i16` (59 on every control): it acts as if its first button, play/pause, had been clicked (`1028:8566`), so `(181, 59)` means "press play on control 181". Details in playback.md §7.

### 4.6 ProductOption [C]
Provenance `1030:1f84`.
- 1: copy, and 2: print, act on the page recorded when the Options button was pressed (§6.2), if that page is still open.
- 3: the print setup dialog.

What they output is in special-screens.md §4.

## 5. Popup caption strip and shadow [C]
Provenance: hit test `1020:1b1c`, window procedure `1018:8782` (`WM_NCHITTEST`, `WM_NCLBUTTONDOWN`, `WM_NCLBUTTONUP`).

The popup window classifies a screen point (window coordinates, *s* = shadow width, window size Wt×Ht):
1. In the **shadow band**, x ≥ Wt − *s* or y ≥ Ht − *s* (the whole right and bottom bands, the corners included): like the system box.
2. In the **caption**, rows 0 to 8 (the 8-pixel strip plus the picture's first row; a quirk), with x < 12: the **system box**. Elsewhere in those rows: the **caption**.
3. Elsewhere: the client area (§1).

Behaviour:
- **System box and shadow:** pressing there makes the popup the focus page; then the program waits for the release. If the release is also on the system box or shadow, the popup **closes** (as ClosePage, §4.4).
- **Caption:** pressing makes the popup the focus page and starts a drag. If the popup owns other popups, they are closed instead and no drag starts. Otherwise a dotted focus rectangle the size of the window minus the shadow follows the mouse (drawn with XOR), and on release the popup moves there, without changing its size or stacking. A press that does not move leaves it in place.
- Verified under Wine: shadow and system-box clicks close the popup; a click elsewhere on the caption does not [V].
- **Alt+F4** with a popup focused closes that popup, not the program. With the main window focused it closes the program at once (program.md).

## 6. Navigation bar and history

### 6.1 Pressing a nav button [C]
The nav bar is a NavPanel (§1.6). The press and release select a NavHotspot. The click:
1. busy (hourglass);
2. stop all media; if something was playing, nothing more happens (press again);
3. play the button's animation (`NAV\NAVB0M0A` … `NAVB0M8A`, the press-in of that button) over the nav bar;
4. when it ends: rewind it, stay busy, and perform the button's action (page-database.md NavPanel table, `1020:d6bc`).

"Go to a page" (`1010:6360`), used by buttons 0–4, 6 and 7 and by the A–Z machine: look at the target page's type; ChangePage to it if it is a base page, otherwise OpenPage (flag 0). Both are queued like the data's actions (§2.3). So the Principles button on a page whose link 0 is a `\RELA\` popup opens that popup over the article.

### 6.2 The special buttons [C]
- **Back (5):** §6.3.
- **Index (6)** and **Help (7):** if the Index (or Help) page is open, close it; then go to it. Pressing Help while Help is open therefore closes and reopens it.
- **Options (8):** close both Options popups if open. Record the **newest open window** (the topmost popup, else the base page) as the page that copy and print act on (§4.6), and make it the active and focus page. Then open the first Options popup at once (not queued), with flag 0.

### 6.3 History and Back [C]
Provenance: history hook `1020:64c8`, list `1008:2f22`, Back `1020:d7f0` → `1008:313a`.
- The history is a stack of page references, at most **32**; when a 33rd is pushed, the oldest is dropped.
- **Push:** after every successful **ChangePage**, from whatever source (data, nav buttons, Back), the program pushes the page shown in the oldest window, which is always the **base page**, unless it equals the top entry. Popups are never recorded, and a popup-to-popup ChangePage pushes nothing new.
- The **startup page is not recorded**: it is opened, not changed to. The history starts empty. The capture harness's direct starts also begin with an empty history (reference-environments.md).
- **Back:** if the stack holds fewer than two entries, nothing happens. Otherwise pop the top (the current base page), pop the entry below it, and go to that page (§6.1). Going there pushes it again, so repeated Backs walk down the stack.
- **Back with nothing to go back to hangs the input** [C][V]. The nav button sets the busy state before dispatching (§6.1 step 4), and only a page change or another queued action clears it. When Back finds fewer than two entries, nothing clears it: the program stays busy, shows the hourglass and ignores every mouse press and move until it loses and regains activation (§10 clears the busy state). Observed under Wine: on a direct start at the Airplane, pressing Back and then the Workshop button does nothing at all; Workshop → Machines → Back returns to the Workshop, and a second Back followed by Machines again does nothing. A remake should not reproduce the hang (a deliberate difference to agree with Alex): treat such a Back as a no-op that ends the busy state.
- ChangePage closes all popups (§4.3), so Back with popups open closes them.
- Verified under Wine [V]: from a direct start, Workshop button, Machines button (the A–Z machine), Back → the Workshop.
- Example: on a cold start the title chain changes page three times (still title, transition page, Workshop), so the stack is [still title, transition, Workshop]. Back from the Workshop returns to the **transition page**, which replays its animation and changes to the Workshop again by itself [H: follows from the code; check on DOSBox-X, since Wine stalls animations].

## 7. The A–Z machine [C]
Provenance `1020:abf2`, timer `1020:b0a8`, load `1020:afbc`, animation end `1028:b39c`.
- The AZDial panel keeps a current letter, 0–25 (A–Z), which starts at A whenever the page loads.
- A press on the dial panel first closes popups owned by the page, then proceeds as a normal press (§1.4). While the "go" animation runs, presses on the dial are ignored.
- Each AZHotspot's second `i16` is a **code** [V: 0–28 on the disc]:
  - 0–25: make that letter current;
  - 26: previous letter (A wraps to Z);
  - 27: next letter (Z wraps to A);
  - 28: **go**.
- For codes 0–27: play `\AZAZ\DIAL.WAV` (a PlayWave with the same unnamed values as the data's, playback.md §4), then redraw the current letter's picture (rendering.md §6).
- For go: draw EXE bitmap 352 at panel position (320,335) (the pressed button), play the current letter's animation (the AZDial string for that letter, e.g. `AZAZ0MAA.ANI`) over the dial, and when it ends go to the letter's page (the AZDial `pageref` for that letter, §6.1).
- The lamp blinks once a second throughout (rendering.md §6).

## 8. Cursors [C]
Provenance: table `1010:c70e`, set `1010:4e04`, hover `1008:5c4c`, busy `1010:648e`.
- **Names:** `Normal` and `Arrow` select cursor group **157** (the arrow), `Hand` selects group **107** (the pointing hand); program.md has their images and hotspots. Names are compared **ignoring case**, so the data's `normal` is the arrow too. An empty or unknown name leaves the cursor as it is.
- The fallback name is `Arrow`. The product record's default cursor (also `Arrow`) is not consulted.
- **Over an object**, the cursor is:
  - `Arrow`, if the object's page window owns open popups (a click there would only close them);
  - otherwise the object's own name, if nothing is playing;
  - otherwise (something plays) the object's own name only if its flag `0x1` is set, else `Arrow`. During playback most hotspots therefore show the arrow, because a click would only stop the media.
- Over a panel but no object, or over a page window outside every panel: `Arrow`.
- The CancelButton shows its own name (`Hand`) [C].
- **Busy:** the Windows hourglass. When the busy state ends, the program recomputes the cursor as if the mouse had moved over the window under it. A nav button keeps the hourglass from the press until its page change has completed.
- Before the first move, the window class cursor is the standard Windows arrow.
- Under Wine the cursor is an X cursor and never appears in captures [V].

## 9. Keyboard [C][V]
- The program forwards F1–F24 and typed characters to the focused page (program.md). The panels of ordinary pages ignore them: **no key does anything** on base pages and popups [C], matching the observation that F1, F2, `a`, Esc, Backspace, Tab, Page Up, Left, Esc and Enter have no visible effect [V].
- Alt+F4 closes the focused popup, or the program from the main window (§5).
- The Index page has its own keyboard handling: Tab, Enter, Esc and the list keys (special-screens.md §1.9).

## 10. Application activation [C]
When another application becomes active, the program stops all media and redraws the focus popup's caption as inactive (`WM_ACTIVATEAPP`). A remake can treat the page becoming hidden (or the window losing focus) the same way.

## 11. For the remake
- Map a pointer tap or click to one press and one release at the same point. A tap is never a double click (§1.7); on desktop, a second click within the system double-click time and distance should be ignored to match the original, or simply accepted (a deliberate, harmless difference). Record the choice.
- Hit-test with inclusive rectangles, last object first. Keep the release test of §1.5 step 6 (pressed object, y + 1) if exactness matters; it only changes the outcome on the bottom row of a hotspot.
- Defer page actions to after the handler, in order.
- Keep "a click while something plays only stops it" (§3, §6.1): children will notice when a button needs two presses.
- Choices made (Phase 4): mouse double clicks are treated as in the original (the second click is ignored, Windows 3.1's 500 ms and 4×4 pixels); taps never form a double click. **Deliberate difference:** Back with fewer than two history entries does nothing and leaves the program usable, instead of keeping it busy (§6.3).

## 12. What to check against the original
In Wine (fine for everything not timed by animations):
Done [V] (Wine, 2026-10-15):
- A popup opened from a popup (Airplane 1538 → popup 2982 → popup 110304): a click on 2982's picture closed only 110304; a click on the base page then closed 2982 (§1.5).
- A click (press and release) on a popup's shadow or system box closed it; a click on the rest of the caption did not (§5).
- Back and its hang (§6.3).

Still to check:
1. Dragging a popup by its caption (dotted rectangle, move on release).
2. Double click on a hotspot acts once.
5. A nav button pressed while a sound plays only stops the sound (needs audible output, or the debug channel of reference-environments.md showing `WQ::Stop`).
6. File opens of `NAV\ZM.WAV` / `RZM.WAV` during a zoom popup (expected: none).
7. The cursor over a base hotspot while a popup is open (expected: arrow; Wine shows X cursors, so read it with `xdotool`-style queries or `XFixesGetCursorImage`).

In DOSBox-X (Windows 3.1): the zoom outlines and their timing, Back from the Workshop replaying the transition (§6.3), and the hourglass during a nav button's animation.
