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
| background colour | `rgb` | |
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
| flag A; if non-zero: two `i16` | `u16` (+ 2 × `i16`) |
| unknown | `u16` |
| width, height | `i16`, `i16` |
| flag B; if non-zero: x, y | `u16` (+ 2 × `i16`) |
| unknown | `u16`, `i16`, `u16`, `u16` |
| flag C; if non-zero: a rect | `u16` (+ `rect`) |
| list 1 | `i16` n, then n × `i16` |
| list 2 | `i16` n, then n × `i16` |
| panel count | `i16` |
| panel refs | PanelRef × count |
| handlers | Handlers |

**PanelRef** [V] layout, [C] meaning: `i16` panel type, `i16` panel id, `u16` shared flag (if set: `u32` heap offset of a shared panel), `rgb` colour, `i16` width, height, `i16` x, y. The x, y position places the panel on screen. Object rectangles inside the panel are relative to it.

Candidate names for the unknown template fields [H], from keyword strings in the program: `ALWAYSACTIVE`, `OFFSET_ORIGIN`, `FIXED_SIZE`, `CENTRED`, `DROP_SHADOW_WIDTH`, `NOFOCUS`, `CAPTION`, `FRAME`.

Values on the disc [V]:
- Flags B and C are never set. Flag A is set, with the values 7 and 1, on the popup and index templates only.
- The `u16` after flag A is always 0. Width and height are 0 except on one full-screen base template (638 × 459).
- Of the four unknowns after flag B, the first is 1 on all templates but one popup template; the second is 0 on base templates and 4 or 8 on popup and index templates; the last two are 0.
- List 1 is empty on base templates. On popup and index templates it holds panel ids of the main base template (content panel 1, navigation bar 849, frame pieces 387–389; two popup templates leave out 849). [H] these are the base page's panels that stay active or visible while the popup is open. List 2 is always empty.
- Template ids are unique, and every page names a template that exists and has the same page type. A page supplies exactly the panels of its template's non-shared slots, in slot order: on this disc, one panel per page (the Display panel 1, or the AZDial panel 78 on the A–Z machine page).

### A–Z index
Directly after the product record: `i16` count (1,857), then for each entry: `str` name, `i16` name length, `i16` (always 0), `pageref` target page, `i16` m, and m × `pageref` "see also" pages. It feeds the Index list box and the A–Z machine. The name length always equals the number of characters in the name [V]. The index ends exactly at the page heap offset [V].

## Page heap

### Page
| Field | Type | Notes |
|---|---|---|
| page type | `i16` | 101 popup, 102 base, 103 index, 104 child |
| template id | `i16` | |
| origin x, y | `i16`, `i16` | screen position of popups |
| directory | `str` | media folder, e.g. `\ARTICLE1\AIRP\` |
| panel count | `i16` | |
| panels | (`i16` panel type, Panel) × count | |
| handlers | Handlers | |
| has links | `u16` | if non-zero, 4 × `pageref` follow |

Page types: **base** pages fill the screen and get the navigation bar and frame from their template. **Popup** pages are smaller pictures drawn over the current base page at their origin. One **index** page holds the alphabetical index. **Child** pages are defined but unused here. Counts on this disc: 397 base, 1,259 popup, 1 index. The meaning of the four link page refs is [H] (perhaps previous, next, up, see also). Links are present on 149 of the 397 base pages and on no other page, and none of their refs is "none" [V]. The startup page is the title screen, a base page.

A **shared panel** in the heap is an `i16` (0 on the disc; ignored), followed by a Panel. Its panel type is not stored with it: it comes from the template's PanelRef that points at it [V]. Templates reference shared panels for the navigation bar (a NavPanel) and the three frame pieces (Display panels).

### Panel
| Panel type | Name | Body |
|---|---|---|
| 201 | Display | common panel body |
| 202 | AZDial | common body, then 26 × `pageref` and 26 × `str` (one per letter) |
| 203 | NavPanel | common body, then 9 × `i16` and 9 × `pageref` (one per navigation button) |

AZDial [V]: each letter's `str` names an animation (`.ANI`) in the page's directory, e.g. `azaz0maa`; all 26 resolve. NavPanel [V]: the nine `i16` values are the ids of the panel's nine NavHotspot objects (the same set, though not in object order). [H] each `pageref` is the page its button leads to.

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

Observed flag values [H]: Hotspots use 4 and 5 (and 1, once). AnimHotspots use 0, 16, 32 and 64. 32 appears on the title animation and probably means "start automatically". Flag 0x100 (no rectangle) never occurs on the disc [V].

Values of the unnamed fields on the disc [V]:
- Hotspot `i16`: always 0. AnimHotspot and NavHotspot `i16`: always 1.
- AZHotspot: the first `i16` is always 0; the second runs from 0 to 28 across the A–Z machine's hotspots [H] (perhaps a position in a list).
- AnimationControl: the second rect always equals the object's rect, and the second cursor equals its cursor. The two `u16` are 0, and 0 or 1. The last `i16` is always 59.
- CancelButton: all three `str` are 0 (no string).
- ScrollBar: the eight part bitmaps are all `@` resources. The second of the four `i16` is the id of the ScrollBitmap it scrolls, in the same panel. On a ScrollBitmap the same field is not an object id; its meaning is unknown.

### Handlers and actions
Handlers: `i16` count, then for each: `u16` event, `i16` action count, then actions. Events: 1 open, 2 app activated, 3 close, 4 click, 5 before open, 6 finished (animation ended). Only events 1 (22 handlers), 4 (10,540) and 6 (191) occur on the disc [V].

An action is an `i16` type followed by its fields. Names below are ours, with the program's own keyword in parentheses where it differs (useful when reading strings or captures):

| Type | Name | Fields | Count |
|---|---|---|---|
| 1 | OpenPage (`OPENPAGE`) | `pageref`, `u16` | 2,158 |
| 2 | SendMessage (`SENDMESSAGE`) | `i16` message, `i16` parameter; only (181, 59) occurs | 98 |
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

Values of the unnamed fields on the disc [V]: ChangePage's `u16` is always 0. OpenPage's `u16` is 0 (1,335 times) or 1 (823 times). PlayWave and PlayPics always carry −1, −1, 1, 1, 0 (one PlayWave ends in 1 instead of 0); because the third and fourth values are always equal, the data cannot confirm their order.

Semantics [C]: ChangePage replaces the base page. OpenPage shows a popup over it. ClosePage closes one. PlayPics plays an animation over the current picture. PlayWave plays a sound. ProductOption invokes product-specific behaviour (the Options screen). Unnamed parameters [H]: candidate keywords include `INTERVAL`, `HIGHLIGHT`, `AUTOSTART`, `AUTOREWIND` and `LOADONDEMAND`. Transition names `none`, `zoom`, `wipeleft` and `wiperight` exist in the program, but where they are encoded has not been found.

## Resolving media files [V]

Path = data root + page directory + file name + extension. The extension follows from the user: `.DIB` for Bitmap, ScrollBitmap and ScrollBar parts, `.ANI` for animations (PlayPics, AnimHotspot, AnimationControl, NavHotspot, AZDial letters), `.WAV` for PlayWave. A file name that contains `\` (e.g. `nav\framebot`) is relative to the data root instead. A name starting with `@` is a bitmap resource inside `TWTW.EXE`. Names are stored without extension and in mixed case (`AIRC0j`), while the disc's files are upper case, so lookups must ignore case.

Directories are stored with a leading and a trailing `\` (`\ARTICLE1\AIRP\`). Shared panels have no directory of their own; all their names contain `\`. Over all reachable pages and shared panels, 2,664 references resolve to disc files and 48 are `@` resources (the six ScrollBars' parts) [V]. The names in StopWave and StopPics (unused) identify something already playing, and CancelButton's strings are unknown, so neither is treated as a file reference.
