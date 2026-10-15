# tools/compare

`pnpm compare` replays the reference captures of `pnpm refcapture` (`tools/refcapture/README.md`) in the headless engine and diffs each one against our rendering (`docs/architecture.md`, "Validation" 5). It writes an HTML report and `results.json` to `vendor/compare/` (gitignored). Nothing from the disc or the captures is ever committed.

## Usage

```
pnpm compare                     # every capture in vendor/ref
pnpm compare 1538                # captures of page 1538, or whose path starts there
pnpm compare 41* 'path-*'        # a page glob, a capture-name glob
pnpm compare 1188/path-1538_*    # a glob over <page>/<name>
pnpm compare --images differing  # write pictures only for captures that differ (all, differing, none)
pnpm compare --out DIR --quiet
pnpm compare --media settle      # play everything out (true settled states; see below)
```

`$TWTW_CD` (the disc, default `vendor/cd`), `$TWTW_REF` (the captures, default `vendor/ref`) and `$TWTW_COMPARE_OUT` (default `vendor/compare`) override the locations. A filtered run updates its captures in `results.json` and keeps the others. The command exits with 1 if a capture has an unexplained difference or could not be replayed.

Open `vendor/compare/index.html`: totals, the expected differences by reason, and a table of captures you can filter and sort. Each capture has a page with the reference, our rendering and the diff side by side (red: unexplained, orange: explained, blue tint: masked area), and a picture you click to blink between reference and ours.

## What one comparison does

1. **Replay** (`src/state.ts`). Start directly at the capture's start page (empty history, as refcapture's patched start), then replay each click step through the engine's own input: a press and a release at the step's recorded `clientPoint`. The point must hit the object the step names (`page:panel:object`), and the final state must be the one refcapture expected; otherwise the capture is an error. Autostart animations never end in the replay, as they stall under Wine (the auto-advance candidates below handle pages that should move on); all other animations, such as the navigation buttons', end at once.
2. **Render** with the `wine` presentation (popup placement, shadow over white, nearest-colour captions) and convert through the master palette.
3. **Diff** the client area: 638×459 when the sidecar's `wineClient` says Wine's client covered the whole capture (refcapture records it since it sets `WM_STATE`, reference-environments.md "Client area size"); otherwise 638×459 unless the capture is black beyond 634×454 (as in captures made before that fix), then 634×454; or the overlap with an older 634×454 capture.
4. **Classify** every differing pixel by the first mask that covers it (`src/masks.ts`), derived from the database, the engine's state and the sidecar. Anything else is unexplained.

| Reason | Where | Pixels it explains |
|---|---|---|
| `wineClientStrip` | columns 634–637, rows 454–458, in captures made before refcapture set `WM_STATE` (no `wineClient` covering them) | black in the reference |
| `wineCaptionColour` | each popup's 8-pixel caption strip | Wine's `9E9E9E` and `3296FA`, which the palette lacks (rendering.md §7.3) |
| `wineWhitePopup` | each popup the sidecar lists in `whitePopups` (X window ids, matched to our windows by their rectangle): window row 4 down to the shadow, across the picture | white in the reference; caption rows 0–3 and the shadow stay compared (reference-environments.md, "Popups that stay white") |
| `azLamp` | the A–Z dial's lamp | any (it blinks, rendering.md §6) |
| `moviePlaying` | the AnimationControl strip addressed by a panel's on_open SENDMESSAGE, and its animation's frames | strip: any; frames: colours a frame paints there |
| `wineAnimationStall` | autostart animations of a page that should have moved on | colours a frame of the animation paints there |
| `autostartAnimation` | other autostart animations | the same |
| `animationLeftover` | the animation that moved on to the page | the same |
| `referenceChanging` | the sidecar's `changingRect`, when the capture still cycled | any |
| `indexText` | the Index page's edit box and list (special-screens.md §1.3) | any: the text is in our own font, not Windows' MS Serif; the scroll bar and buttons are not masked |

Animation masks are per pixel: a difference counts as explained only where the reference shows a colour that some frame of that animation paints at that position (frames placed at their panel's origin).

**Auto-advance.** For a capture whose page should move on by itself (`settledDiffersFromRequested`), two renderings are tried: the page itself with its animation stalled, and the page it moves on to with what the animation leaves behind. The one with fewer unexplained pixels wins, and the result says `stalled` or `arrived`.

**Navigation stall.** When the last step is a navigation button and the capture was still cycling inside the nav bar (`changingRect`), Wine may have stalled the button's press-in animation, so the page change it waits for never came. The state before that click is tried too, and the result notes it when it wins.

**Media modes.** By default (`--media stall`) the replay mimics Wine, where the references were captured: autostart animations stall and everything else ends at once, without drawing frames. `--media settle` plays all sound and animation on a virtual clock (`docs/formats/playback.md`) and compares the true settled state, frames included: autostart pages move on (the title arrives at the still title), movies play to their last frame. Wine's captures do not show that, so expect differences there: currently 2 captures are unexplained in this mode, the stalled title animation and a path whose last navigation button Wine stalled.

**Status** per capture: `exact` (no differing pixel), `explained` (all explained), `unexplained`, or `error` (the replay failed).

## Output

```
vendor/compare/index.html                       the summary and the table
vendor/compare/results.json                     totals and every capture's result
vendor/compare/captures/<page>/<name>.html      one capture
vendor/compare/captures/<page>/<name>.{ref,ours,diff}.png
```

Each result in `results.json` has the status, the differing and unexplained pixel counts, the percentage of the compared area, the explained pixels by reason, bounding boxes of the unexplained and of all differing pixels, the masks with their reasons, the rendered state and notes.

## Tests

`pnpm test` runs the unit tests on a synthetic disc (`src/test-disc.ts`, built with `@twtw/formats/testing` and `@twtw/engine/testing`): the diff and its classification, bounding boxes, the masks and whole comparisons, including replayed clicks. `src/acceptance.corpus.test.ts` compares the acceptance set (title still page, Workshop, A–Z machine, A–Z "A", Airplane and the Airplane popup paths) and requires zero unexplained pixels; it skips without the disc or the captures.
