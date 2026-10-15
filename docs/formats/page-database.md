# Page database (`DKCODE/TWTW.PNG`)

Despite the extension this is not an image. It is the compiled ("scrunged", in DK's terminology) form of a text page-description language: the whole application's screens, hotspots and navigation. The release program only reads this binary form. Status: structure **[V]**. A full parse lands exactly on every declared boundary, and following references reaches 1,657 pages and 4 shared panels. Those cover the page heap byte for byte, apart from 4 unreferenced popup pages, which also parse. Every media reference resolves to a file on the disc. The TypeScript parser (`packages/formats/src/pagedb/`) agrees with the private oracle's output on every string, template, index entry, page, panel, object, handler and action. Provenance: loaded by `1010:58ea`.

## Primitives

All integers are **big-endian** (the original's stream reader assembles bytes most-significant first; `1010:97ea`–`9bf8`).

| Name | Encoding |
|---|---|
| `u8`, `u16`, `i16`, `u32` | big-endian integers |
| `str` | `i16` 1-based index into the string table; `0` = no string |
| `pageref` | `u32` byte offset from the start of the page heap; `0xFFFFFFFF` = none |
| `rect` | 4 × `i16`: left, top, right, bottom |
| `rgb` | 3 × `i16`: red, green, blue (0–255) |
| flag | `u16` presence flag: the optional block after it is present when it is 1. Every flag on the disc is 0 or 1 [V], so a parser may reject other values |

## File layout

| Offset | Content |
|---|---|
| 0 | `u32` offset of the page heap from the start of the file |
| 4 | `u32` byte length of the string table |
| 8 | String table |
| 8 + string table length | Product record, immediately followed by the A–Z index |
| page heap offset | Page heap: pages and shared panels, addressed by `pageref` |

### String table
`u16` count, then `count` entries of `u16 length` followed by that many bytes of Windows-1252 text (no terminator). The entries fill the declared length exactly [V]. On this disc: 4,334 strings, the first being the product title, with no duplicates [V] (so a string's index can be recovered from its text).

### Product record
| Field | Type | Notes |
|---|---|---|
| title | `str` | |
| width, height | `i16`, `i16` | 640 × 480 |
| version | `str` | |
| default cursor | `str` | e.g. `Arrow` |
| background colour | `rgb` | (0,255,0); no use found in the program [C] (rendering.md §1) |
| unknown1 | `u16` | |
| startup page | `pageref` | the title screen |
| template count | `i16` | 7 on this disc |
| templates | Template × count | |
| handlers | Handlers | product-level events |

### Template
Page types share a template, which supplies common panels (for base pages: the navigation bar and the frame).

| Field | Type |
|---|---|
| page type | `i16` (see page types) |
| template id | `i16` |
| flag A; if non-zero: reference template id, reference panel id | `u16` (+ 2 × `i16`) |
| centre flag | `u16` |
| width, height: page content size, 0 = from the panels | `i16`, `i16` |
| flag B; if non-zero: fixed origin x, y | `u16` (+ 2 × `i16`) |
| caption flag, drop-shadow width, no-focus flag, centre-in-client flag | `u16`, `i16`, `u16`, `u16` |
| flag C; if non-zero: centring rect | `u16` (+ `rect`) |
| list 1 | `i16` n, then n × `i16` |
| list 2 | `i16` n, then n × `i16` |
| panel count | `i16` |
| panel refs | PanelRef × count |
| handlers | Handlers |

**PanelRef** [V] layout, [C] meaning: `i16` panel type, `i16` panel id, `u16` shared flag (if set: `u32` heap offset of a shared panel), `rgb` colour, `i16` width, height, `i16` x, y. The x, y position places the panel in its window, and object rectangles inside the panel are relative to it. The panel is filled with the colour before its objects are drawn and clips them to its size. A width or height of 0 means "the extent of the panel's objects" (rendering.md §2–3).

Template field meanings are [C] and are described with the popup window in rendering.md §7.1. Their keyword names are [H] candidates from the program's strings: `OFFSET_ORIGIN` (flag A), `CENTRED`, `FIXED_SIZE` (width, height), `CAPTION`, `DROP_SHADOW_WIDTH`, `NOFOCUS`. `ALWAYSACTIVE` and `FRAME` are not matched to a field.

Values on the disc [V]:
- Flags B and C are never set. Flag A is set, with the values 7 and 1, on the popup and index templates only.
- The centre flag after flag A is always 0. Width and height are 0 except on one full-screen base template (638 × 459).
- The caption flag is 1 on all templates but one popup template. The shadow width is 0 on base templates and 4 or 8 on popup and index templates. The no-focus and centre-in-client flags are 0.
- List 1 is empty on base templates. On popup and index templates it holds panel ids of the main base template (content panel 1, navigation bar 849, frame pieces 387–389; two popup templates leave out 849). The release program reads and frees list 1, but no other use was found [C]. List 2 is always empty.
- Pages use only templates 7, 77 and 2108 (base), 0 (all 1,259 popups) and 617 (index). Popup templates 2214 and 2215 are unused.
- Template ids are unique, and every page names a template that exists and has the same page type. A page supplies exactly the panels of its template's non-shared slots, in slot order: on this disc, one panel per page (the Display panel 1, or the AZDial panel 78 on the A–Z machine page).

### A–Z index
Directly after the product record: `i16` count (1,857), then for each entry: `str` name, `i16` name length, `i16` (always 0), `pageref` target page, `i16` m, and m × `pageref` "see also" (companion) pages. Only the Index page uses it: the names fill its list in data order, and going to an entry goes to the target page and then to each companion page, usually a label popup on the target (special-screens.md §1) [C]. The A–Z machine has its own page refs (AZDial). The name length always equals the number of characters in the name [V]. The index ends exactly at the page heap offset [V].

## Page heap

### Page
| Field | Type | Notes |
|---|---|---|
| page type | `i16` | 101 popup, 102 base, 103 index, 104 child |
| template id | `i16` | |
| origin x, y | `i16`, `i16` | position of a popup window, relative to its template's reference panel (rendering.md §7.2) |
| directory | `str` | media folder, e.g. `\ARTICLE1\AIRP\` |
| panel count | `i16` | |
| panels | (`i16` panel type, Panel) × count | |
| handlers | Handlers | |
| has links | `u16` | if non-zero, 4 × `pageref` follow |

Page types: **base** pages fill the screen and get the navigation bar and frame from their template. **Popup** pages are smaller pictures in their own window over the current base page, at their origin (rendering.md §7). One **index** page holds the alphabetical index. **Child** pages are defined but unused here. Counts on this disc: 397 base, 1,259 popup, 1 index. The four link page refs replace the targets of four navigation-bar buttons while the page is shown [C] (see NavPanel below):
- link 0: Principles of Science (e.g. Airplane: a `\RELA\` popup);
- link 1: Machines (Airplane: the A–Z list page for "A");
- link 2: Inventors (Airplane: an `\INVENTOR\` page);
- link 3: History (Airplane: a `\TIMELINE\` page).

Links are present on 149 of the 397 base pages and on no other page, and none of their refs is "none" [V]. The startup page is the title screen, a base page.

A **shared panel** in the heap is an `i16` (0 on the disc; ignored), followed by a Panel. Its panel type is not stored with it: it comes from the template's PanelRef that points at it [V]. Templates reference shared panels for the navigation bar (a NavPanel) and the three frame pieces (Display panels).

### Panel
| Panel type | Name | Body |
|---|---|---|
| 201 | Display | common panel body |
| 202 | AZDial | common body, then 26 × `pageref` and 26 × `str` (one per letter) |
| 203 | NavPanel | common body, then 9 × `i16` and 9 × `pageref` (one per navigation button) |

AZDial [V]: each letter's `str` names both an animation (`.ANI`) and a still picture (`.DIB`) in the page's directory, e.g. `azaz0maa`; all 26 of each resolve. The panel draws the current letter's `.DIB` at panel position (161,101) (rendering.md §6) [C][V].

NavPanel [V]: the nine `i16` values are the ids of the panel's nine NavHotspot objects (the same set, though not in object order). Button *k* is the NavHotspot whose id is the *k*-th `i16`. Its action [C] (`1020:d6bc`), with the button labels from the nav bar picture:

| Button | Label | Action |
|---|---|---|
| 0 | Workshop | change to `pageref` 0 |
| 1 | Machines | change to page link 1 if the base page has links, else `pageref` 2 |
| 2 | Principles of Science | link 0, else `pageref` 1 |
| 3 | History | link 3, else `pageref` 4 |
| 4 | Inventors | link 2, else `pageref` 3 |
| 5 | Back | go back through the program's history of base pages (`1020:d7f0`; behaviour.md §6.3) [C] |
| 6 | Index | close the page of `pageref` 7 if it is open, then open it (`1020:d814`) |
| 7 | Help | the same with `pageref` 8 (`1020:d878`) |
| 8 | Options | close the pages of `pageref` 5 and 6 if open, then open `pageref` 5 (OpenPage, flag 0) (`1020:d8dc`) |

On the disc, button 0 is the top button (id 850) and buttons 5–8 are ids 855, 856, 858 and 857 (Back, Index, Help, Options, in screen order Back, Index, Options, Help). The nine `pageref`s are Workshop, Principles, A–Z machine, Inventors, Timeline, Options popup, second Options popup, Index page and Help popup [V].

Common panel body: `i16` panel id, `i16` object count, then (`i16` object type, Object) × count, then Handlers.

### Display objects
Every object starts with: `i16` id, `u16` flags; if `flags & 0x100` is clear, a `rect`; then `str` cursor name and Handlers. The type-specific fields follow:

| Type | Name | Extra fields | Count |
|---|---|---|---|
| 601 | Bitmap | `str` picture file (`.DIB`) | 1,661 |
| 602 | AnimationControl | `u16`, `rect`, `str` animation file (`.ANI`), `str` cursor, `u16`, `u16`, `i16` | 59 |
| 603 | Hotspot | `i16` | 10,539 |
| 604 | AZHotspot | `i16`, `i16` | 62 |
| 605 | WordBox | none | 660 |
| 606 | NavHotspot | `str` animation file, `i16` | 9 |
| 607 | AnimHotspot | `str` animation file, `i16` | 225 |
| 608 | CancelButton | 3 × `str` | 1 |
| 609 | ScrollBitmap | *different base*: `i16` id, `rect`, `str` cursor, `u16`, 4 × `i16`; then `str` picture file | 6 |
| 610 | ScrollBar (program name `ScrollBaa`) | same different base, then 8 × `str` part bitmaps (`@NAME` = bitmap resource in `TWTW.EXE`) | 6 |
| 611 | AZAnimHotspot | `str` animation file, `i16` | 0 |

Observed flag values: Hotspots use 4 and 5 (and 1, once). AnimHotspots use 0, 16, 32 and 64 [V]. Flag 0x100 (no rectangle) never occurs on the disc [V]. Meanings [C] are in rendering.md §5:
- `0x10`: load the animation on demand;
- `0x20`: start it when the page opens (the title animation has it);
- `0x40`: an extra step when it finishes;
- `0x1`, `0x4`: click handling.

None of them affects drawing at rest. A Bitmap's rectangle only gives its top-left; at load its `right`/`bottom` become left/top + the picture's size (rendering.md §4).

Values of the unnamed fields on the disc [V]:
- Hotspot `i16`: always 0. It selects a pressed-highlight style 1–4, and 0 means none [C]. AnimHotspot and NavHotspot `i16`: always 1.
- AZHotspot: the first `i16` is always 0; the second runs from 0 to 28 across the A–Z machine's hotspots [V]. It is a dial code: 0–25 select a letter, 26 and 27 step back and forward, 28 is the go button (behaviour.md §7) [C].
- AnimationControl: the second rect always equals the object's rect, and the second cursor equals its cursor. The two `u16` are 0, and 0 or 1. The last `i16` is always 59.
- CancelButton: all three `str` are 0 (no string). The button draws EXE bitmap 170 instead (rendering.md §5).
- ScrollBar and ScrollBitmap: the eight part bitmaps are all `@` resources. After the cursor come a `u16` link flag (1 on the ScrollBars, 0 on the ScrollBitmaps) and four `i16`: the partner's object id (on a ScrollBar the id of the ScrollBitmap it scrolls, in the same panel; unused on a ScrollBitmap), the minimum position (0), the maximum position (on ScrollBitmaps the value recomputed at load, special-screens.md §3.2; 0 on ScrollBars, which take their partner's), and the initial position (0) [C][V].

### Handlers and actions
Handlers: `i16` count, then for each: `u16` event, `i16` action count, then actions. Events: 1 open, 2 app activated, 3 close, 4 click, 5 before open, 6 finished (animation ended). Only events 1 (22 handlers), 4 (10,540) and 6 (191) occur on the disc [V].

An action is an `i16` type followed by its fields. Names below are ours, with the program's own keyword in parentheses where it differs (useful when reading strings or captures):

| Type | Name | Fields | Count |
|---|---|---|---|
| 1 | OpenPage (`OPENPAGE`) | `pageref`, `u16` | 2,158 |
| 2 | SendMessage (`SENDMESSAGE`) | `i16` target object id, `i16` message; only (181, 59) occurs (behaviour.md §4.5) | 98 |
| 3 | ChangePage (`CHANGEPAGE`) | `pageref`, `u16` | 7,919 |
| 4 | PlayWave (`PLAYWAVE`) | `str` file (`.WAV`), 4 × `i16`, `u16` | 285 |
| 5 | StopWave | `str` | 0 |
| 6 | SeekWave | none | 0 |
| 7 | PlayPics (`PLAYPICS`) | `str` file (`.ANI`), `i16`, `i16`, `u16`, `i16`, `u16` | 393 |
| 8 | PlayPicsNoLoad | as 7 | 0 |
| 9 | PlayNonQueuedPics | as 7 | 0 |
| 10 | StopPics | `str` | 0 |
| 11 | ProductOption (`TWTWOPTION`) | `i16` option number (1–3) | 3 |
| 12 | ClosePage (`Closepage`) | `pageref` | 1 |
| 13 | SeekPics | none | 0 |

Values of the unnamed fields on the disc [V]:
- ChangePage's `u16` is always 0. It is the panel transition id for the new page's first paint (0 = none; 1–14 are wipes, scrolls, dissolves and zooms) [C]. Transitions are dropped in the remake (special-screens.md §6).
- OpenPage's `u16` is 0 (1,335 times) or 1 (823 times). It is the window-opening effect: 0 `none`, 1 `zoom`, outlines growing from the clicked object to the popup (rendering.md §7.5) [C]. PlayWave and PlayPics always carry −1, −1, 1, 1, 0 (one PlayWave ends in 1 instead of 0); because the third and fourth values are always equal, the data cannot confirm their order.

Semantics [C] (full rules in behaviour.md §4 and playback.md §4): ChangePage replaces the base page. OpenPage shows a popup over it. ClosePage closes one. PlayPics plays an animation over the current picture. PlayWave plays a sound. ProductOption invokes product-specific behaviour (the Options screen: copy, print, printer setup; special-screens.md §4). Unnamed parameters [H]: candidate keywords include `INTERVAL`, `HIGHLIGHT`, `AUTOSTART`, `AUTOREWIND` and `LOADONDEMAND`. The transition names `none` and `zoom` are the OpenPage `u16` values. `wipeleft` and `wiperight` name panel transitions, which ChangePage's `u16` would select [C].

## Resolving media files [V]

Path = data root + page directory + file name + extension. The extension follows from the user: `.DIB` for Bitmap, ScrollBitmap and ScrollBar parts, `.ANI` for animations (PlayPics, AnimHotspot, AnimationControl, NavHotspot, AZDial letters; an AZDial letter also names a `.DIB`), `.WAV` for PlayWave. A file name that contains `\` (e.g. `nav\framebot`) is relative to the data root instead. A name starting with `@` is a bitmap resource inside `TWTW.EXE`. Names are stored without extension and in mixed case (`AIRC0j`), while the disc's files are upper case, so lookups must ignore case.

Directories are stored with a leading and a trailing `\` (`\ARTICLE1\AIRP\`). Shared panels have no directory of their own; all their names contain `\`. Over all reachable pages and shared panels, 2,664 references resolve to disc files and 48 are `@` resources (the six ScrollBars' parts) [V]. The names in StopWave and StopPics (unused) identify something already playing, and CancelButton's strings are unknown, so neither is treated as a file reference.
