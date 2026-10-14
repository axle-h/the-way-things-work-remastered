import { describe, expect, it } from 'vitest';
import { FormatError } from '../reader.ts';
import { buildPageDatabase, type PageContent, type RefOf } from '../testing/pagedb-builder.ts';
import type { Action, DisplayObject, Product, Template } from './model.ts';
import { HandlerEvent } from './model.ts';
import { NO_PAGE_REF, parsePageDatabase } from './parse.ts';

// Hand-assembled big-endian bytes, written straight from the tables in docs/formats/page-database.md
// so that the parser is checked independently of the test builder.
const u16 = (value: number): number[] => [(value >> 8) & 0xff, value & 0xff];
const u32 = (value: number): number[] => [...u16(Math.floor(value / 0x10000)), ...u16(value & 0xffff)];
const text = (s: string): number[] => [...u16(s.length), ...[...s].map((c) => c.charCodeAt(0))];

function minimalDatabase(): { bytes: Uint8Array; heapOffset: number } {
  const strings = [...u16(3), ...text('Demo'), ...text('Arrow'), ...text('Hand')];
  const product = [
    ...u16(1), // title "Demo"
    ...u16(640),
    ...u16(480),
    ...u16(0), // no version
    ...u16(2), // default cursor "Arrow"
    ...u16(0),
    ...u16(255),
    ...u16(0), // background colour
    ...u16(0), // unknown1
    ...u32(0), // startup page at heap offset 0
    ...u16(0), // no templates
    ...u16(0), // no handlers
    ...u16(1), // one A–Z index entry
    ...u16(1), // name "Demo"
    ...u16(4),
    ...u16(0),
    ...u32(0), // page
    ...u16(1),
    ...u32(NO_PAGE_REF), // one "see also": none
  ];
  const page = [
    ...u16(102), // base page
    ...u16(7), // template 7
    ...u16(0),
    ...u16(0), // origin
    ...u16(0), // no directory
    ...u16(1), // one panel
    ...u16(201), // Display
    ...u16(1), // panel id
    ...u16(1), // one object
    ...u16(603), // Hotspot
    ...u16(3), // id
    ...u16(4), // flags
    ...u16(10),
    ...u16(20),
    ...u16(30),
    ...u16(40), // rect
    ...u16(3), // cursor "Hand"
    ...u16(1), // one handler
    ...u16(4), // click
    ...u16(1), // one action
    ...u16(3), // ChangePage
    ...u32(0),
    ...u16(0),
    ...u16(0xffff), // hotspot field: -1
    ...u16(0), // panel handlers
    ...u16(0), // page handlers
    ...u16(0), // no links
  ];
  const heapOffset = 8 + strings.length + product.length;
  return {
    bytes: new Uint8Array([...u32(heapOffset), ...u32(strings.length), ...strings, ...product, ...page]),
    heapOffset,
  };
}

describe('parsePageDatabase on hand-assembled bytes', () => {
  it('parses the header records', () => {
    const { bytes, heapOffset } = minimalDatabase();
    const db = parsePageDatabase(bytes);
    expect(db.heapOffset).toBe(heapOffset);
    expect(db.strings).toEqual(['Demo', 'Arrow', 'Hand']);
    expect(db.string(0)).toBeNull();
    expect(db.string(3)).toBe('Hand');
    expect(db.product).toEqual({
      title: 'Demo',
      width: 640,
      height: 480,
      version: null,
      defaultCursor: 'Arrow',
      backgroundColour: { red: 0, green: 255, blue: 0 },
      unknown1: 0,
      startupPage: 0,
      templates: [],
      handlers: [],
    });
    expect(db.index).toEqual([{ name: 'Demo', nameLength: 4, unknown1: 0, page: 0, seeAlso: [null] }]);
  });

  it('parses a page', () => {
    const { bytes, heapOffset } = minimalDatabase();
    const db = parsePageDatabase(bytes);
    expect(db.heapLength).toBe(bytes.length - heapOffset);
    expect(db.getPage(0)).toEqual({
      ref: 0,
      byteLength: db.heapLength,
      pageType: 'base',
      templateId: 7,
      origin: { x: 0, y: 0 },
      directory: null,
      panels: [
        {
          kind: 'display',
          id: 1,
          objects: [
            {
              kind: 'hotspot',
              id: 3,
              flags: 4,
              rect: { left: 10, top: 20, right: 30, bottom: 40 },
              cursor: 'Hand',
              handlers: [
                { event: HandlerEvent.Click, actions: [{ kind: 'changePage', page: 0, unknown1: 0 }] },
              ],
              unknown1: -1,
            },
          ],
          handlers: [],
        },
      ],
      handlers: [],
      links: null,
    });
    expect(db.getPage(0)).toBe(db.getPage(0));
  });

  it.each([
    ['an unknown object type', 0x12, 704, /unknown object type 704/],
    ['an unknown panel type', 0x0c, 299, /unknown panel type 299/],
    ['an unknown action type', 0x28, 14, /unknown action type 14/],
    ['an unknown page type', 0x00, 100, /unknown page type 100/],
    ['an out-of-range string index', 0x08, 4, /string index 4 is outside the string table/],
    ['a links flag other than 0 or 1', 0x36, 2, /page links flag is 2/],
  ])('rejects %s in a page', (_label, pageOffset, value, message) => {
    const { bytes, heapOffset } = minimalDatabase();
    bytes.set(u16(value), heapOffset + pageOffset);
    const db = parsePageDatabase(bytes);
    expect(() => db.getPage(0)).toThrow(FormatError);
    expect(() => db.getPage(0)).toThrow(message);
  });

  it('reports the file offset of a truncated page', () => {
    const { bytes, heapOffset } = minimalDatabase();
    const db = parsePageDatabase(bytes.subarray(0, bytes.length - 1));
    expect(() => db.getPage(0)).toThrow(
      `(at offset ${heapOffset + 0x36} (0x${(heapOffset + 0x36).toString(16)}))`,
    );
  });

  it('rejects heap references outside the heap', () => {
    const db = parsePageDatabase(minimalDatabase().bytes);
    expect(() => db.getPage(db.heapLength)).toThrow(/outside the page heap/);
    expect(() => db.getSharedPanel(-2, 'display')).toThrow(/outside the page heap/);
  });

  it('rejects a string table whose length does not match its contents', () => {
    const { bytes } = minimalDatabase();
    bytes.set(u32(15), 4);
    expect(() => parsePageDatabase(bytes)).toThrow(FormatError);
  });

  it('rejects records that end before the page heap', () => {
    const { bytes, heapOffset } = minimalDatabase();
    bytes.set(u32(heapOffset + 2), 0);
    expect(() => parsePageDatabase(bytes)).toThrow(/2 unexpected bytes before the page heap/);
  });

  it('rejects a header that points past the end of the file', () => {
    expect(() => parsePageDatabase(new Uint8Array([...u32(100), ...u32(0)]))).toThrow(
      /header is inconsistent/,
    );
    expect(() => parsePageDatabase(new Uint8Array([0, 0]))).toThrow(FormatError);
  });
});

// ---------------------------------------------------------------------------------------------
// Round trips through the test builder

const rect = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom });
const white = { red: 255, green: 251, blue: 240 };

function everyAction(ref: RefOf): Action[] {
  return [
    { kind: 'openPage', page: ref('other'), unknown1: 1 },
    { kind: 'sendMessage', message: 181, parameter: 59 },
    { kind: 'changePage', page: null, unknown1: 0 },
    {
      kind: 'playWave',
      file: 'snd0m0s',
      unknown1: -1,
      unknown2: -1,
      unknown3: 1,
      unknown4: 1,
      unknown5: 0xffff,
    },
    { kind: 'stopWave', name: 'snd0m0s' },
    { kind: 'seekWave' },
    {
      kind: 'playPics',
      file: 'anim0m0a',
      unknown1: -1,
      unknown2: 2,
      unknown3: 0x8000,
      unknown4: -3,
      unknown5: 1,
    },
    {
      kind: 'playPicsNoLoad',
      file: 'anim0m1a',
      unknown1: 0,
      unknown2: 0,
      unknown3: 0,
      unknown4: 0,
      unknown5: 0,
    },
    {
      kind: 'playNonQueuedPics',
      file: null,
      unknown1: 1,
      unknown2: 2,
      unknown3: 3,
      unknown4: 4,
      unknown5: 5,
    },
    { kind: 'stopPics', name: null },
    { kind: 'productOption', option: 3 },
    { kind: 'closePage', page: ref('other') },
    { kind: 'seekPics' },
  ];
}

function everyObject(ref: RefOf): DisplayObject[] {
  const common = { flags: 0, rect: rect(1, 2, 3, 4), cursor: 'Hand', handlers: [] };
  return [
    { kind: 'bitmap', id: 2, ...common, file: 'pic0m' },
    {
      kind: 'animationControl',
      id: 3,
      ...common,
      unknown1: 0,
      unknownRect: rect(45, 405, 119, 427),
      file: 'pic0m0a',
      unknownCursor: 'Hand',
      unknown2: 0,
      unknown3: 1,
      unknown4: 59,
    },
    {
      kind: 'hotspot',
      id: 4,
      ...common,
      flags: 5,
      handlers: [
        { event: HandlerEvent.Click, actions: everyAction(ref) },
        { event: HandlerEvent.Finished, actions: [] },
        { event: 0xabcd, actions: [{ kind: 'seekWave' }] },
      ],
      unknown1: -7,
    },
    { kind: 'azHotspot', id: 5, ...common, flags: 4, unknown1: 0, unknown2: 28 },
    { kind: 'wordBox', id: 6, flags: 0x100, rect: null, cursor: null, handlers: [] },
    { kind: 'navHotspot', id: 850, ...common, file: 'nav\\navb0m0a', unknown1: 1 },
    { kind: 'animHotspot', id: 7, ...common, flags: 32, file: 'pic1z1a', unknown1: 1 },
    { kind: 'cancelButton', id: 8, ...common, unknownStrings: [null, 'Cancel', null] },
    {
      kind: 'scrollBitmap',
      id: 519,
      rect: rect(274, 50, 530, 348),
      cursor: 'Arrow',
      unknown1: 0,
      unknown2: 520,
      unknown3: 0,
      unknown4: 28,
      unknown5: -1,
      file: 'help0',
    },
    {
      kind: 'scrollBar',
      id: 518,
      rect: rect(530, 49, 546, 349),
      cursor: 'Hand',
      unknown1: 1,
      unknown2: 519,
      unknown3: 0,
      unknown4: 0,
      unknown5: 0,
      parts: ['@LINEUP', '@LINEDOWN', '@THUMB', '@THUMBTRACK', 'up', 'down', null, '@X'],
    },
    { kind: 'azAnimHotspot', id: 9, ...common, file: 'azaz1a', unknown1: -1 },
  ];
}

const baseTemplate = (ref: RefOf): Template => ({
  pageType: 'base',
  id: 7,
  unknown1: null,
  unknown2: 0,
  width: 0,
  height: 0,
  position: null,
  unknown3: 1,
  unknown4: 0,
  unknown5: 0,
  unknown6: 0,
  unknownRect: null,
  unknownList1: [],
  unknownList2: [],
  panels: [
    {
      panelType: 'navPanel',
      panelId: 849,
      sharedPanel: ref('nav'),
      colour: { red: 0, green: 0, blue: 0 },
      width: 94,
      height: 459,
      x: 0,
      y: 0,
    },
    {
      panelType: 'display',
      panelId: 1,
      sharedPanel: null,
      colour: white,
      width: 540,
      height: 450,
      x: 94,
      y: 4,
    },
  ],
  handlers: [],
});

const popupTemplate: Template = {
  pageType: 'popup',
  id: 0,
  unknown1: [7, 1],
  unknown2: 3,
  width: 10,
  height: -20,
  position: { x: 5, y: 6 },
  unknown3: 1,
  unknown4: -4,
  unknown5: 0xffff,
  unknown6: 2,
  unknownRect: rect(-1, -2, 3, 4),
  unknownList1: [1, 849, 388],
  unknownList2: [-5],
  panels: [
    { panelType: 'display', panelId: 1, sharedPanel: null, colour: white, width: 0, height: 0, x: 0, y: 0 },
  ],
  handlers: [{ event: HandlerEvent.Open, actions: [{ kind: 'seekPics' }] }],
};

const product = (ref: RefOf): Product => ({
  title: 'Synthetic Café',
  width: 640,
  height: 480,
  version: 'Version 1 “test”',
  defaultCursor: 'Arrow',
  backgroundColour: { red: 0, green: 255, blue: 0 },
  unknown1: 0x1234,
  startupPage: ref('all'),
  templates: [baseTemplate(ref), popupTemplate],
  handlers: [
    { event: HandlerEvent.AppActivated, actions: [{ kind: 'changePage', page: ref('all'), unknown1: 0 }] },
  ],
});

const allPage = (ref: RefOf): PageContent => ({
  pageType: 'base',
  templateId: 7,
  origin: { x: 0, y: 0 },
  directory: '\\ARTICLE1\\TEST\\',
  panels: [
    { kind: 'display', id: 1, objects: everyObject(ref), handlers: [] },
    {
      kind: 'azDial',
      id: 78,
      objects: [],
      handlers: [{ event: HandlerEvent.Close, actions: [] }],
      letterPages: Array.from({ length: 26 }, (_, i) => (i % 2 ? null : ref('other'))),
      letterAnimations: Array.from({ length: 26 }, (_, i) =>
        i === 25 ? null : `azaz0m${String.fromCharCode(97 + i)}a`,
      ),
    },
  ],
  handlers: [{ event: HandlerEvent.BeforeOpen, actions: [{ kind: 'productOption', option: 1 }] }],
  links: [ref('other'), null, ref('all'), ref('other')],
});

const otherPage = (): PageContent => ({
  pageType: 'popup',
  templateId: 0,
  origin: { x: 151, y: -137 },
  directory: null,
  panels: [],
  handlers: [],
  links: null,
});

const navPanel = (ref: RefOf) => ({
  unknown1: 0,
  panel: {
    kind: 'navPanel' as const,
    id: 849,
    objects: [],
    handlers: [],
    buttonIds: [850, 851, 852, 853, 854, 855, 856, 858, 857],
    buttonPages: [ref('all'), null, ref('other'), null, null, null, null, null, ref('other')],
  },
});

describe('parsePageDatabase round trips', () => {
  const built = buildPageDatabase({
    product,
    index: (ref) => [
      { name: 'Ångström', nameLength: 8, unknown1: 0, page: ref('other'), seeAlso: [ref('all'), null] },
      { name: null, nameLength: 0, unknown1: -1, page: null, seeAlso: [] },
    ],
    heap: [
      { label: 'all', page: allPage },
      { label: 'nav', sharedPanel: navPanel },
      { label: 'other', page: otherPage },
    ],
  });
  const db = parsePageDatabase(built.bytes);
  const ref: RefOf = (label) => built.refs.get(label) ?? -1;

  it('round-trips the product record and templates', () => {
    expect(db.product).toEqual(product(ref));
    expect(db.strings).toEqual(built.strings);
  });

  it('round-trips the A–Z index', () => {
    expect(db.index).toEqual([
      { name: 'Ångström', nameLength: 8, unknown1: 0, page: ref('other'), seeAlso: [ref('all'), null] },
      { name: null, nameLength: 0, unknown1: -1, page: null, seeAlso: [] },
    ]);
  });

  it('round-trips every object type and every action type', () => {
    const page = db.getPage(ref('all'));
    expect(page).toEqual({ ref: ref('all'), byteLength: built.lengths.get('all'), ...allPage(ref) });
    const objects = page.panels[0]?.objects ?? [];
    expect(objects.map((o) => o.kind).sort()).toEqual([
      'animHotspot',
      'animationControl',
      'azAnimHotspot',
      'azHotspot',
      'bitmap',
      'cancelButton',
      'hotspot',
      'navHotspot',
      'scrollBar',
      'scrollBitmap',
      'wordBox',
    ]);
    const hotspot = objects.find((o) => o.kind === 'hotspot');
    expect(hotspot?.handlers[0]?.actions.map((a) => a.kind)).toHaveLength(13);
  });

  it('round-trips popup pages and shared panels', () => {
    expect(db.getPage(ref('other'))).toEqual({ ref: ref('other'), byteLength: 16, ...otherPage() });
    expect(db.getSharedPanel(ref('nav'), 'navPanel')).toEqual({
      ref: ref('nav'),
      byteLength: built.lengths.get('nav'),
      ...navPanel(ref),
    });
  });

  it('caches shared panels and rejects a conflicting panel type', () => {
    const shared = db.getSharedPanel(ref('nav'), 'navPanel');
    expect(db.getSharedPanel(ref('nav'), 'navPanel')).toBe(shared);
    expect(() => db.getSharedPanel(ref('nav'), 'display')).toThrow(
      /requested as display, previously as navPanel/,
    );
  });

  it('finds the template of a page', () => {
    expect(db.templateFor(db.getPage(ref('all')))?.pageType).toBe('base');
    expect(db.templateFor(db.getPage(ref('other')))?.id).toBe(0);
  });
});
