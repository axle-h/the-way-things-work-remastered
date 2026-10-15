# Rendering: how the original draws pages

How the original program turns a page from the page database (`page-database.md`) into pixels: the client area, panels, display objects, popup windows and the palette. It is written for the static renderer and notes what hit-testing and media need where it came up. Markers: [V] verified (against Wine reference captures unless stated otherwise), [C] read from the code, [H] hypothesis.

Coordinates are **page coordinates**: page pixel (0,0) is the top-left of the main window's client area (`program.md`, Window). Object rectangles are relative to their panel.

## Rules in short

1. A page is a list of rectangular **panels**: the page's own panels, then the template's other panels (shared nav bar and frame pieces). Each panel sits at its PanelRef position and is clipped to its PanelRef size [C].
2. A panel is painted off-screen: fill the panel with its PanelRef colour, draw its objects in data order (later objects on top), then copy the result to the window [C].
3. A Bitmap is copied opaque, unscaled, at the top-left of its rectangle, and clipped to its panel. Pixel values are palette indices and are copied unchanged. The colour table in the bitmap file is ignored [C][V].
4. Of the other objects, only CancelButton, AnimationControl, ScrollBitmap and ScrollBar draw anything at rest. The A–Z dial panel adds the current letter's picture and a blinking lamp [C][V].
5. Popup and index pages are separate borderless windows. Each has an 8-pixel caption strip drawn by the program above the picture and a 4-pixel stippled drop shadow to the right and below [C][V].
6. The screen palette is the master palette of `dib-and-palette.md`, with the logical-to-system mapping as the identity [C].

## 1. Client area

- The main window's client area is 638×459 (`program.md`, Window). Every base template covers it completely with panels: template 7 with the nav bar (0,0) 94×459, the top frame (94,0) 544×4, the content panel (94,4) 540×450, the right frame (634,4) 4×450 and the bottom frame (94,454) 544×5; the A–Z template 77 with the same layout; the title template 2108 with one 638×459 panel [V].
- The window class background is the stock white brush, but the window procedure swallows `WM_ERASEBKGND`, so the background is never painted. Panels paint the whole client [C] (`1018:86ce`, `1018:8782`).
- The product record's background colour (0,255,0) has no use that we could find. It never appears on screen [C].
- **For the remake:** draw the page into the framebuffer at (0,0). Pixels outside 638×459 are not part of the original client; their colour is a presentation choice. Popups can reach past the client (section 7.6), so clip them to the stage.

## 2. Instantiating a page

Provenance: startup `1010:4fec`, ChangePage `1018:c1a0`, panel read `1008:ea34`, empty panel `1008:e484`, shared panel `1010:520e`.

- **Panel list** [C]: first the page's own panels, in data order. Then, for each PanelRef of the page's template (in template order) whose panel id the page does not supply:
  - for a shared PanelRef, the shared panel from the heap;
  - for a non-shared one, an empty panel with no objects. It is still painted with its colour. This never happens on the disc: every page supplies its template's non-shared slots (`page-database.md`).
- **Panel rectangle** [C]: (x, y, x + width, y + height) from the PanelRef. When the PanelRef width or height is 0 (all popup and index templates), the panel's size is the extent of its objects, i.e. the largest object `right` and `bottom` after loading. On the disc that is exactly the popup picture's size [V].
- Panels are **not** child windows. They are rectangles inside the page's window and never overlap on the disc, so their paint order does not matter. The program paints them in list order [C].
- **The page's window** [C] (`1010:5832`): base pages draw into the main window, and popup and index pages into a window of their own (section 7). Child pages (type 104, unused) would be child windows.
- **ChangePage** to a page of the same type reuses the window [C]. A shared panel whose PanelRef is identical in the old and new templates (type, heap offset, id, colour, position, size) is kept as it is and **not repainted**. All other old panels are destroyed. The new page's own panels and any newly created shared panels are loaded and painted. Moving from template 7 to template 77 (the A–Z machine) recreates the nav bar and frame, because their colours differ.

## 3. Painting a panel

Provenance: panel paint `1010:0000` (Display, NavPanel; AZDial adds `1020:ae1a`), screen copy `1010:0d34`, window repaint `1008:be64`.

```
paint(panel, area):            area = whole panel, or the part a repaint needs
  buffer = off-screen bitmap of area's size, same depth as the screen
  fill buffer with the PanelRef colour (solid brush, plain RGB)
  for each object in data order:
    if the object's rectangle overlaps area: object.draw(buffer)
  copy buffer to the window at the panel's position (on its first paint, with the panel's transition)
```

- The buffer covers only the panel, so **every object is clipped to its panel** [C]. Some pictures are larger than their panels (sizes [V]):

  | Bitmap | Size | Panel | Effect |
  |---|---|---|---|
  | `NAV\NAV` | 94×460 | 94×459 | the bottom row is dropped |
  | `NAV\FRAMEBOT` | 545×5 | 544×5 | the last column is dropped |
  | `NAV\FRAMESID` | 4×452 | 4×450 | the bottom two rows are dropped |
  | `AZAZ\AZAZ0M` | 540×451 | 540×450 | the bottom row is dropped |

- **Panel colours** are plain RGB brushes. Every colour on the disc is one of the Windows static colours, so on a 256-colour screen the fill is solid (no dithering) [C]. Template 7's debug colours are normally hidden under the pictures:

  | Colour (RGB) | Index | Used by |
  |---|---|---|
  | FF0000 | 249 | template 7, content panel 1 |
  | 00FFFF | 254 | template 7, top frame 389 |
  | 00FF00 | 250 | template 7, right frame 388 |
  | 0000FF | 252 | template 7, bottom frame 387 |
  | 000000 | 0 | template 7, nav bar 849 |
  | FFFF00 | 251 | template 2108 (title) |
  | FFFBF0 | 246 | template 77, popup and index templates |

  One base page leaves its panel colour visible: `\ARTICLE3\SUSP\`'s picture `SUSP0m` is 539 wide in the 540-wide content panel. **Page column 633, rows 4–453, should be red (index 249)** [C], a good check against a capture.
- **Transitions** [C]: the copy to the window can be animated: wipes, scrolls, dissolves and zooms, ids 1–14 (`1010:0d34`). A panel uses its transition only on its first paint, and the transition comes from the ChangePage action's `u16`, which is 0 on the whole disc. Every paint is therefore a plain copy. The names `wipeleft` and `wiperight` belong to these ids. The remake drops transitions (special-screens.md §6).
- **Repaints** [C]: on `WM_PAINT` the program repaints, for every panel that intersects the update rectangle, the intersecting part of that panel, by the same procedure. The result equals a full repaint.

## 4. Bitmaps and the palette

Provenance: Bitmap load `1010:aa70`, draw `1010:ab96` → `1010:e358`, DIB to device bitmap `1010:dfc4`, colour-table replacement `1010:e076`.

- **Placement** [C]: when a Bitmap loads, its rectangle's `right` and `bottom` are replaced by `left + picture width` and `top + picture height`. The stored `right`/`bottom` are ignored. They differ from the picture on three title pages (640×461 stored, 638×459 picture) [V]. The picture is then copied opaque and unscaled, top-left at (`left`, `top`). There is no transparent index.
- **Colours** [C]: before converting a DIB (a `.DIB` file or an EXE bitmap resource) to a device bitmap, the program replaces its colour table with the identity index list 0, 1, 2, …, and converts in palette-index mode (`DIB_PAL_COLORS`), with the program's palette selected and realised. A pixel value *v* therefore shows logical palette entry *v*. The bitmap's own colour table is never used. Consequences:
  - `.DIB` pixels are written to the framebuffer unchanged. This is confirmed pixel-exact by the base-page and popup comparisons in section 9 [V].
  - `WINW0M.DIB`'s index 2 shows **system colour 2, dark green 008000**, not the white of its own table (`dib-and-palette.md`) [C].
  - EXE bitmaps with their own small tables (4-bit bitmaps 2–6 and 10–12, bitmap 118 with 13 colours) also show master-palette entries 0–15 (or 0–12), not their tables [C]. Bitmap 118 is an AnimationControl part that is hidden at rest (section 5). Bitmaps 2–6 and 10–12 are loaded into a table (`1030:ca56`) whose use was not followed.
- A picture that fails to load draws nothing; the panel colour shows [C].

## 5. Objects at rest

What each display object draws during a panel paint, with nothing playing or pressed [C]:

| Object | Draws at rest |
|---|---|
| Bitmap (601) | its picture (section 4) |
| Hotspot (603), AZHotspot (604) | nothing. The Hotspot `i16` (always 0) selects a highlight style 1–4 that is drawn while the hotspot is pressed; 0 means no highlight (`1010:b9c0`) |
| WordBox (605), NavHotspot (606), AnimHotspot (607), AZAnimHotspot (611) | nothing. Their drawing method is empty; animation frames appear only while an animation plays |
| CancelButton (608) | EXE bitmap **170** (62×22, "Cancel") at the rectangle's top-left (`1030:13ea`, `1030:2e40`); 171 while pressed (special-screens.md §4.2). The copy uses the rectangle's size (64×24 on the disc). What GDI puts in the two columns and rows beyond the 62×22 source is not established; most likely nothing, leaving the popup picture [H] |
| AnimationControl (602) | a 74×22 control strip from EXE bitmaps, sized to bitmap 101 (see below) |
| ScrollBitmap (609) | its picture, but **not** at natural size: the rectangle's size is shown, taken from the picture starting at the row of its scroll position (row 0 at rest; special-screens.md §3.2), column 0 (`1030:bbae`). Its rectangle is not replaced by the picture size |
| ScrollBar (610) | five parts from its `@` bitmaps (see below) |

**AnimationControl** (`1028:987a`, `1028:a474`): its rectangle becomes 74×22 from its top-left. Parts, from EXE bitmaps, at offsets from that top-left:

| Bitmap | Size | Offset | At rest |
|---|---|---|---|
| 101 | 74×22 | (0,0) | shown: background with rewind and play buttons and a progress slot |
| 115 / 117 | 15×16 | (3,3) | 115 shown (rewind button) |
| 116 / 119 / 120 | 16×16 | (20,3) | 116 shown (play button) |
| 118 | 31×21 | (38,6) | hidden |
| 159 | 100×30 | (39,7) | progress indicator, positioned by playback progress [H]; not visible at rest [V] |

The parts are composed off-screen and copied as one 74×22 block. **At rest the strip is bitmap 101 with 115 and 116 drawn on it, and nothing of 159 shows** [V]: the engine's rendering of `\ARTICLE1\AMPL\` (control at panel (45,405)) matches its Wine capture exactly. Where the progress indicator goes while playing is still [H] (playback.md).

**ScrollBar** (`1030:a4ea`, `1030:abc6`; positions and input in special-screens.md §3), for a rectangle (L, T, R, B) and its eight parts in data order (`LINEUP`, `LINEDOWN`, `THUMB`, `THUMBTRACK`, then the four `…ALT` pressed variants):
- the up arrow at (L, T), at the bitmap's own size;
- the down arrow at (L, B − its height), at the bitmap's own size;
- the track runs from the bottom of the up arrow to the top of the down arrow;
- the thumb is the track's width × `THUMB`'s height, at the track top plus the scroll offset (0 at rest);
- the track above and below the thumb is filled from `THUMBTRACK`, aligned to the track top (the part below the thumb starts at source row *its top − track top*);
- draw order: thumb, track above, track below, up arrow, down arrow [C].

**Object flags** (the `u16` after the id) [C]:

| Bit | Meaning |
|---|---|
| `0x100` | no rectangle stored (never on the disc) |
| `0x10` | AnimHotspot: load the animation only when it is needed (on click) instead of when the page opens; free it when it finishes. Probably `LOADONDEMAND` [H] |
| `0x20` | AnimHotspot: start playing as soon as the page has opened. Probably `AUTOSTART` [H]. It is set on the title animation and 23 others |
| `0x40` | AnimHotspot: rewind the animation to its start when it ends, probably `AUTOREWIND` (playback.md §6) [C] |
| `0x80` | AnimHotspot: alternative way of opening the animation; unused |
| `0x1`, `0x4` | Hotspot: `0x4` stops all media before the click, `0x1` lets the click act even if something was playing (behaviour.md §3). No drawing effect |
| `0x2` | do not take the mouse capture on a press (never on the disc; behaviour.md §1.4) |

None of the flags hides an object or changes how it is drawn at rest.

## 6. Special panels

### NavPanel and the frame
The nav bar is an ordinary panel: one Bitmap (`NAV\NAV`) and nine NavHotspots, which draw nothing at rest. The frame pieces are Display panels holding one Bitmap each. Their clipping is in section 3. The nav bar's button behaviour is in `page-database.md` (NavPanel) [C].

### AZDial (the A–Z machine)
Provenance: paint `1020:b038` → `1020:ae1a`, load `1020:afbc`, timer `1020:b0a8`.
- After the normal panel paint, the panel draws the **current letter's still picture**, the `.DIB` named by that letter's string (e.g. `AZAZ0MAA.DIB`), with its top-left at panel position **(161,101)**. The current letter starts at A [C][V].
- On load the panel starts a 1000 ms timer. Every tick it draws EXE bitmap **172** (17×8, lamp on) and **173** (18×8, lamp off) alternately at panel position **(334,350)**, starting with 172. Bitmap 173 matches the background picture there, so the lamp **blinks once per second** and the page never settles. Mask page rectangle (428,354)–(446,362) when comparing [C][V] (the Wine capture equals the base picture plus the letter picture pixel for pixel, with the lamp caught in its off state; the capture never settled, with 30 changes in 30 s).

## 7. Popup and index windows

Provenance: open `1020:134c`, window creation `1018:22a4`, caption `1000:7904` and `1000:7a50`, shadow `1020:1d20`, paint `1020:19a2`, ChangePage reuse `1018:c1a0`.

Popup pages (all on template 0) and the index page (template 617) get their own window: a top-level `WS_POPUP | WS_VISIBLE` window with no Windows frame, caption or border, owned by the window of the page that was active (last pressed) when it opened: the main window for a popup opened from the base page, another popup for one opened from a popup (behaviour.md §4.1) [C]. Under Wine, the window of the Airplane popup (a 287×330 picture) is exactly 291×342: picture width + shadow by caption + picture height + shadow [V]. Everything inside it is drawn by the program.

### 7.1 Template fields that control the window
In-memory provenance: the template reader `1010:3182`. Names in the right-hand column are candidates from the program's keyword strings [H]; the behaviour is [C].

| Field (file order, `page-database.md` Template) | Disc values | Behaviour | Name [H] |
|---|---|---|---|
| flag A: two `i16` | (7, 1) on popup/index templates | (template id, panel id) of a **reference panel**. The popup origin is offset by that panel's position, (94,4) | `OFFSET_ORIGIN` |
| `u16` after flag A | 0 | non-zero: centre the window (in the reference panel, or see below) | `CENTRED` |
| width, height | 0×0 except 638×459 on template 2108 | page content size. 0 means the size of the panels | `FIXED_SIZE` |
| flag B: x, y | never set | fixed origin, replacing the page's origin | |
| 1st unknown `u16` | 1 (0 on unused template 2214) | 1 = draw the 8-pixel caption strip | `CAPTION` |
| 2nd unknown `i16` | 0 base; 4 (templates 0, 617, 2214) or 8 (2215) | drop-shadow width in pixels | `DROP_SHADOW_WIDTH` |
| 3rd unknown `u16` | 0 | non-zero: the popup does not take the focus | `NOFOCUS` |
| 4th unknown `u16` | 0 | non-zero: centre in the main client area | |
| flag C: rect | never set | centre within this rectangle of the main client area | |
| list 1 | base-panel ids on popup/index templates | read and freed, but no other use found [C] | |

Only templates 0 (1,259 popups) and 617 (index) are used by pages. Templates 2214 and 2215 are unused [V].

### 7.2 Size and position
With W×H the page's content size (its single panel's extent, i.e. the picture size), *s* the shadow width and *c* = 8 when the caption flag is set (else 0) [C]:
- window size = (W + *s*) × (*c* + H + *s*); 291×342 for a 287×330 picture [V];
- window position (screen) = main window's outer top-left + reference panel position (94,4) + page origin + (0, `GetSystemMetrics(SM_CYCAPTION)`).

On Windows 3.1 the outer window is 1 pixel left of the client and 20 pixels (the caption height) above it, so in page coordinates [C]:
- window top-left = (origin.x + 93, origin.y + 4);
- caption strip rows origin.y + 4 … origin.y + 11;
- **picture top-left = (origin.x + 93, origin.y + 12)**.

Under Wine the frame is 3 pixels wide and the client starts 23 pixels below the outer top, so popups sit at (origin.x + 91, origin.y + 1) [V] (Airplane popup, origin (28,99): window at page (119,100)). **Wine popup captures are therefore offset by (−2, −3) from Windows 3.1**; confirm the Windows 3.1 numbers in DOSBox-X.

The centring options (rows 2, 4 and flag C in 7.1) are unused and are not specified further here.

### 7.3 Caption strip (8 pixels, drawn by the program)
In window coordinates, with x = 0 at the window's left and W = picture width [C][V]:
1. A rectangle from (11,0) to (W, 9), exclusive, drawn with a 1-pixel black pen and filled with the caption colour. Its bottom border row (8) is then covered by the picture.
2. The "system box" over x 0–12, rows 0–7, drawn after the rectangle:
   - row 0, x 0–11: frame colour;
   - column 0, rows 0–7: frame colour;
   - x 1–11, rows 1–7: light grey (`C0C0C0`, index 7);
   - column 12, rows 1–7: frame colour;
   - a bar: dark grey (`808080`, index 248) over x 4–10, rows 4–6, then black over x 3–9, rows 3–5, then white over x 4–8, row 4.

Colours on Windows 3.1 (default colour scheme) [H]:
- frame (`COLOR_WINDOWFRAME`): black, index 0;
- caption, active (`COLOR_ACTIVECAPTION`): navy `000080`, index 4;
- caption, inactive (`COLOR_INACTIVECAPTION`): white, index 255.

The caption is active when the popup is the window with input focus and is enabled; other open popups are inactive. Opening a popup makes it the focus window and repaints the previous popup's caption as inactive [C]. Under Wine the frame colour is `9E9E9E`, the active caption `3296FA` and the inactive caption `808080` (index 248) [V].

**A caption redrawn over the picture** [V]: when the program draws a caption again after the window's picture has been painted, it draws the whole rectangle of item 1 again, bottom row 8 included, and does not repaint the picture. The picture's first row then shows that border: black from window x 11 to W − 1, while x 0–10 keep the picture (the system box ends at row 7). Only the columns where the window is visible at that moment are drawn [H]. Seen under Wine:
- **The Index** (special-screens.md §1.1) shows the line every time it opens (both Wine captures: page row 51, x 191–542). After its first paint it creates its controls and gives the edit box the focus (special-screens.md §1.2, §1.5), and its caption is drawn again then; it stays active [V; that the focus change is the trigger is H].
- **A popup opened from a popup**: the lower popup's caption is redrawn inactive and shows the line from then on (base page 3330 → popup 3760 → popup 109296, 2026-10-15: 3760's row 8 is `808080` inside the rectangle and black from x 11 to 180) [V].

The same follows for every other caption redraw [H]: a press that moves the focus to another popup (both captions), the focus going back to the opener when a popup closes (behaviour.md §4.4), and the application losing or regaining activation (behaviour.md §10). A later repaint of the picture covers the line again where it repaints: a ChangePage in the window, or a part uncovered when a window above it closes, moves or is lowered [H]. A popup opened directly from the base page never shows it: its caption is drawn before its first paint.

### 7.4 Drop shadow
- **Geometry** [C][V], in window coordinates, with total window size Wt×Ht and shadow width *s*:
  - the right strip is x Wt−*s* … Wt−1, rows *s* … Ht−1;
  - the bottom strip is rows Ht−*s* … Ht−1, x *s* … Wt−1.

  So the shadow is offset by *s* from the top and left edges.
- **Pixels** [C]: the program shrinks its window, lets the windows underneath repaint the uncovered strips, grows the window back without repainting, and ANDs a 50% checkerboard over what is on screen there, using EXE bitmaps 150/153 (8×8, 1 bit) as a pattern brush. In palette-index terms each shadow pixel is either unchanged or index 0 (black). Black pixels are those where **screen x + screen y is odd**; the program picks bitmap 150 or 153 from the window's screen position to keep that alignment [V on Wine].
- In page coordinates on Windows 3.1 at 640×480, where the client starts at screen (1,20), **shadow pixels with (x + y) even are black** and the others show the base page underneath [C].
- **Wine differs** [V]: the strips show the stipple over **white**, not over the base page, because the uncovered strips are not preserved. Everything the shrunken window uncovers is white: the whole right band x W … Wt−1 (all rows) and the whole bottom band rows Ht−*s* … Ht−1 (all columns), so the two *s*×*s* corners outside the shadow (top right, bottom left) are plain white. With the client at screen (195,195), black pixels are those with (x + y) odd. The engine's Wine presentation reproduces the Airplane popup capture exactly, apart from the caption colours (section 10). Shadows are therefore an expected difference against Wine captures; confirm the Windows 3.1 rendering in DOSBox-X.

### 7.5 Zoom (OpenPage flag 1)
An OpenPage whose `u16` is 1 ("zoom"; 0 is "none") animates rectangle outlines from the clicked object to the new window, inverting pixels on the screen, before creating the window (`1018:2700`, `1008:c978`). Nothing of it remains afterwards, so the settled state is unaffected [C].

### 7.6 Popups beyond the client area
Nothing keeps a popup inside the main window [C]:
- 77 popup pages reach past page x 638, up to x 696; examples are the `\HELP\` pages with origin (39,34), 560 wide;
- 11 reach row 459, with the shadow only;
- 67 overlap the nav bar.

On a 640×480 screen the parts beyond page x 638 (screen x 639) are off-screen. The remake should clip popups to the stage. In practice none of these shows there: the wide pages are all Help pages, which are only ever reached by a same-size popup-to-popup ChangePage from the first Help page, so they appear where that page is, at page x 39 (section 7.7, special-screens.md §5) [C][V].

### 7.7 ChangePage from popup to popup
ChangePage replaces the page in the existing window of the same page type [C] (1,079 popup-to-popup ChangePages on the disc):
- **same content size** as the old page: the window stays where it is;
- **different size**: the window is resized to the new size and moved to main window top-left + (94,4) + new origin, **without** the caption-height term, i.e. page (origin.x + 93, origin.y − 16) on Windows 3.1 (and, by the same formula with Wine's frame, (origin.x + 91, origin.y − 19) under Wine [H]). This looks like a quirk of the original; confirm it with a capture.

A ChangePage to a **base** page, from a popup or anywhere else, closes every open popup: they are owned by the main window, or by popups that are, and the change closes the windows the main window owns (`behaviour.md` §4.3) [C]. Observed under Wine: Airplane (1538) → See Also popup (1188) → Airship hotspot → base page 3330 with no popup left [V]. A popup-to-popup ChangePage leaves the other popups open, except those owned by the changing popup [C].

### 7.8 Hit-testing notes
The full rules are in `behaviour.md` (§1, §5).
- Objects are tested from the **last to the first** in data order, so the topmost drawn object wins (`1010:0936`) [C]. Test points are in panel coordinates, and rectangles include all four edges.
- A popup's caption strip and shadow are not part of its picture. A hit-test routine (`1020:1b1c`) classifies them: points in the caption strip at window x < 12 give one code, the rest of the strip another (dragging), and the shadow strips a third [C]. What each code does is in behaviour.md.

## 8. Order of events when a page opens

Provenance: `1018:c1a0` (ChangePage), `1020:134c` (popup open), `1008:bdec`, `1008:c808`, `1010:5f3c`, `1020:1cd8`, `1020:077c`, panel open `1020:2b8c`, object start `1010:07ba`.

ChangePage of a base page [C]:
1. Read the new page and its panels from the heap.
2. Reconcile panels with the old page (section 2), and destroy the old page.
3. Load every new panel: load its pictures (fixing the Bitmap rectangles), compute its extents and size.
4. Paint every new panel, in panel-list order, directly to the window.
5. For every new panel: run its `on_open` handlers (on the disc, only the 22 `SENDMESSAGE (181, 59)` handlers), then "start" each object:
   - AnimHotspots without `0x10` load their animation, and those of them with `0x20` start playing at once (playback.md §6);
   - an AnimationControl starts only if the first of its two trailing `u16` flags is 1, which never happens on the disc.

Opening a window (startup page, popup, index) [C]:
1. Load the panels as in step 3.
2. Create and show the window. Its first `WM_PAINT` paints all panels.
3. After that first paint the window posts itself a private message (`0x401`). Handling it runs the page's open events, then step 5 for each panel. For popups the order is page `on_preopen`, then the panels, then page `on_open`; for base pages, page `on_open`, then the panels. No page-level open handlers exist on the disc.

**Settled state:** a page's pictures are complete after its first paint. Autostart animations then draw over them, so a settled capture of a page with an autostart animation shows animation frames (e.g. the title capture differs from `TITL0m` in (220,30)–(471,126)) [V]. Mask those areas in comparisons.

**Where animation frames land** [C][V]: an animation draws through its object's **panel**: the origin is the panel's position and drawing is clipped to the panel's rectangle (`1008:5b52` → `1008:edd4`). PICS frame rectangles are therefore panel coordinates, not relative to the object's own rectangle: on base pages page (94,4) + frame rect, on the title template page (0,0) + frame rect. Example: `QCAM1M0A`'s AnimHotspot rectangle is (533,1)–(539,5), but its frames span (28,1)–(446,448) of the content panel [V]. The object's rectangle only matters for clicks. An AnimationControl's animation is the movie: its frames form the movie screen, also in panel coordinates (`playback.md`).

The 22 base pages whose panels have the `on_open` `SENDMESSAGE (181, 59)` handler are the Principles of Science movie pages (`\PRINCIPL\Q…\`, each with an AnimationControl). Their settled Wine captures show the movie playing: frames in the movie screen, and the control's pause button in place of play [V]. So the handler starts the page's AnimationControl [H] (59 is also the value of every AnimationControl's last `i16`, `page-database.md`). Those pages never show the static rendering either; mask the movie screen and the control.

The Workshop reached through the title's transition page (the transition animation ends with `on_finish` → ChangePage to the Workshop) differs from the Workshop opened directly: parts of the transition animation's last frame stay on screen over the Workshop picture (about 2,300 pixels around the flasks, page (134,151)–(534,275)) [V]. Either the animation draws once more after the page change or the picture under it is not repainted [H]; a comparison of that capture must mask the area. The leftovers are **not** the transition's final picture left in place: compositing all of `TITL2m0a`'s frames over the title page explains only 499 of the 2,354 differing pixels [V] (the other differing pixels match colours of earlier frames). They look like a product of Wine's animation stall [H], so the remake does not reproduce them; check the transition's end in DOSBox-X.

The splash picture shown while the database loads is EXE bitmap 121 (640×480), in its own borderless window centred on the screen (`1010:4714`) [C].

## 9. The palette at runtime

- The program creates its palette from the `PALETTE` resource and, when it creates the main window, forces entries 10–245 to `PC_NOCOLLAPSE` (they already are). Entries 0–9 and 246–255 are `PC_EXPLICIT` system entries. Realised in the foreground, logical entry *i* is system entry *i*, so the screen shows the master palette of `dib-and-palette.md` [C] (`1010:46a6`, `1010:4714`).
- All drawing goes through device bitmaps created from DIBs in palette-index mode (section 4), off-screen buffers compatible with the 8-bit screen, and plain copies. Raster operations work on indices. GDI fills with RGB colours (panel colours, caption, box, shadow) are all exact static colours. So **the whole picture can be computed in palette indices** and converted to RGB through the master palette at the end [C].
- Comparisons with Wine captures (palette patch on) are pixel-exact for:
  - the Airplane, Workshop and "A" list base pages in Wine's visible 634×454 area: nav bar, frame and content [V];
  - the A–Z machine with its letter picture (lamp caught off) [V];
  - the Airplane popup's picture, caption strip and system box (with Wine's caption colours) [V].
- The engine's static rendering (`packages/engine`), converted through the master palette, matches 351 of the 400 settled Wine captures of the reference set exactly in 634×454. The other 49 differ only by an expected difference of section 10 [V]: 23 pages whose animation stalled under Wine before its `finished` page change, 22 Principles movie pages with the movie playing (section 8), 2 popups with Wine's caption colours, 1 A–Z machine with the lamp caught on, and 1 Workshop with the title transition's leftovers (page 410962, which did reach the Workshop).

## 10. What to confirm against captures

For the comparison tool (`tools/compare`). Wine differences that are expected:
- **Visible area:** on its own, Wine gives the program only 634×454 of the client (`program.md`). `tools/refcapture` resizes the window to 638×459 so that the program paints the whole client area, and records Wine's client size in each sidecar (`wineClient`); captures with it are compared over all of 638×459 [V]. Older captures, made before that fix, are black in columns 634–637 and rows 454–458; for those, compare only 634×454 (`docs/reference-environments.md`, "Client area size").
- **Popup position:** Wine places popups (−2, −3) from the Windows 3.1 position (7.2). Locate the popup's X window and compare it in its own frame, or render with the engine's `wine` presentation, which places popups and draws the shadow as Wine does.
- **Caption colours:** Wine's frame and active caption colours differ (7.3). Neither `9E9E9E` nor `3296FA` is in the master palette, so an indexed rendering cannot show them: treat the caption pixels in those colours as expected differences [V].
- **Shadow:** Wine's shadow is a stipple over white with the opposite parity, corners white too (7.4).
- **Popups that stay white:** Wine loses the picture of a popup whose size crosses one of its 128-pixel surface steps when the program shrinks the window for the shadow (`docs/reference-environments.md`, "Popups that stay white"). Such a popup is white from window row 4 down to the shadow, and across the picture's width: the lower half of the caption strip and the whole picture. Caption rows 0–3 and the shadow are drawn as usual [V]. The sidecar lists these windows (`whitePopups`), and a comparison treats white reference pixels in that area as expected.
- **Animations and lamp:** autostart animation areas and the A–Z lamp change over time (sections 6 and 8).

To confirm in DOSBox-X (Windows 3.1):
1. A popup's page position, (origin.x + 93, origin.y + 4) for the window.
2. Caption colours: navy 000080 active, white inactive, black frame; and the line a redrawn caption leaves on the picture's first row (7.3), on the Index as it opens.
3. The shadow showing the base page through a checkerboard with (x + y) even black.
4. Page column 633 on `\ARTICLE3\SUSP\` showing red (index 249).
5. `WINW0M` index-2 pixels showing dark green.
6. The CancelButton on the Options popup (bitmap 170, and what fills its 64×24 rectangle beyond 62×22; special-screens.md §9).
7. An AnimationControl strip at rest.
8. Popup-to-popup ChangePage placement when the size changes (7.7).
9. Help pages keeping the first Help page's position when changed to (special-screens.md §5).
