// The coverage table (special-screens.md §8): every type has an entry, and the types no page on
// the disc uses are handled gracefully.
import {
  ACTION_TYPE_CODES,
  HandlerEvent,
  OBJECT_TYPE_CODES,
  PAGE_TYPE_CODES,
  PANEL_TYPE_CODES,
  type Action,
  type DisplayObject,
  type Handler,
} from '@twtw/formats';
import type { HeapEntrySpec, PageContent } from '@twtw/formats/testing';
import { describe, expect, it } from 'vitest';
import { Engine, type EngineEvent } from '../engine.ts';
import {
  bitmapObject,
  panelSlot,
  RecordingMedia,
  rect,
  rgb,
  syntheticDib,
  syntheticDisc,
  template,
} from '../testing/index.ts';
import {
  ACTION_TYPE_SUPPORT,
  EVENT_SUPPORT,
  OBJECT_TYPE_SUPPORT,
  PAGE_TYPE_SUPPORT,
  PANEL_TYPE_SUPPORT,
  TEMPLATE_FIELD_SUPPORT,
} from './coverage.ts';

describe('the coverage table', () => {
  it('has an entry for every page, panel, object and action type the format defines', () => {
    expect(Object.keys(PAGE_TYPE_SUPPORT).toSorted()).toEqual(Object.keys(PAGE_TYPE_CODES).toSorted());
    expect(Object.keys(PANEL_TYPE_SUPPORT).toSorted()).toEqual(Object.keys(PANEL_TYPE_CODES).toSorted());
    expect(Object.keys(OBJECT_TYPE_SUPPORT).toSorted()).toEqual(Object.keys(OBJECT_TYPE_CODES).toSorted());
    expect(Object.keys(ACTION_TYPE_SUPPORT).toSorted()).toEqual(Object.keys(ACTION_TYPE_CODES).toSorted());
    expect(Object.keys(EVENT_SUPPORT).map(Number)).toEqual(Object.values(HandlerEvent).toSorted());
    expect(Object.keys(TEMPLATE_FIELD_SUPPORT)).toContain('unknownRect');
  });
});

const click = (...actions: Action[]): Handler[] => [{ event: HandlerEvent.Click, actions }];

function hotspot(id: number, left: number, handlers: Handler[]): DisplayObject {
  return {
    kind: 'hotspot',
    id,
    flags: 4,
    rect: rect(left, 10, left + 20, 30),
    cursor: 'Hand',
    handlers,
    unknown1: 0,
  };
}

const unusedMediaActions: Action[] = [
  { kind: 'stopWave', name: 'SND' },
  { kind: 'seekWave' },
  { kind: 'playPicsNoLoad', file: 'ANIM', unknown1: 0, unknown2: 0, unknown3: 0, unknown4: 0, unknown5: 0 },
  {
    kind: 'playNonQueuedPics',
    file: 'ANIM',
    unknown1: 0,
    unknown2: 0,
    unknown3: 0,
    unknown4: 0,
    unknown5: 0,
  },
  { kind: 'stopPics', name: 'ANIM' },
  { kind: 'seekPics' },
];

const page = (objects: readonly DisplayObject[], fields: Partial<PageContent> = {}): PageContent => ({
  pageType: 'base',
  templateId: 7,
  origin: { x: 0, y: 0 },
  directory: '\\ART\\',
  handlers: [],
  links: null,
  panels: [{ kind: 'display', id: 1, objects: [bitmapObject(1, 0, 0, 'BACK'), ...objects], handlers: [] }],
  ...fields,
});

const heap: HeapEntrySpec[] = [
  {
    label: 'home',
    page: (ref) =>
      page([
        hotspot(2, 10, click({ kind: 'openPage', page: ref('child'), unknown1: 0 })),
        hotspot(3, 40, click({ kind: 'changePage', page: ref('child'), unknown1: 0 })),
        hotspot(4, 70, click(...unusedMediaActions)),
        hotspot(5, 100, [
          {
            event: HandlerEvent.AppActivated,
            actions: [{ kind: 'changePage', page: ref('child'), unknown1: 0 }],
          },
          { event: HandlerEvent.Close, actions: [{ kind: 'changePage', page: ref('child'), unknown1: 0 }] },
          { event: 99, actions: [{ kind: 'changePage', page: ref('child'), unknown1: 0 }] },
        ]),
        {
          kind: 'azAnimHotspot',
          id: 6,
          flags: 0,
          rect: rect(130, 10, 150, 30),
          cursor: 'Hand',
          handlers: [],
          file: 'ANIM',
          unknown1: 1,
        },
      ]),
  },
  { label: 'child', page: () => page([], { pageType: 'child', templateId: 9 }) },
];

const disc = syntheticDisc(
  {
    product: (ref) => ({
      title: 'Synthetic',
      width: 640,
      height: 480,
      version: null,
      defaultCursor: 'Arrow',
      backgroundColour: rgb(0),
      unknown1: 0,
      startupPage: ref('home'),
      handlers: [],
      templates: [
        template({ id: 7, pageType: 'base', unknown3: 1, panels: [panelSlot(1, 94, 4, 544, 455, 0xff0000)] }),
        template({ id: 9, pageType: 'child', panels: [panelSlot(1, 0, 0, 0, 0, 0xffffff)] }),
      ],
    }),
    heap,
  },
  { 'ART/BACK.DIB': syntheticDib(544, 455, 20) },
);

describe('types no page on the disc uses', () => {
  async function load() {
    const media = new RecordingMedia();
    media.endAtOnce = true;
    const engine = await Engine.load(disc.source, { media });
    const events: EngineEvent[] = [];
    engine.on((event) => events.push(event));
    const clickAt = async (x: number): Promise<void> => {
      await engine.pointerDown(94 + x + 5, 4 + 15);
      await engine.pointerUp(94 + x + 5, 4 + 15);
      await engine.idle();
    };
    return { engine, media, events, clickAt };
  }

  it('fails gracefully to open or change to a child page (dropped)', async () => {
    const { engine, events, clickAt } = await load();
    await clickAt(10);
    await clickAt(40);
    expect(events.map((event) => event.kind)).toEqual(['actionFailed', 'actionFailed']);
    expect(engine.windows).toEqual([]);
    expect(engine.basePage?.ref).toBe(disc.refs.get('home'));
  });

  it('passes the unused media actions to the media in order', async () => {
    const { media, clickAt } = await load();
    media.clear();
    await clickAt(70);
    const actions = media.calls.flatMap((call) => (call.kind === 'action' ? [call.action.kind] : []));
    expect(actions).toEqual(unusedMediaActions.map((action) => action.kind));
  });

  it('never fires the dropped events (2, 3) or unknown ones on a click', async () => {
    const { engine, events, clickAt } = await load();
    await clickAt(100);
    expect(events).toEqual([]);
    expect(engine.basePage?.ref).toBe(disc.refs.get('home'));
  });

  it('plays an AZAnimHotspot like an AnimHotspot', async () => {
    const { media, clickAt } = await load();
    media.clear();
    await clickAt(130);
    expect(media.calls.filter((call) => call.kind === 'animation')).toHaveLength(1);
  });
});
