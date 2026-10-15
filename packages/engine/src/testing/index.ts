/**
 * Synthetic discs for tests (the repository holds no disc bytes, docs/CLEAN_ROOM.md): pictures,
 * a program file with a `PALETTE` resource and the bitmaps the engine draws itself, and helpers
 * for display objects and templates. Not part of the runtime API (see package.json "./testing").
 */
import type { BitmapObject, DisplayObject, PanelRef, Rect, Rgb, Template } from '@twtw/formats';
import {
  buildDib,
  buildNeExecutable,
  buildPageDatabase,
  buildPics,
  buildRiffWave,
  ByteWriter,
  fmtChunk,
  packPicsRuns,
  type PageDatabaseSpec,
} from '@twtw/formats/testing';
import type { Clock } from '../clock.ts';
import { ClockAudioSink, type AudioClip, type AudioVoice } from '../media/audio.ts';
import { DATABASE_PATH, PROGRAM_PATH } from '../content.ts';
import { MemoryDataSource } from '../data/memory-source.ts';
import type { AnimationRequest, ControlRequest, Media, MediaAction, MediaTarget } from '../media.ts';
import type { PageInstance } from '../page.ts';
import { ProgramBitmap } from '../pictures.ts';

/** A pixel value for each position, or one value for all. */
export type PixelFill = number | ((x: number, y: number) => number);

/**
 * An uncompressed 8-bit DIB whose pixel at (x, y) (from the top) is `fill`. The colour table is
 * deliberately not the palette (all grey ramp), since the engine must ignore it.
 */
export function syntheticDib(width: number, height: number, fill: PixelFill, fileHeader = true): Uint8Array {
  const stride = Math.ceil(width / 4) * 4;
  const data = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Rows are stored bottom-up.
      data[(height - 1 - y) * stride + x] = typeof fill === 'number' ? fill : fill(x, y);
    }
  }
  const palette = Array.from({ length: 256 * 3 }, (_, i) => Math.floor(i / 3));
  return buildDib({ width, height, palette, pixelData: data, fileHeader });
}

/**
 * The synthetic master palette's artwork entries: entry i (10–245) is (i, 255 − i, 7i mod 256),
 * except entry 245, which repeats the static colour `FFFBF0` (as on the disc).
 */
export function syntheticArtworkColour(index: number): Rgb {
  if (index === 245) return { red: 0xff, green: 0xfb, blue: 0xf0 };
  return { red: index, green: 255 - index, blue: (index * 7) & 0xff };
}

/** A `LOGPALETTE` resource: artwork entries 10–245, `PC_EXPLICIT` system entries elsewhere. */
export function syntheticLogPalette(): Uint8Array {
  const writer = new ByteWriter('le').u16(0x300).u16(256);
  for (let i = 0; i < 256; i++) {
    if (i >= 10 && i <= 245) {
      const { red, green, blue } = syntheticArtworkColour(i);
      writer.u8(red).u8(green).u8(blue).u8(4);
    } else {
      writer.u8(i).u8(0).u8(0).u8(2);
    }
  }
  return writer.toBytes();
}

/** Pixel values of the synthetic program bitmaps, so tests can recognise them on screen. */
export const SYNTHETIC_BITMAP_FILL = {
  [ProgramBitmap.animationControl]: 101,
  [ProgramBitmap.animationRewind]: 115,
  [ProgramBitmap.animationPlay]: 116,
  [ProgramBitmap.animationRewindActive]: 117,
  [ProgramBitmap.animationPause]: 119,
  [ProgramBitmap.animationPlayEnded]: 120,
  [ProgramBitmap.animationProgress]: 159,
  [ProgramBitmap.ok]: 168,
  [ProgramBitmap.okPressed]: 169,
  [ProgramBitmap.cancel]: 170,
  [ProgramBitmap.cancelPressed]: 171,
  [ProgramBitmap.lampOn]: 172,
  [ProgramBitmap.lampOff]: 173,
  [ProgramBitmap.dialGo]: 152,
} as const;

/** Sizes of the program bitmaps the engine draws (program.md, rendering.md §5–6). */
const PROGRAM_BITMAP_SIZES: readonly (readonly [number, number, number])[] = [
  [ProgramBitmap.animationControl, 74, 22],
  [ProgramBitmap.animationRewind, 15, 16],
  [ProgramBitmap.animationPlay, 16, 16],
  [ProgramBitmap.animationRewindActive, 15, 16],
  [ProgramBitmap.animationPause, 16, 16],
  [ProgramBitmap.animationPlayEnded, 16, 16],
  [ProgramBitmap.animationProgress, 100, 30],
  [ProgramBitmap.ok, 62, 22],
  [ProgramBitmap.okPressed, 62, 22],
  [ProgramBitmap.cancel, 62, 22],
  [ProgramBitmap.cancelPressed, 62, 22],
  [ProgramBitmap.lampOn, 17, 8],
  [ProgramBitmap.lampOff, 18, 8],
  [ProgramBitmap.dialGo, 46, 40],
];

/** Scroll-bar part bitmaps (named resources), 16 wide; each pixel is `fill + row % 2`. */
export const SYNTHETIC_SCROLL_PARTS = [
  { name: 'LINEUP', height: 16, fill: 60 },
  { name: 'LINEDOWN', height: 16, fill: 70 },
  { name: 'THUMB', height: 16, fill: 80 },
  { name: 'THUMBTRACK', height: 270, fill: 90 },
  { name: 'LINEUPALT', height: 16, fill: 64 },
  { name: 'LINEDOWNALT', height: 16, fill: 74 },
  { name: 'THUMBALT', height: 16, fill: 84 },
  { name: 'THUMBTRACKALT', height: 270, fill: 94 },
] as const;

/** The synthetic program's copyright line (string 5000; the real one is read from the disc). */
export const SYNTHETIC_COPYRIGHT = '(C) Synthetic Test Disc';

/** A string-table block (program.md, Strings): 16 length-prefixed strings. */
function stringBlock(strings: Readonly<Record<number, string>>): Uint8Array {
  const writer = new ByteWriter('le');
  for (let i = 0; i < 16; i++) {
    const text = strings[i] ?? '';
    writer.u8(text.length);
    for (const char of text) writer.u8(char.charCodeAt(0));
  }
  return writer.toBytes();
}

/**
 * A program file (NE) with the palette, the engine's numbered bitmaps, the scroll-bar parts and
 * the copyright string.
 */
export function syntheticProgram(): Uint8Array {
  return buildNeExecutable([
    { type: 6, id: 313, data: stringBlock({ 8: SYNTHETIC_COPYRIGHT }) },
    { type: 'PALETTE', id: 200, data: syntheticLogPalette() },
    ...PROGRAM_BITMAP_SIZES.map(([id, width, height]) => ({
      type: 2,
      id,
      data: syntheticDib(
        width,
        height,
        SYNTHETIC_BITMAP_FILL[id as keyof typeof SYNTHETIC_BITMAP_FILL],
        false,
      ),
    })),
    ...SYNTHETIC_SCROLL_PARTS.map(({ name, height, fill }) => ({
      type: 2,
      id: name,
      data: syntheticDib(16, height, (_x, y) => fill + (y % 2), false),
    })),
  ]);
}

/**
 * A data source holding a page database built from `spec`, the synthetic program and the given
 * files. Returns the heap offsets of the labelled heap entries too.
 */
export function syntheticDisc(
  spec: PageDatabaseSpec,
  files: Readonly<Record<string, Uint8Array>> = {},
): { source: MemoryDataSource; refs: ReadonlyMap<string, number> } {
  const database = buildPageDatabase(spec);
  const source = new MemoryDataSource([
    [DATABASE_PATH, database.bytes],
    [PROGRAM_PATH, syntheticProgram()],
    ...Object.entries(files),
  ]);
  return { source, refs: database.refs };
}

// ---------------------------------------------------------------------------------------------
// Model helpers

export function rect(left: number, top: number, right: number, bottom: number): Rect {
  return { left, top, right, bottom };
}

export function rgb(value: number): Rgb {
  return { red: value >> 16, green: (value >> 8) & 0xff, blue: value & 0xff };
}

/** A Bitmap object; the stored rectangle's right/bottom are deliberately wrong (the picture decides). */
export function bitmapObject(id: number, left: number, top: number, file: string): BitmapObject {
  return {
    kind: 'bitmap',
    id,
    flags: 0,
    rect: rect(left, top, left + 999, top + 999),
    cursor: null,
    handlers: [],
    file,
  };
}

export function hotspotObject(id: number, area: Rect): DisplayObject {
  return { kind: 'hotspot', id, flags: 4, rect: area, cursor: 'Hand', handlers: [], unknown1: 0 };
}

export function panelSlot(
  panelId: number,
  x: number,
  y: number,
  width: number,
  height: number,
  colour: number,
  sharedPanel: number | null = null,
): PanelRef {
  return { panelType: 'display', panelId, sharedPanel, colour: rgb(colour), width, height, x, y };
}

/** A template with the given fields; everything else as on the disc's base templates. */
export function template(fields: Partial<Template> & Pick<Template, 'id' | 'pageType' | 'panels'>): Template {
  return {
    unknown1: null,
    unknown2: 0,
    width: 0,
    height: 0,
    position: null,
    unknown3: 0,
    unknown4: 0,
    unknown5: 0,
    unknown6: 0,
    unknownRect: null,
    unknownList1: [],
    unknownList2: [],
    handlers: [],
    ...fields,
  };
}

// ---------------------------------------------------------------------------------------------
// Time and media

/** A clock that moves only when the test says so; waits resolve when their time has come. */
export class ManualClock implements Clock {
  #now = 0;
  #waiting: { at: number; resolve: () => void }[] = [];

  now(): number {
    return this.#now;
  }

  wait(ms: number): Promise<void> {
    return new Promise((resolve) => this.#waiting.push({ at: this.#now + ms, resolve }));
  }

  /** Moves time on, resolving the waits that are due. */
  advance(ms: number): void {
    this.#now += ms;
    const due = this.#waiting.filter((waiting) => waiting.at <= this.#now);
    this.#waiting = this.#waiting.filter((waiting) => waiting.at > this.#now);
    for (const waiting of due) waiting.resolve();
  }
}

/** What the engine asked a {@link RecordingMedia} to do. */
export type MediaCall =
  | { readonly kind: 'stopAll'; readonly wasPlaying: boolean }
  | { readonly kind: 'action'; readonly action: MediaAction; readonly target: MediaTarget }
  | { readonly kind: 'animation'; readonly request: AnimationRequest }
  | { readonly kind: 'control'; readonly request: ControlRequest }
  | { readonly kind: 'pageClosed'; readonly page: PageInstance };

/**
 * Media for tests: records every call, plays nothing by itself. `playing` makes it report that
 * something plays (until the next stop); animations end when the test calls {@link endAnimations},
 * or at once with `endAtOnce`.
 */
export class RecordingMedia implements Media {
  readonly calls: MediaCall[] = [];
  playing = false;
  endAtOnce = false;
  #pending: { request: AnimationRequest; ended: () => void }[] = [];

  isPlaying(): boolean {
    return this.playing;
  }

  stopAll(): boolean {
    const wasPlaying = this.playing;
    this.calls.push({ kind: 'stopAll', wasPlaying });
    this.playing = false;
    this.#pending = [];
    return wasPlaying;
  }

  runAction(action: MediaAction, target: MediaTarget): void {
    this.calls.push({ kind: 'action', action, target });
  }

  playAnimation(request: AnimationRequest, ended: () => void): void {
    this.calls.push({ kind: 'animation', request });
    if (this.endAtOnce) ended();
    else this.#pending.push({ request, ended });
  }

  control(request: ControlRequest): void {
    this.calls.push({ kind: 'control', request });
  }

  pageClosed(page: PageInstance): void {
    this.calls.push({ kind: 'pageClosed', page });
  }

  /** Animations started and not yet ended or stopped. */
  get pending(): readonly AnimationRequest[] {
    return this.#pending.map(({ request }) => request);
  }

  /** Ends the pending animations (those matching `which`), in the order they started. */
  endAnimations(which: (request: AnimationRequest) => boolean = () => true): void {
    const ending = this.#pending.filter(({ request }) => which(request));
    this.#pending = this.#pending.filter(({ request }) => !which(request));
    for (const { ended } of ending) ended();
  }

  /** The calls of one kind. */
  of<K extends MediaCall['kind']>(kind: K): Extract<MediaCall, { kind: K }>[] {
    return this.calls.filter((call): call is Extract<MediaCall, { kind: K }> => call.kind === kind);
  }

  clear(): void {
    this.calls.length = 0;
  }
}

// ---------------------------------------------------------------------------------------------
// Sounds and animations

/** One chunk of a {@link syntheticPics}: `sound` bytes of PCM, and optionally a solid image. */
export interface SyntheticChunk {
  readonly sound: number;
  /** A rectangle (panel coordinates) filled with `fill`. */
  readonly image?: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
    readonly fill: number;
  };
}

/**
 * A PICS animation (pics.md) with A × B pre-roll chunks (sound only) and the given frame chunks.
 * The sound runs at `rate` bytes (8-bit samples) per second; each chunk's samples are its index,
 * so tests can tell chunks apart in the soundtrack.
 */
export function syntheticPics(spec: {
  readonly preRoll: readonly [number, number];
  readonly preRollSound: number;
  readonly frames: readonly SyntheticChunk[];
  readonly rate?: number;
}): Uint8Array {
  const [a, b] = spec.preRoll;
  const chunks = [
    ...Array.from({ length: a * b }, (): SyntheticChunk => ({ sound: spec.preRollSound })),
    ...spec.frames,
  ].map((chunk, index) => {
    const sound = new Array<number>(chunk.sound).fill(index & 0xff);
    const image = chunk.image;
    if (image === undefined) return { sound };
    const stride = (image.width + 1) & ~1;
    const pixels = new Array<number>(stride * image.height).fill(image.fill);
    return {
      sound,
      rect: {
        left: image.left,
        top: image.top,
        right: image.left + image.width,
        bottom: image.top + image.height,
      },
      unpackedSize: pixels.length,
      packed: packPicsRuns(pixels),
    };
  });
  return buildPics({
    preRollFactorA: a,
    preRollFactorB: b,
    chunks,
    ...(spec.rate === undefined ? {} : { samplesPerSecond: spec.rate }),
  });
}

/** An 8-bit mono PCM WAV of `samples` samples at `rate` per second. */
export function syntheticWave(samples: number, rate = 1000): Uint8Array {
  return buildRiffWave([
    {
      id: 'fmt ',
      data: fmtChunk({
        formatTag: 1,
        channels: 1,
        samplesPerSecond: rate,
        averageBytesPerSecond: rate,
        blockAlign: 1,
        bitsPerSample: 8,
      }),
    },
    { id: 'data', data: new Array<number>(samples).fill(128) },
  ]);
}

/** A start recorded by {@link RecordingAudioSink}. */
export interface RecordedVoice {
  readonly clip: AudioClip;
  readonly offset: number;
  /** Clock time (s) of the start. */
  readonly at: number;
  stopped: number | null;
}

/** A silent sink on a clock that records what it was asked to play and to stop. */
export class RecordingAudioSink extends ClockAudioSink {
  readonly voices: RecordedVoice[] = [];

  override start(clip: AudioClip, offset: number): AudioVoice {
    const voice = super.start(clip, offset);
    const record: RecordedVoice = { clip, offset, at: this.now(), stopped: null };
    this.voices.push(record);
    return {
      startTime: voice.startTime,
      stop: () => {
        record.stopped ??= this.now();
      },
    };
  }
}
