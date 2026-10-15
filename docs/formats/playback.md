# Playback: sounds and animations

How the original program plays `.WAV` sounds and `.ANI` (PICS) animations: the players, how animation frames are timed against the sound, what starts, queues, stops and ends playback, and the objects built on it (AnimHotspot, NavHotspot, AnimationControl, the A–Z letters). The file formats are in [wav.md](wav.md) and [pics.md](pics.md); input rules that start or stop playback are in [behaviour.md](behaviour.md). Markers: [V] verified, [C] read from the code, [H] hypothesis. Addresses are provenance only.

## Rules in short

1. Each sound or animation file is played by one **player**, shared by everything on screen that names that file. Players are opened (header and sound pre-roll read) when the page holding the action or object loads [C].
2. Animation frames are **clocked by the sound**: the first frame shows when playback starts, and each later frame shows when one more chunk of sound has finished playing. This confirms the timing model of pics.md [C].
3. Frames are drawn in the **panel** of the object that plays them, clipped to that panel. When an animation ends, its last frame stays on screen [C].
4. **Stop all media** stops every player and rewinds it to its start. Most clicks do this first (behaviour.md §3) [C].
5. A PlayPics or PlayWave of a file that is already playing **waits** until that file finishes; an AnimHotspot or AnimationControl starts at once [C].
6. Only one player at a time is the **current** one, the one whose completed sound buffers advance it. A remake with its own clock per player does not need to copy this limitation [C].

## 1. Players [C]
Provenance: player cache `1008:0bfc`, factory `1008:0d78`, list of players at `1040:035c`.
- There are two kinds of player: sound (`.WAV`) and animation (`.ANI`).
- **Sharing.** A player is identified by its file name and kind. When an action or object needs a file, an existing player for that name is reused, otherwise a new one is opened and added to a program-wide list. Each user holds a reference; the player goes away with its last user.
- **When files open.** PlayWave and PlayPics actions resolve their player when they are read, i.e. when their page loads; an AnimHotspot without flag `0x10` opens its animation when its panel opens (rendering.md §8). Opening an animation reads its header and its A × B pre-roll chunks (pics.md), queuing their sound, and reads the first frame chunk. A web remake should therefore fetch a page's media as the page loads.
- **States** of an animation player: opened, playing, paused (stopped part-way), ended.
- **Current player.** The program has a single "current player" slot. Starting playback makes that player current. When a sound buffer completes, Windows notifies the main window (`MM_WOM_DONE`, `1010:54ca`), and the program advances **the current player** only. A second player started while one is running takes the slot, and the first stops advancing [C]. On the disc this rarely matters, because clicks stop all media before starting anything (behaviour.md §3).

## 2. Animation timing [C]
Provenance: open `1018:6810`, start `1018:6d1a`, step `1018:6e0a`, end `1018:6efa`, wave queue `1018:5606`–`5b2e`.

The animation's sound goes through a ring of A × B + 2 sound buffers, one chunk's PCM per buffer (pics.md, header and chunks).
1. **Open:** queue the sound of the A × B pre-roll chunks; read the first frame chunk: queue its sound, decode its picture as the *pending* frame.
2. **Start:** draw the pending frame (frame 0) at once. Open the wave device and hand it all filled buffers: the pre-roll and the first frame chunk's sound (A × B + 1 buffers). Read the next frame chunk (its sound into the ring, its picture as pending).
3. **Each completed buffer:** draw the pending frame (if frames remain), hand the next filled buffer to the device, read the next frame chunk.
4. **End:** when every chunk has been read and no buffer is still playing, stop: reset and close the wave device. The player is then *ended*.

Consequences:
- Frame *k* (frame chunks counted from 0) is drawn when sound chunk *k* (counted over **all** chunks, pre-roll included) **starts** playing, i.e. at (sound bytes of chunks 0 … *k* − 1) / bytes per second after the start. This is exactly the model of pics.md, now [C].
- The device always holds about A × B + 1 buffers ahead, so the pictures run A × B chunks ahead of the sound stored with them. The sound written with frame chunk *k* is heard A × B chunks after its picture.
- A chunk without sound (`s` = 0, only at the ends of files) adds no buffer and so no completion. Frames still due are drawn by the completions of earlier buffers, as long as there are enough of them; in every file on the disc there are (pics.md, checks).
- Frame drawing happens when the completion message is handled, so a busy program draws late but never skips frames.
- Each frame is drawn by copying only its rectangle (pics.md) to the screen, in panel coordinates, clipped to the panel (§3). Nothing else is repainted.
- **No sound device.** If the wave device cannot be opened, the start reports no error, frame 0 is drawn, and nothing further happens: the animation freezes on its first frame [C].

For the remake: decode the whole soundtrack, start it on the Web Audio clock, and draw frame *k* at start time + offset *k* as above. This is equivalent, and lets several animations run together.

## 3. Where frames are drawn [C][V]
An animation draws through the device context of the panel that holds its object (the hotspot whose handler started it, the AnimHotspot, the AnimationControl): the origin is the panel's position in its window and drawing is clipped to the panel (`1008:5b52` → `1008:edd4`; for popups, below the caption strip). Frame rectangles are therefore **panel coordinates**. They are unrelated to the object's own rectangle, which only matters for clicks: `QCAM1M0A`'s AnimHotspot is (533,1)–(539,5), its frames cover (28,1)–(446,448) [V]. On base pages the content panel is at page (94,4); the title template's single panel is at (0,0).

Frames draw over whatever is on screen, normally the panel's background picture, and stay there: the program never restores the picture when an animation stops or ends. Only a later repaint of the panel (a window uncovered, a page change) brings the background back. This explains the title transition's leftovers over the Workshop (rendering.md §8) [H].

## 4. Actions

### 4.1 Fields [C][V]
PlayWave (4) and the three PlayPics actions (7, 8, 9) share one layout after the file name: five 16-bit values. Calling them *v1* … *v5* in file order, the data always holds *v1* = −1, *v2* = −1, *v3* = 1, *v4* = 1, *v5* = 0, except one PlayWave with *v5* = 1 (page-database.md).

| Value | PlayWave | PlayPics |
|---|---|---|
| *v1*, *v2* | stored next to each other and passed to the sound start as one 32-bit value (−1); no effect found [C] | stored; no effect found [C] |
| *v3* | passed to the player when the file is opened; no effect found | the same |
| *v4* | stored on the player; no effect found | stored; 0 or −1 is replaced by 1 |
| *v5* | 1: skip this sound when the program's "sound off" switch is on [C]. What sets that switch was not found [H: no usable wave device] | not used |

Only *v5* changes behaviour, and only in that unexplained case; a remake can ignore all five values. The internal actions built by the program (§5, §7) use the same values (−1, −1, 1, then 0 or 1, 0 or 1).

### 4.2 PlayWave [C]
Provenance: execute `1020:561a`, `1020:8548`, sound start `1020:7f68`.
- If the file's sound player is idle, start it now (with the hourglass shown while the device opens) and make it the current player. If it is playing, **queue** this request: it plays after the current playback ends.
- Different sound files are different players. Each opens the wave device itself; on a device that accepts only one client (the Sound Blaster driver of the reference machine) a second sound cannot start while another plays [H]. On the disc a sound is nearly always started by a click, which first stops all media, so this does not arise.
- A sound keeps playing when the page that started it changes [H: the queued request keeps the player alive; 96 handlers play a sound then change popup, which only makes sense if it does]. Check on DOSBox-X.

### 4.3 PlayPics (7) [C]
Provenance: execute `1020:a068` → `1020:4354`.
- Like PlayWave: start now if the file's player is idle, otherwise queue until it ends. The animation draws in the panel of the object whose handler ran the action.
- All 393 PlayPics on the disc are Hotspot click actions [V], and those Hotspots have flag `0x4`, so a click while anything plays only stops it (behaviour.md §3).

### 4.4 The unused variants [C]
None of these occur on the disc [V].
- **PlayPicsNoLoad (8):** opens the file when executed rather than when its page loads, then behaves as PlayPics (`1028:bfac`).
- **PlayNonQueuedPics (9):** starts at once, without waiting for the player's queue (`1018:e8c8` → `1020:3d7a`). The program uses this kind internally for AnimHotspots (§5).
- **StopWave (5), StopPics (10):** stop the named sound or animation (`1028:1fb2`, `1020:94c2`).
- **SeekPics (13):** rewind the animation to its start (`1028:1340`). **SeekWave (6):** does nothing.

## 5. Stop all media [C]
Provenance `1008:0e40`.
- Every player in the program-wide list that is playing is stopped: the wave device is reset and closed, pending completions are discarded, and the player is closed and reopened at its start, ready to play again. Players that are not playing are rewound too, unless they are paused or ended.
- Users of a stopped player are told; an AnimHotspot stopped this way does **not** fire its finished event [H].
- The screen keeps the frame that was last drawn (§3).
- The report "something was playing" drives the click rules of behaviour.md §3.
- Triggers: clicks on Hotspots with flag `0x4`, AnimHotspots, NavHotspots, Bitmaps and other plain objects; pressing the CancelButton; a click on a page that owns popups; the AnimationControl's buttons; the program losing activation (behaviour.md §10).

## 6. AnimHotspot (607) [C]
Provenance: load `1028:3872`, start `1028:3e4a`, click `1028:3c02`, end `1028:3d50`.

225 on the disc [V]: flags 0 (132, all with an on_finish handler), `0x10` (67, 33 of them with on_finish), `0x20` (24, all with on_finish) and `0x40` (2, with on_finish).
- **Load:** the object builds a PlayNonQueuedPics for its file (values −1, −1, 1, 1, 0) and opens the player. Without flag `0x10` this happens when its panel opens; with `0x10` ("load on demand") at the click, and the player is released again when the animation ends or is stopped.
- **Autostart (`0x20`):** right after loading, at panel open (after the panel's open handlers), start playing and become the current player. The title animation and 23 others start this way.
- **Click** (behaviour.md §3): stop all media; if something was playing, that is all. Otherwise, if its own animation is not already playing, start it and become the current player.
- **End** (all frames shown): stop being the current player; with `0x40`, rewind to the start ("auto-rewind"); with `0x10`, release the player; then fire the **finished** event (event 6): its on_finish actions run (189 ChangePage, 2 OpenPage on the disc), queued as in behaviour.md §2.3.
- Without `0x40` the player stays *ended*. A later click starts it again from the beginning [H].

The NavHotspot (606) and the A–Z machine's letter animation use the same machinery, with a different end step: the nav button rewinds and performs its navigation (behaviour.md §6.1); the letter animation goes to the letter's page (behaviour.md §7).

## 7. AnimationControl (602) [C][H]
Provenance: parts `1028:987a`, click `1028:9dac`, message `1028:8566`, start `1028:9812`, end `1028:8416`, draw `1028:a474`.

A movie with a small control strip: its animation file is the movie, whose frames form the movie screen in panel coordinates (§3), and the strip is the 74×22 bitmap control of rendering.md §5. Of the 59 on the disc, 22 are on Principles of Science movie pages (base), 9 on other article base pages and 28 on popups [V].
- **Parts** (offsets from the strip's top-left): the play button at (20,3) in three pictures (bitmaps 116, 119, 120: play, and two others, probably pause and a disabled or pressed state [H]); the rewind button at (3,3) in two (115, 117); bitmap 118 at (38,6); the progress indicator, bitmap 159, at (39,7); the background, bitmap 101, at (0,0).
- **While playing** [V] (the 22 movie pages' Wine captures, matched pixel for pixel): rewind is bitmap 117 and play is replaced by 119, the pause button. At rest it is 115 and 116, so 115 is the greyed rewind; 120 has 115's greyed colours, so it is probably the greyed play button [H]. The progress indicator is the **left edge of bitmap 159** (a darker fill with a one-pixel border) drawn at (39,7), 9 rows high and as many columns wide as the progress, inside the slot of bitmap 101 that spans columns 39–68 (30 columns; column 69 is the slot's black edge). The captures show 1 to 4 columns after 0.2–2.4 s of films of 24–60 s; how the width follows the position is not measurable under Wine's stall [H: the remake uses ⌈30 × position / length⌉, at least 1, while not at rest].
- **Play button:** toggles between playing and paused. Starting stops all media first; if something was playing, the press only stops it [C]. While playing, the play picture is replaced by the pause picture (seen in the movie pages' Wine captures, rendering.md §8 [V]).
- **Rewind button:** stops all media; if nothing was playing, rewinds the movie to its start and returns the buttons to rest.
- **Messages:** the control answers one message, the number stored in its last `i16` (59 on every control), by acting as if its play button had been clicked at its top-left + (1,1). `SENDMESSAGE (181, 59)` is "press play on control 181" (behaviour.md §4.5). The 22 Principles movie pages send it from their panel's open handler, so their movie starts when the page opens; 76 hotspots send it on click (clicking the movie screen or a label plays or pauses it).
- **First trailing `u16`** (0 on the disc): 1 would start the movie when the panel opens.
- **Second trailing `u16`** (0 on the 22 movie pages, 1 elsewhere): at the end of the movie, 1 rewinds it and returns the strip to rest; 0 leaves it at its last frame with the buttons in their ended state [C, details H]. The remake shows the ended state as rewind 117, play 120 and a full indicator, and a press of play then starts the movie again from its beginning [H].
- **Progress indicator:** bitmap 159 is drawn into the strip, positioned by the playback position, and is invisible at rest [V at rest only]. Its exact geometry while playing is [H]; capture it in DOSBox-X.

## 8. What to check against the original
Wine stalls animations after a few seconds (reference-environments.md), so use **DOSBox-X** (Windows 3.1, Sound Blaster) for:
1. Frame timing: record a screen video of `AIRP0M0A` (the Airplane propeller, 5 frames) and the title animation with audio, and compare frame change times with §2. Expect frame *k* at the start of sound chunk *k*.
2. A sound started by a PlayWave, CHANGEPAGE handler keeps playing on the new popup (§4.2), e.g. the `\PRINCIPL\QLIT\` popups.
3. Clicking a hotspot while an animation plays stops it and leaves the frame on screen (§3, §5).
4. A Principles movie: the play/pause toggle, rewind, the progress indicator's width against the playing position, and the strip at the end (second trailing `u16` = 0): is play greyed (120), and what does a press of play do then?
5. An AnimHotspot with `0x40`: after the end, does the last frame stay or does the start frame show?

Under Wine, file opens (e.g. `strace -f -e trace=openat` on the Wine processes) can confirm §1: a page's PlayPics and PlayWave files are opened when the page loads, before any click.
