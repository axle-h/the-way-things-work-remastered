# @twtw/web

The browser app: a 640×480 canvas showing the engine's indexed framebuffer, pointer and keyboard input, the original's cursors, and sound through Web Audio. `pnpm dev` serves it with the extracted disc under `/data` (`vendor/cd`, or `$TWTW_CD`).

## Sound and the "tap to start" gate

Browsers start audio only from a user gesture, so the app loads the page database behind a plain "Tap to start" button over the stage. The tap creates the `AudioContext` and then the title starts, with its animation and sound.

- The engine decodes the disc's sounds itself (MS-ADPCM and 8-bit PCM, `@twtw/formats`) and hands clips to `WebAudioSink` (`src/audio.ts`), which makes each into an `AudioBuffer` once and schedules it slightly ahead.
- Animation frames are timed by the audio clock (`docs/formats/playback.md` §2): the sink reports `AudioContext.currentTime` less the output latency, i.e. what is being heard, and the engine draws frame *k* when that reaches the start of sound chunk *k*.
- If iOS suspends audio (a call, the app in the background), the next tap or key resumes it. Switching tabs or apps stops all media, as the original does when it loses activation.

In development builds, `window.twtw` holds the engine, the media and the sink, and `twtw.playbackLog` lists every voice start and every frame drawn with its audio-clock time, for checking sync from the console.

`#page=<ref>` in the URL starts at another page (after the gate), `#page=<ref>,popup=<ref>` opens popups over it, and `presentation=wine` places popups as in the Wine captures.

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
