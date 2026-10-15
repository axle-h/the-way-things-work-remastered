# Special screens: Index, scroll bars, Options, Help

How the original program handles the screens that are more than pictures and hotspots: the Index page with its list box, the custom scroll bars, the Options popup with copy, print and printer setup, and the Help pages. It also closes the list of object and action types for Phase 6 (section 8). It is written for Phase 6 (special screens) and Phase 8 (print and copy). Drawing at rest is in [rendering.md](rendering.md), input routing in [behaviour.md](behaviour.md). Markers: [V] verified (against the data, or the original under Wine), [C] read from the code, [H] hypothesis. Addresses are provenance only.

Coordinates are page coordinates under Windows 3.1 unless stated otherwise: page pixel (0,0) is the top-left of the main window's client area (rendering.md). "Picture coordinates" are relative to a popup's picture, which sits 8 rows below its window's top edge (rendering.md §7.2).

## Rules in short

1. The Index is one page (type 103) whose picture is only a frame. The program adds five Windows controls on top of it: an edit box, a standard list box with the 1,857 A–Z index names, a custom scroll bar, and OK and Cancel buttons drawn from EXE bitmaps [C].
2. The list shows the names in data order, one per 13-pixel row, in MS Serif 8 point with simulated bold. Typing in the edit box selects the first name that starts with the typed text. OK, Enter or a double click "goes" to the selected entry: its target page, then each of its companion pages. Cancel or Esc closes the Index [C].
3. A keyboard hook makes Tab switch between the edit box and the list, and makes Enter, Esc, Up, Down, Page Up and Page Down act on the list whichever control has the focus [C].
4. The six Help pages with a long text use a ScrollBitmap (a window onto a tall picture) and a ScrollBar. Positions are in steps of about 18 pixels. Arrows step by one, the track by a page, the thumb can be dragged, and a held arrow or track repeats every 100 ms [C].
5. Copy and print act on the page that was on top when the Options button was pressed. Both produce the page's picture with a 40-pixel white band below it holding a centred copyright line. Copy puts it on the clipboard [V under Wine]. Print sends it straight to the default printer, scaled so that a full screen would fill the page width [C].
6. No ChangePage on the disc uses a panel transition, so transitions are dropped [V].

## 1. The Index page

### 1.1 Window and picture [C][V]
- The Index is the only page of type 103 (heap offset 211350, directory `\INDEX\`, template 617). It is opened by the navigation bar's Index button (button 6: close it if open, then open it; behaviour.md §6.2) [V].
- Its window is built exactly like a popup's (rendering.md §7): template 617 has the reference panel (7, 1), the 8-pixel caption strip and a 4-pixel shadow. The page origin is (89, 42) and its one panel holds a single Bitmap, `INDE00` (363×360), so the window is 367×372 at page (182, 46) and the picture's top-left is page (182, 54) under Windows 3.1. Under Wine it is at (180, 51) (rendering.md §7.2) [C].
- The picture is a parchment frame with "Type a word or select from list:", "Select from list:", an empty white box for the edit box, a larger white box for the list and scroll bar, and nothing where the two buttons go. The controls fill the white boxes (index 255) [V].
- It behaves like any popup for the caption strip, the shadow, dragging, closing from its system box, and clicks on the base page closing it (behaviour.md §1.5, §5) [C].

### 1.2 The controls [C]
Provenance: the Index window's own window procedure `1030:4b68`, set up after the window's first paint by `1030:49ee`.

After its first paint the Index window creates five child windows. Their positions are in the window's coordinates in the code; the table gives them in picture coordinates (8 rows less) and in page coordinates under Windows 3.1:

| Id | Control | Picture rect (x, y, w×h) | Page (Windows 3.1) | Notes |
|---|---|---|---|---|
| 2 | edit box | 27, 88, 309×16 | 209, 142 | single line, no border, left-aligned |
| 1 | list box | 27, 138, 293×169 | 209, 192 | single selection, notifies its parent, no sorting, no scroll bar of its own, no integral height |
| 3 | scroll bar | 322, 136, 16×173 | 504, 190 | the program's own scroll bar class (section 1.11) |
| 4 | OK button | 68, 318, 62×22 | 250, 372 | owner-drawn: EXE bitmap 168, 169 while pressed |
| 5 | Cancel button | 227, 318, 62×22 | 409, 372 | owner-drawn: EXE bitmap 170, 171 while pressed |

- The buttons draw only their bitmap, copied at (0, 0), and choose the pressed picture from the button's "selected" state. They draw no focus rectangle [C]. Bitmaps 168/170 show a raised button with "OK"/"Cancel"; 169/171 show it pressed in, the label shifted down and right [V, from the bitmaps].
- The Index window is given the clip-children style, so its picture is never painted over the controls [C].
- Mouse cursors over the controls are the Windows class cursors: the standard arrow over the list and the buttons, the I-beam over the edit box. Over the scroll bar see section 1.11 [C for the scroll bar; H for the standard classes].

### 1.3 Font, text and colours
- **Font** [C]: one font for the list and the edit box, requested as face "MS Serif", height −12 (a character height of 12 pixels), weight 700 (bold), everything else zero.
- **What Windows 3.1 gives** [H, from the Windows 3.1 font files and font-mapping rules]: MS Serif is a raster font. At 96 dpi (VGA) it comes in 8, 10, 12, 14, 18 and 24 point. The 8-point face has a character height of 11 pixels (cell height 13, ascent 11, internal leading 2, external leading 0); the 10-point face has 13. The mapper prefers a face that is smaller than requested to one that is larger, so it picks **8 point, cell height 13**. The face is only regular weight, so GDI simulates bold: each glyph is drawn twice, the second time one pixel to the right, and each character advances one pixel more than its regular width.
- **Row height** [C]: the program computes the rows per page as 169 divided by (cell height + external leading), rounded up. With 13-pixel rows that is exactly **13 rows**, and the list box's 169 pixels hold 13 whole rows. That the box is exactly 13 × 13 pixels high supports the 8-point choice [H].
- **One row** [H, standard Windows 3.1 list box]: the item rectangle is the list's full width × 13 rows. The name is drawn from the item's left edge plus a 1-pixel margin, at its top, clipped to the item. Unselected: black text (index 0) on white (index 255). Selected: white text (255) on the highlight colour, navy `000080` (index 4) in the default Windows 3.1 colour scheme. When the list has the focus, a dotted focus rectangle is drawn around the selected row. Names wider than the list are cut off; there is no horizontal scrolling.
- **Edit box** [H, standard Windows 3.1 edit control]: the same font, black on white, text starting at the left edge and the top. While it has the focus, selected text is white on navy and a blinking caret shows; without the focus the selection is not shown.
- **Characters** [V]: names are Windows-1252; besides ASCII they use only `é`, `ö` and the soft hyphen (byte `0xAD`). 325 names use the soft hyphen as a separator, as in "Absorber, Shock ­ Car Suspension". MS Serif draws `0xAD` as a visible short dash (one row lower than `-`). **A remake must draw it as a dash**: a browser's soft hyphen is invisible. Ten names contain two spaces in a row; draw them as stored.
- **For the remake**: Microsoft's font cannot be shipped. Draw the text into the indexed framebuffer with a bitmap font of our own that keeps the metrics above (13-pixel rows, ascent 11, simulated bold), and accept a tolerance on these areas in pixel comparisons (PLAN §5.5).

### 1.4 Contents [C][V]
- The list holds every A–Z index entry (page-database.md), one row per entry, in **data order**: the list box does not sort. The data is almost alphabetical; two entries are out of order ("Motor, Stepper ­ Electric Motor" before "Moldboard", "Röntgen, Wilhelm" before "Rotary Pumps") and the remake must keep them where they are [V].
- Only the Index page uses the A–Z index. The A–Z machine does not; it has its own 26 page refs in its AZDial panel [C].

### 1.5 State when it opens [C]
Each time the Index opens (it is closed and reopened by the Index button), it starts afresh:
- the list's top row is entry 0 and entry 0 is selected;
- the edit box holds entry 0's name ("A. Fouineteau"), all of it selected, and **the edit box has the focus**;
- the scroll bar is at position 0.

### 1.6 Selection, top row and the scroll bar [C]
The program keeps three things in step: the selected entry *sel*, the list's top row *top*, and the scroll bar's position, which always equals *top*.
- *top* runs from 0 to *count* − 13 = 1,844.
- **Keeping the selection visible**: whenever the selection changes by a click or a key (sections 1.7, 1.9), the program then scrolls as little as possible: if *sel* ≥ *top* + 13, *top* becomes *sel* − 12 (the selection on the last row); if *sel* < *top*, *top* becomes *sel*. It sets the scroll bar to *top*.
- **Copying the selection into the edit box**: when the selection changes by a click or a key, the edit box's text is replaced by the selected name, all of it selected.
- Scrolling with the scroll bar moves *top* only; the selection stays (and may scroll out of view).
- The program also remembers the last valid selection ("the entry to go to"). It is updated whenever the list's selection changes, except in two cases where the selection changes but the remembered entry does not: when the edit box is emptied (the list selects entry 0) and when a typed text matches nothing (the selection stays) [C].

### 1.7 Mouse [C][H]
- **List**: a click selects the row under the pointer, gives the list the focus and copies the name into the edit box. Dragging with the button held moves the selection and scrolls the list at its edges (standard list box behaviour [H]); the program re-syncs the scroll bar after each change [C]. A **double click** goes to the entry (section 1.10).
- **Edit box**: standard caret placement and text selection [H].
- **OK**: shows bitmap 169 while held over it (168 when the pointer moves off, as for any push button [H]); a release on it goes to the remembered entry. It does **not** close the Index itself, but every target is a base page, and changing the base page closes the Index (section 1.10).
- **Cancel**: shows 171 while held; a release on it closes the Index.
- **Scroll bar**: section 1.9. Scrolling with the scroll bar while the list has the focus moves the focus to the edit box [C].
- A click on the Index picture outside the controls only stops media (it is a Bitmap). It probably also takes the keyboard focus away from both controls, as a press makes the window the focus page [H]; the hook keys of section 1.9 still work.

### 1.8 Typing in the edit box [C]
Each change of the edit box's text (from typing, deleting or pasting) is handled as follows:
1. If the text is empty: select entry 0 (without scrolling the scroll bar) and stop.
2. If the edit box does not have the focus (the change came from the program copying a name in): just remember the current selection and stop.
3. Otherwise, compare the text with the selected name, ignoring the case of A–Z. If they are equal, keep the selection.
4. If not, find the **first entry, from the top, whose name starts with the text**, ignoring case. If there is none, nothing changes. Otherwise select it; the list scrolls it into view [H: as the standard list box does, the entry ends up on the last row when it was below the view] and the scroll bar follows the list's new top row.

The edit box text is never completed or replaced while typing; only the list follows it. Prefix matching ignores case for all Windows-1252 letters [H: the standard list box search].

### 1.9 Keyboard [C]
Provenance: keyboard hook `1030:58d0`, handler for the private message `0x403` in `1030:4b68`.

While the Index window exists, the program has a keyboard hook on its own task. On every key-down (auto-repeats included) of the keys below, the hook acts and swallows the key, **whichever window has the focus**. All other keys go to the focused control as usual.

| Key | Effect |
|---|---|
| Tab | if the edit box has the focus, focus the list; otherwise focus the edit box. Shift makes no difference |
| Down | *sel* + 1 |
| Up | *sel* − 1; nothing at entry 0 |
| Page Down | *sel* + 13 |
| Page Up | *sel* − 13, or entry 0 if *sel* < 13 |
| Enter | go to the remembered entry (section 1.10), then close the Index |
| Esc | close the Index |

After Up, Down, Page Up and Page Down the program selects the new entry, copies its name into the edit box (all selected) and keeps it visible (section 1.6).

- Keys the hook passes on act as usual: in the edit box, characters, Backspace, Delete, Left, Right, Home and End edit the text (section 1.8); in the list, Home and End select the first and last entry, and a letter selects the next entry starting with that letter [H: standard list box keys]. The list's changes are copied into the edit box as for a click.
- **Bugs in the original** [C]: Down on the last entry, and Page Down within 13 entries of the end (except from exactly entry *count* − 14), ask for an entry past the end. The list then refuses the selection, the edit box and scroll bar are not updated, and the remembered entry becomes invalid, so OK and Enter do nothing until another entry is selected. **Deliberate difference** (a remake decision, open to review by Alex): the remake clamps Down and Page Down to the last entry.
- The private message `0x403` that the hook sends goes to the Index window's own procedure and is consumed there. It never reaches the shared window procedure, so the "ignore the next mouse release" of behaviour.md §1.7 is not triggered by it [C].

### 1.10 Going to an entry [C]
Provenance: `1030:5674` → entry method `1020:7176` → "go to a page" `1010:6360`.
- "Going" to an entry performs "go to a page" (behaviour.md §6.1: ChangePage for a base page, otherwise OpenPage with no zoom) for the entry's **target page**, then in turn for each of its **companion pages** (the "see also" list of page-database.md). All are queued page actions and run in that order after the current input [C].
- On the disc every target is a base page. The entries hold 1,591 companion references (one to four per entry; 546 entries have none). 1,584 of them name popups in the target's own directory, usually the label popup that explains the term; seven entries name a base page instead (one of them in another directory), which then replaces the target [V].
- The ChangePage to the target closes every popup owned by the main window, **the Index included** (the Index is opened from the navigation bar, so the main window owns it; behaviour.md §4.3). The companion popups then open over the new base page, the last one on top with the focus.
- So OK and double click close the Index indirectly, and Enter both goes and closes it. Esc and Cancel close it without going.

### 1.11 The Index scroll bar [C]
Provenance: window class "DKscrollbar", window procedure `1028:dd6e`, registered by `1028:dce2`.

This is a small child window of the program's own, separate from the ScrollBar display object of section 3 but drawn from the same EXE bitmaps.
- **Parts** (control coordinates, 16×173): up arrow rows 0–15 (`LINEUP`), down arrow rows 157–172 (`LINEDOWN`), track rows 16–156 (141 rows), thumb 16 rows (`THUMB`) inside the track.
- **Drawing**: the up arrow at (0, 0) and the down arrow at (0, 157), each at its bitmap's size; the thumb at the track top plus the thumb offset, full width; the track above the thumb from `THUMBTRACK` starting at its row 0; the track below the thumb from `THUMBTRACK` starting at the row (its top − 16), so the texture stays fixed while the thumb moves. While an arrow is held it shows `LINEUPALT`/`LINEDOWNALT` (the arrow pressed in); the `…ALT` thumb and track pictures used while dragging or paging are identical to the normal ones [V, from the bitmaps].
- **Range and thumb**: the Index sets the range 0 to *count* (1,857, not 1,844). The thumb offset for position *p* is round(*p* × 125 / 1,857), where 125 is the track length minus the thumb height (computed in single precision, rounded half up). At the largest *top*, 1,844, the thumb stops one row short of the down arrow.
- **Press** (left button, anywhere in the control; only the vertical position matters):
  - above the track top: line up; else above the thumb top: page up; else above the thumb bottom: start dragging; else above the track bottom: page down; otherwise: line down.
  - Line and page parts act at once (the Index moves *top* by 1 or 13, clamped to 0 … 1,844, and sets the scroll bar to *top*) and then **repeat every 80 ms** while the button is held, with no longer first delay. Before each repeat the control checks that the pointer is still inside the part's current rectangle. If not, the repeat stops for good, even if the pointer comes back. Paging therefore stops when the thumb reaches the pointer.
  - The arrows show their pressed picture until the release.
- **Drag**: from the press on the thumb, the mouse is captured. On each move the position becomes (pointer *y* − 16 − 8) ÷ (125 / 1,857), truncated toward zero, clamped to 0 … 1,857, so **the thumb's centre follows the pointer** (it jumps to centre on the first move; a press alone moves nothing). The Index sets *top* from it, clamped to 0 … 1,844, and puts the thumb back at *top*'s position. On release the drag ends.
- **Cursor**: the pointing hand (EXE cursor 107) over the arrows and the thumb, the standard arrow over the track [C].
- The control never takes the keyboard focus.

### 1.12 For the remake
- Draw the Index controls into the indexed framebuffer as part of the Index page, in the colours of section 1.3. The browser's own form controls must not be used; their look and behaviour differ.
- Typing needs a keyboard. On touch devices (Phase 7) the web app offers the soft keyboard, a presentation addition outside the original:
  - a tap (touch or pen release) that leaves the Index window and its edit box with the focus focuses a hidden text field, which brings up the soft keyboard; a tap that leaves the focus elsewhere, or the Index closing, hides it;
  - the field mirrors the edit box's text and selection. Each change of its text hands the whole new text to the edit box, with the caret where the field has it, and is then handled as typing (section 1.8). Characters the edit box cannot hold are dropped, and a text that would no longer fit the box is refused (the field reverts to the edit box's text);
  - key events still go to the engine first, so a hardware keyboard, or a soft keyboard that sends real keys, types once; the field only acts for input that comes without usable key events (Android's soft keyboards, input methods);
  - Enter and Esc from the soft keyboard act as section 1.9 says.
- **Font**: the engine draws the list and the edit box with its own pixel font (`packages/engine/src/text/serif-font.ts`, drawn for this project), which keeps MS Serif 8 point's metrics: a 13-pixel cell, the baseline 11 rows down, capitals on rows 3–10, lowercase on rows 5–10, descenders to row 12, printable ASCII plus composed Latin-1 accented letters, and the soft hyphen as a dash one row lower than `-`. It is drawn with simulated bold as GDI would. Its glyphs are not Microsoft's, so the text areas differ from any capture (`indexText` in `tools/compare`).
- **Choices where the spec is [H]** (to confirm in DOSBox-X, section 9): list names 1 pixel right of the row's left edge, edit text at the box's left edge, both at the cell's top; selection white on navy (index 4); the dotted focus rectangle inverts every other pixel of the selected row's frame (navy becomes index 251); a 1-pixel inverted caret, 13 rows, blinking every 530 ms; the edit box refuses typing that would no longer fit its 309 pixels; pressing OK or Cancel takes the focus from both controls; dragging in the list past its edges scrolls a row every 100 ms; in the list, Left and Right act as Up and Down and a letter selects the next name with that letter, wrapping; a double click in the edit box selects the word.
- **A double click that goes** (on the list) also swallows the release that follows, so it cannot close the companion popups that open over the new page. What the original does with that release is not established.
- **Touch** (a remake addition, open to review by Alex): a tap on a row selects it, a tap on the selected row goes; swiping the list scrolls it by whole rows, keeping the selection; dragging the scroll bar's thumb works as with the mouse. The desktop mouse behaviour is unchanged.

## 2. A–Z list pages [V][C]
The pages the A–Z machine leads to (e.g. heap offset 8124, the "A" list: "Airliner Wing", "Airplane", "Aerosol" …) are ordinary base pages on template 7 in `\AZAZ\`. Each has one Bitmap with the names baked into the picture and 30 to 47 Hotspots: one per name (ChangePage to the article) and the letter tabs along the bottom (ChangePage to the other list pages). The program draws no text on them, and their static rendering matches the Wine captures exactly (rendering.md §9) [V].

AZHotspots exist only on the A–Z machine page (heap offset 57508). Their codes 0–28 are dial positions (letters A–Z, previous, next, go; behaviour.md §7), not index entries. The go button leads to the letter's page through the AZDial panel's 26 page refs; 24 distinct list pages serve the 26 letters [V].

## 3. ScrollBitmap and ScrollBar (Help pages)

### 3.1 Where and what [V][C]
Six Help popups (heap offsets 142290, 143186, 143794, 144690, 145554 and 146482) each have one ScrollBar (object type 610) with id 518 and one ScrollBitmap (609) with id 519 in the same panel. The ScrollBitmap shows a window onto a picture taller than itself; the ScrollBar scrolls it.

| Page | Picture | Picture size | Window (panel rect) | Scrollable? |
|---|---|---|---|---|
| 142290 | `helpamt0` | 256×298 | (274,50)–(530,348), 256×298 | no (range 0) |
| 143186 | `helpamt1` | 256×807 | same | yes, 28 steps |
| 143794 | `helpamt2` | 256×1,470 | same | yes, 65 steps |
| 144690 | `helpamt3` | 256×418 | same | yes, 6 steps |
| 145554 | `helpamt4` | 256×297 | same | no (range 0) |
| 146482 | `helpbmt0` | 442×1,520 | (51,49)–(495,349), 444×300 | yes, 67 steps |

The bar is at (530,49)–(546,349) on the first five and (495,48)–(511,350) on the last.

**Fields** [C] (page-database.md, Display objects; listed in file order after the cursor):

| Field | ScrollBar | ScrollBitmap |
|---|---|---|
| `u16` | 1: link to a partner | 0: no partner |
| 1st `i16` | id of the partner ScrollBitmap (519) | not used (no link); the values 520–600 look like spare object ids left over from authoring |
| 2nd `i16` | minimum position, 0 (replaced by the partner's) | minimum position, 0 |
| 3rd `i16` | maximum position, 0 (replaced by the partner's) | maximum position as authored; recomputed at load, and the stored values agree with the recomputation |
| 4th `i16` | initial position, 0 | initial position, 0 |

### 3.2 The position model [C]
Provenance: ScrollBitmap load `1030:8584`, draw `1030:bbae`; ScrollBar load `1030:a240`, layout `1030:a4ea`, link `1030:91e4`.

Positions are whole steps. With *V* the window height and *P* the picture height:
- the scrolling distance is *d* = *P* − *V* pixels;
- the ScrollBitmap's maximum position is *n* = *d* ÷ 18 (integer division, so a step is about 18 pixels, one line of Help text). If *n* or *d* is 0 (or less), the picture cannot scroll: the maximum is 0;
- position *p* shows the picture from row round(*p* × *d* / *n*), so the last position shows the picture's bottom exactly. "round" here is: double the product, divide by *n* truncating, add 1, halve rounding down;
- a **page** is round(*V* × *n* / *d*) steps by the same rule: 16, 17, 15 and 16 steps on the four scrollable pages (143186, 143794, 144690, 146482), about one window height.

The ScrollBitmap draws the *W*×*V* area of its picture starting at that row, column 0, at its rectangle's top-left (rendering.md §5). On `helpbmt0` the window is two columns wider than the picture, and on `helpamt4` one row taller; what shows there is not established [H: probably the Help picture underneath, which the ScrollBitmap does not cover there].

When the page opens, the ScrollBar finds its partner by id in its own panel and takes over its minimum, maximum and page; then both go to the initial position, 0.

**ScrollBar geometry** (panel coordinates, rect *L, T, R, B*): up arrow *T* … *T* + 16; down arrow from *B* − 16; track between them; thumb 16 rows high; drawing as in rendering.md §5. The thumb travels *t* = (track length − 16 + 1) pixels, one more than the room in the track: thumb top = track top + round(*p* × *t* / *n*) with the same rounding. At the maximum the thumb's last row lies under the down arrow, which is drawn after it and covers it [C].

Worked example, `helpamt1` (143186): *V* = 298, *P* = 807, *d* = 509, *n* = 28, page = 16. The track is rows 65–332 (268 rows), so *t* = 253. One page down from the top: position 16, picture row 291, thumb top row 210 [C, by the formulas].

### 3.3 Input [C]
Provenance: ScrollBar press `1030:a95c`, release `1030:a75e`, move `1030:a7f0`, timer tick `1030:a698`; steps `1030:94aa`–`1030:9566`.
- **Press** on the ScrollBar (by the pointer's *y* in panel coordinates): above the up arrow's bottom → line up; above the thumb top → page up; above the thumb bottom → thumb; above the down arrow's top → page down; otherwise → line down.
- **Steps**: line up/down move the position by 1, page up/down by the page; the result is clamped to 0 … *n*. Each step moves both the bar's thumb and the partner's picture and redraws them.
- A line or page press acts at once, shows the pressed picture (`LINEUPALT`/`LINEDOWNALT` for the arrows; the track's pressed picture is identical to the normal one), and starts a **100 ms timer**. At each tick, if the pointer is still inside the pressed part's current rectangle, the step repeats; otherwise the press ends as on release. So the first repeat comes 100 ms after the press, then every 100 ms.
- A press on the **thumb** starts a drag; nothing moves until the pointer moves. On each move the position becomes round((pointer *y* − track top − 8) × *n* / *t*) by the same rounding, clamped, for both bar and picture: the thumb's centre follows the pointer. **Leaving the ScrollBar's rectangle ends the drag** at once.
- **Release** ends any press or drag and redraws the pressed part normally. (In the original a release outside the bar does not reach it, but the next timer tick or move ends the press anyway; a remake can end it on any release.)
- Presses and releases on the ScrollBar do not stop media and fire no events. The ScrollBitmap handles a click like a Bitmap: it only stops media. Both draw nothing extra when the mouse is over them; the cursor is the object's own (`Hand` on every ScrollBar, `Arrow` on every ScrollBitmap) under the rules of behaviour.md §8.
- The ScrollBar has no handlers and the ScrollBitmap's picture has no hotspots, so nothing in the scrolled picture is clickable [V].

### 3.4 For the remake
- Implement the model above once and drive it from pointer events; a touch drag on the thumb behaves as a mouse drag.
- **Touch** (a remake addition, open to review by Alex): a finger dragging the thumb keeps the drag when it leaves the 16-pixel bar (the mouse still ends it there), and swiping the scrolled picture scrolls it with the finger (a swipe clicks nothing; a tap still stops media). The desktop mouse behaviour is unchanged.

## 4. The Options popup

### 4.1 Layout [V]
The navigation bar's Options button (button 8) opens popup 278816 (`\OPTIONS\OPTI00`, 237×230, origin (152, 105), so the picture is at page (245, 117) under Windows 3.1). Its objects, in picture coordinates:

| Label in the picture | Rect | Object and action |
|---|---|---|
| COPY ACTIVE WINDOW | (41,66)–(199,81) | Hotspot: ProductOption 1 |
| PRINT ACTIVE WINDOW | (39,96)–(199,110) | Hotspot: ProductOption 2 |
| PRINTER SETUP… | (58,126)–(179,141) | Hotspot: ProductOption 3 |
| MAMMOTH MOVIES… | (46,157)–(195,171) | Hotspot: ChangePage to popup 279010 |
| (button) | (87,188)–(151,212) | CancelButton: ClosePage 278816 |

All Hotspots have flag `0x4`, so a click while something plays only stops it (behaviour.md §3). The popup stays open after copy, print or printer setup; only Cancel (or the system box, shadow, or a click outside) closes it.

"MAMMOTH MOVIES…" changes the popup to 279010 (`OPTI01`, 447×385, a list of the Principles of Science movies whose hotspots ChangePage to the movie pages). Because the size changes, the window moves so that its top-left is at page (origin.x + 93, origin.y − 16) = (140, 32) (rendering.md §7.7) [C].

### 4.2 CancelButton (608) [C]
Provenance: load `1030:13ea`, draw `1030:2e40`, press `1030:2eb2`, release `1030:2f18`, move `1030:2fb2`.
- At rest it draws EXE bitmap **170** (62×22, "Cancel", raised), pressed **171** (pressed in) [C; V for the pictures].
- The copy uses the object's rectangle as the size: 64×24 from a 62×22 picture. GDI does not define what the extra two columns and two rows receive. Under Wine (and very probably under Windows 3.1) nothing is drawn there, so they keep the popup picture underneath, which is plain parchment (index 231) [H]. The remake should draw 170/171 at the rectangle's top-left and leave the rest.
- Press inside: stop all media, draw 171. While the button is held, moving shows 171 inside the rectangle and 170 outside. Release: draw 170; if inside, fire the click event (its handler closes the Options popup).
- The cursor is `Hand`. The three unnamed strings are all empty; a state word that would disable the button is never set [C].

### 4.3 Which page "active window" means [C]
Pressing the Options button records the **newest open page window**: the most recently opened popup still open (or the Index), else the base page (behaviour.md §6.2). Copy and print act on that page, if it is still open when the option is clicked; otherwise they do nothing. The Options popup itself is never the target. "Newest" is opening order, which can differ from the stacking order if the user has clicked an older popup since.

### 4.4 The picture that is copied or printed [C][V]
Provenance: page picture `1028:661c`, caption band `1010:e936`, strings 5000 and 2001 of the EXE string table.
1. **The page's picture**: an off-screen bitmap of the page's content size, into which each of the page's panels is painted at its PanelRef position, exactly as on screen at rest (rendering.md §3). Content size: the template's fixed size if set (638×459 on the title template), else the single panel's size (a popup: its picture, e.g. 287×330), else the right and bottom extent of all panels (638×459 for base pages, nav bar and frame included).
   - Not included: the caption strip, the shadow, other windows on top, animation frames on screen (animations draw straight to the window; their objects paint nothing), the A–Z lamp, and the Index's controls (the Index would copy as its empty frame). Included: the A–Z dial's current letter, an AnimationControl strip, and ScrollBitmaps and ScrollBars at their current position [C][H for animation frames].
2. **The caption band**: the picture is extended by **40 rows** at the bottom, filled with white (index 255). The text is string 5000 of the EXE, **"(C) 1994 Dorling Kindersley and Houghton Mifflin Company"** (56 characters), in black, with no other caption: no page name or title is printed.
   - Font: the default font of a memory device context, i.e. the Windows **System** font (VGA: bold, cell height 16). Its width for this text is 381 pixels [H: measured from the Windows 3.1 font file].
   - If the text is wider than the picture (any picture narrower than 381 pixels, so most popups), a second font is requested: face "Ariel" (sic; no such font exists, so the font mapper substitutes one), height 2 × (picture width ÷ 56) and width (picture width ÷ 56), integer division. For a 287-wide popup that is 10 × 5 pixels [C]; the face the mapper picks is not established [H].
   - Position: horizontally centred, *x* = (picture width − text width) ÷ 2; vertically centred in the band, *y* = picture height + (40 − text height) ÷ 2. For a base page: (128, 471) [C].

So a base page copies or prints as 638×499 pixels, a 287×330 popup as 287×370.

**Observed under Wine** (wine-staging 11, 24-bit X display; Phase 8) [V]: Options → Copy on the Airplane page (1538) put a 638×499 picture on the clipboard, and with the Airplane popup 2534 opened first, a 287×370 one. In both, the 459 (or 330) picture rows are **identical, pixel for pixel, to the remake's `buildCopyImage`** (with the Wine palette patch of reference-environments.md), and the band is white. The caption's ink lies at columns 129–508, rows 474–486 for the base page, which fits the System-font cell at (128, 471) above. For the popup, a smaller sans-serif face, 9 rows of ink at columns 20–267, rows 346–354, confirms the narrow-font path; the face is Wine's substitute for "Ariel", so its glyphs say nothing about Windows 3.1. Wine's X clipboard bridge did not export the picture (the X `CLIPBOARD` selection stayed unowned), so it was read inside Wine with a small clipboard dump program of our own.

The remake's copy and print of this picture, including **Alex's decision to centre printouts on the sheet** (rather than the original's top-left placement), are in section 4.8.

### 4.5 Copy (option 1) [C][V]
Provenance: `1028:5836` → `1028:5926`.
The captioned picture goes to the Windows clipboard, replacing its contents, in two formats: a device-independent bitmap (`CF_DIB`) and a device bitmap (`CF_BITMAP`). No palette format is added. Nothing is shown on screen.
- [V under Wine] The program empties the clipboard, sets `CF_DIB` then `CF_BITMAP`, and closes it (Wine's clipboard trace). Afterwards the clipboard holds formats 8 (`CF_DIB`), 2 (`CF_BITMAP`) and 17 (`CF_DIBV5`, which Wine synthesises), and no `CF_PALETTE`.
- The DIB takes the display's depth: 24 bits per pixel under Wine's true-colour display [V]. On a 256-colour display (Windows 3.1 at 640×480×256) that is 8 bits per pixel with a 256-entry colour table holding the screen palette's colours [C; not yet seen in DOSBox-X].

### 4.6 Print (option 2) [C]
Not observed: the reference machine has no printer, and Wine prints only through CUPS. Under Wine with no printer installed, Print does nothing visible (no dialog, no message) [V]; the layout below stays [C].
Provenance: `1028:5800` → `1028:5870` → `1028:59b2`; layout `1028:5f14`; printer `1028:617a`.
- **No print dialog.** The job goes at once to the printer last chosen in Printer Setup during this session, with the settings chosen there (orientation, paper), or else to the Windows default printer with its defaults.
- A small modeless dialog titled "Printing" shows "Printing", a progress line "*n*% Done" and a Cancel button while the job runs. The document name is "The Way Things Work" (string 2001).
- **Layout** (printer pixels; *Pw* × *Ph* is the printable area, the image is *W* × *H* including the band):
  - the image's top-left goes at the top-left of the printable area;
  - its printed width is *Pw* × *W* / 640 and its height that width × *H* / *W* (both truncated): the scale at which a 640-pixel-wide screen would fill the printable width;
  - if that is taller than *Ph*, the height becomes *Ph* × *H* / 520 and the width that height × *W* / *H* instead: the scale at which 520 pixels (480 + 40) would fill the printable height.

  So a base page fills almost the full width at the top of the sheet, and a popup prints at the same scale, smaller and in the top-left corner. Nothing else is printed.
- The image is stretched with the "colour on colour" mode, i.e. by repeating or dropping whole rows and columns, never smoothed [C].

### 4.7 Printer setup (option 3) [C][V]
Provenance: `1028:6a7e`.
The standard Windows "Print Setup" common dialog, owned by the program's window. Its result (printer, orientation, paper) is kept for later prints until the program exits. Cancelling changes nothing. Under Wine with no printer installed, the common dialog code shows its "install a printer" message instead [V].

### 4.8 For the remake (Phase 8)
- **The picture**: the engine builds the captioned picture (`buildCopyImage`, `Engine.copyImage`) as an indexed image in the screen palette and hands it to the presenter with the ProductOption event; the copyright line is read from string 5000 of `TWTW.EXE` at runtime. The caption is drawn with the engine's own font (section 1.12) in bold when it fits, regular when only that fits, else squeezed to the picture's width by dropping columns, an approximation of both of the original's fonts (exact glyphs are not required). The legal line is part of the original's output and is kept.
- **Copy** (option 1): the captioned picture as a PNG at 2× on the clipboard (`navigator.clipboard.write`). Where the clipboard is missing or refuses, the picture is shown so that it can be copied with a long press or right click, or saved.
- **Print** (option 2): the browser's print dialog replaces the original's direct printing. Only the captioned picture is printed, with nearest-neighbour scaling, at one scale for every picture on a sheet: the smaller of the original's two scales (a 640-pixel screen spanning the printable width, 520 rows filling its height), so a popup still prints at *W*/640 of a full screen's width. The original takes the height scale only when the picture itself would overflow, so on a landscape sheet a wide picture under about 440 rows prints up to a fifth larger there. Wide pictures print in landscape, tall ones in portrait.
- **Placement: centred on the sheet. Alex's decision** (2026-10-15), instead of the original's top-left placement (section 4.6). The web app keeps both as one named option, `PRINT_PLACEMENT` (apps/web).
- **Printer setup** (option 3): the browser has no separate print setup; printer and paper are chosen in its print dialog, so option 3 opens the print dialog for the same page. Cancelling it prints nothing, as cancelling the original's dialog changes nothing.
- **Outside the Options popup** (remake additions): Copy and Print in the settings menu, and Ctrl+P, act on the page by the Options button's rule (section 4.3, `Engine.pictureTarget`). The original has no shortcuts for them (program.md, Commands).

## 5. Help pages [C][V]
- The navigation bar's Help button (button 7) closes the Help page (popup 117408) if it is open, then opens it. 117408 is `HELP0M00`, 560×410, origin (−54, 17), so its window is at page (39, 21) and its picture at (39, 29)–(599, 439) under Windows 3.1: wide, but inside the screen [C][V].
- There are 78 Help popups, all 560×410. Only 117408 is ever opened; every other Help page is reached by a popup-to-popup ChangePage from a Help page [V]. Such a change keeps the window where it is when the size does not change (rendering.md §7.7), so **every Help page appears at 117408's position** (or wherever the user dragged the window). The 77 Help pages whose own origins would place them past page column 638 never show there, and the original does not clamp popups because it does not need to [C]. A remake should place pages exactly by these rules; clipping at the stage edge then never applies to Help.
- **Second Help window** [C]: the Help button looks for an open window showing page 117408 itself. After the user has moved to another Help page the window shows that page instead, so the button does not close it, and the OpenPage of 117408 creates a second Help window on top of the first, at the same place. Closing the new one reveals the old one. **The remake reproduces this** (a remake decision for fidelity, open to review by Alex).
- Six Help pages scroll (section 3). Otherwise the Help pages are ordinary popups: pictures, Hotspots with ChangePage between Help pages, and a WordBox.

## 6. Transitions [V][C]
- ChangePage's `u16` selects a panel transition for the new page's first paint (ids 1–14: wipes, scrolls, dissolves and zooms, among them `wipeleft` and `wiperight`; `1010:0d34`). **It is 0 on all 7,919 ChangePage actions**, so every page appears with a plain copy [V].
- **Dropped**: the remake implements no panel transitions and treats the field as "none". A parser should keep the value.
- The `none`/`zoom` pair belongs to OpenPage's `u16` and is implemented (behaviour.md §4.2).

## 7. Window captions [C]
- The main window's title, "The Way Things Work", is set when the window is created and never changed; Windows draws it in the frame. No page has a name in the database, and the program never sets a caption per page.
- Popups have no Windows caption: their 8-pixel strip is drawn by the program and holds no text (rendering.md §7.3).
- Apart from the Index controls (section 1.3) and the copy/print caption (section 4.4), the program draws no text of its own: article text, the A–Z lists and the Options labels are in the pictures. (The AZDial's 26 strings are file names, not text to draw.)
- For the remake: a fixed `document.title` of "The Way Things Work" matches the original (the web app sets it); a per-page title would be an addition.

## 8. Coverage of types (Phase 6 "done" criterion)
Every type the database defines, where it is specified, and what the remake does with it.

| Kind | Type | Spec | Remake |
|---|---|---|---|
| Page | 101 popup, 102 base | rendering.md §7, behaviour.md | implement |
| Page | 103 index | section 1 | implement |
| Page | 104 child | rendering.md §2 (would be a child window) | **dropped**: none on the disc |
| Panel | 201 Display, 202 AZDial, 203 NavPanel | rendering.md §3, §6; behaviour.md §6, §7 | implement |
| Object | 601 Bitmap | rendering.md §4 | implement |
| Object | 602 AnimationControl | rendering.md §5, playback.md §7 | implement; progress indicator geometry while playing is still [H] |
| Object | 603 Hotspot | behaviour.md §3 | implement; pressed-highlight styles 1–4 **dropped** (style 0 everywhere) |
| Object | 604 AZHotspot | behaviour.md §7 | implement |
| Object | 605 WordBox | behaviour.md §1.3 | implemented as an invisible object with an empty rectangle (catches panel pixel (0,0) only) |
| Object | 606 NavHotspot | behaviour.md §6 | implement |
| Object | 607 AnimHotspot | playback.md §6 | implement |
| Object | 608 CancelButton | section 4.2 | implement |
| Object | 609 ScrollBitmap, 610 ScrollBar | section 3, rendering.md §5 | implement |
| Object | 611 AZAnimHotspot | page-database.md | none on the disc; handled as an AnimHotspot |
| Action | 1 OpenPage, 3 ChangePage, 12 ClosePage | behaviour.md §4 | implement; ChangePage transition **dropped** (section 6) |
| Action | 2 SendMessage | behaviour.md §4.5 | implement (only (181, 59)) |
| Action | 4 PlayWave, 7 PlayPics | playback.md §4 | implement |
| Action | 5 StopWave, 6 SeekWave, 8 PlayPicsNoLoad, 9 PlayNonQueuedPics, 10 StopPics, 13 SeekPics | playback.md §4 | none on the disc; implemented from the spec (SeekWave does nothing) |
| Action | 11 ProductOption | section 4 | implement: the copy and print picture (Phase 6); clipboard, printing and print setup (Phase 8, section 4.8) |
| Event | 1 open, 4 click, 6 finished | behaviour.md §2 | implement |
| Event | 5 before open | behaviour.md §2 | none on the disc; fired for popups (rendering.md §8) |
| Event | 2 app activated, 3 close | behaviour.md §2 | **dropped**: no handler on the disc, and when the original fires them is not established |
| Template | flag A, caption, shadow | rendering.md §7.1 | implement |
| Template | flags B and C, centring flags, no-focus flag, list 1, list 2 | rendering.md §7.1 | **dropped**: unused or no effect on the disc |
| Program | `WM_COMMAND` 0x66–0x69, "Go to page", developer and logging switches, CD check, zoom sounds | program.md, behaviour.md §4.2 | **dropped**: unreachable or not applicable |

Product-level, template-level and page-level handlers are all empty on the disc (behaviour.md §2.1).

The engine keeps this table as data (`packages/engine/src/special/coverage.ts`). A corpus test checks that every page, panel, object and action type and every event the disc uses is implemented, that no ChangePage has a transition, and that the dropped template fields are unused by the templates pages use; a unit test checks that the unused types (a child page, events 2, 3 and unknown codes, the unused media actions, AZAnimHotspot) are handled without error.

## 9. What to check against the original
None of these screens has a reference capture yet. Under Wine (`tools/refcapture`, `docs/reference-environments.md`), once the reference environment is free; the step numbers are object positions in the panel (`page:panel:object`; the navigation bar is panel 849, objects 7, 8 and 9 are Index, Options and Help):
1. The Index as it opens: `pnpm refcapture path workshop 438408:849:7` (page 211350). Check the control positions (section 1.2), entry 0 selected and in the edit box, 13 rows, the scroll bar at rest and the OK/Cancel bitmaps. Wine's font and colours differ from Windows 3.1, so compare geometry, not text pixels.
2. The Options popup: `pnpm refcapture path workshop 438408:849:8` (page 278816): the CancelButton and its two extra columns and rows (section 4.2).
3. Options → Mammoth Movies: `pnpm refcapture path workshop 438408:849:8 278816:1:2` (page 279010): the window placement after a popup-to-popup change of size (rendering.md §7.7).
4. Help: `pnpm refcapture path workshop 438408:849:9` (page 117408), then the scrolling pages `… 438408:849:9 117408:1:36` (142290) and `… 438408:849:9 117408:1:38` (146482). Then a click on the bar's centre, `… 117408:1:38 146482:1:3` (page down on `helpbmt0`): expect position 16, so the picture from its row 291 and the thumb top at panel row 125 (section 3.2: *d* = 1,220, *n* = 67, *t* = 255). A click held longer than 100 ms steps more than once, so record the press duration.
5. ~~Copy~~: done in Phase 8 (section 4.4). Wine's X clipboard bridge does not export the picture, so read the clipboard inside Wine instead.
6. Help button twice after moving to another Help page: two Help windows (section 5).
7. Keyboard on the Index (needs key input in the harness): type "air", Down, Page Down, Tab, Enter; check the selection, the edit box text and the page reached (with its companion popup open).

In DOSBox-X (Windows 3.1), for what Wine cannot show faithfully:
1. The Index list and edit box: font, row height, text margins, highlight colour (navy expected) and focus rectangle (section 1.3).
2. The caption font for a narrow popup copy (the "Ariel" substitute), by pasting the clipboard into Paintbrush.
3. Printing: with DOSBox-X's emulated printer writing to a file and a Windows 3.1 printer driver installed, print a base page and a popup and check the layout of section 4.6 and the "Printing" dialog.
4. The CancelButton's extra columns and rows.
