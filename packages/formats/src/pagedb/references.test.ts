import { describe, expect, it } from 'vitest';
import { buildPageDatabase, type PageContent, type RefOf } from '../testing/pagedb-builder.ts';
import { HandlerEvent, type Panel, type Rgb, type Template } from './model.ts';
import { parsePageDatabase } from './parse.ts';
import {
  collectReachable,
  mediaReferencedByPage,
  mediaReferencedByPanel,
  pagesReferencedByPage,
  resolveMedia,
} from './references.ts';

const black: Rgb = { red: 0, green: 0, blue: 0 };
const box = { left: 0, top: 0, right: 10, bottom: 10 };
const plain = { flags: 0, rect: box, cursor: 'Hand' };

const template = (ref: RefOf): Template => ({
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
      colour: black,
      width: 94,
      height: 459,
      x: 0,
      y: 0,
    },
    {
      panelType: 'display',
      panelId: 1,
      sharedPanel: null,
      colour: black,
      width: 540,
      height: 450,
      x: 94,
      y: 4,
    },
    {
      panelType: 'display',
      panelId: 387,
      sharedPanel: ref('frame'),
      colour: black,
      width: 544,
      height: 5,
      x: 94,
      y: 454,
    },
  ],
  handlers: [],
});

const basePage = (directory: string, panel: Panel, links: PageContent['links'] = null): PageContent => ({
  pageType: 'base',
  templateId: 7,
  origin: { x: 0, y: 0 },
  directory,
  panels: [panel],
  handlers: [],
  links,
});

// A three-page database plus an A–Z dial page, the index page, two shared panels and one
// popup that nothing references.
const built = buildPageDatabase({
  product: (ref) => ({
    title: 'Test',
    width: 640,
    height: 480,
    version: null,
    defaultCursor: 'Arrow',
    backgroundColour: black,
    unknown1: 0,
    startupPage: ref('title'),
    templates: [template(ref)],
    handlers: [],
  }),
  index: (ref) => [{ name: 'Airplane', nameLength: 8, unknown1: 0, page: ref('article'), seeAlso: [] }],
  heap: [
    {
      label: 'title',
      page: (ref) =>
        basePage('\\TITLE\\', {
          kind: 'display',
          id: 1,
          objects: [
            { kind: 'bitmap', id: 2, ...plain, handlers: [], file: 'TITLE0m' },
            {
              kind: 'hotspot',
              id: 3,
              ...plain,
              handlers: [
                {
                  event: HandlerEvent.Click,
                  actions: [{ kind: 'changePage', page: ref('article'), unknown1: 0 }],
                },
              ],
              unknown1: 0,
            },
          ],
          handlers: [],
        }),
    },
    {
      label: 'article',
      page: (ref) =>
        basePage(
          '\\ARTICLE1\\AIRP\\',
          {
            kind: 'display',
            id: 1,
            objects: [
              { kind: 'bitmap', id: 2, ...plain, handlers: [], file: 'AIRP0m' },
              {
                kind: 'hotspot',
                id: 3,
                ...plain,
                handlers: [
                  {
                    event: HandlerEvent.Click,
                    actions: [{ kind: 'openPage', page: ref('popup'), unknown1: 0 }],
                  },
                ],
                unknown1: 0,
              },
              { kind: 'animHotspot', id: 4, ...plain, handlers: [], file: 'AIRP0m0a', unknown1: 1 },
            ],
            handlers: [],
          },
          [ref('popup'), ref('title'), ref('dial'), ref('title')],
        ),
    },
    {
      label: 'popup',
      page: () => ({
        pageType: 'popup',
        templateId: 0,
        origin: { x: 151, y: 137 },
        directory: '\\ARTICLE1\\AIRP\\',
        panels: [
          {
            kind: 'display',
            id: 1,
            objects: [{ kind: 'bitmap', id: 2, ...plain, handlers: [], file: 'AIRP0j' }],
            handlers: [],
          },
        ],
        handlers: [
          {
            event: HandlerEvent.Open,
            actions: [
              {
                kind: 'playWave',
                file: 'AIRP0j0s',
                unknown1: -1,
                unknown2: -1,
                unknown3: 1,
                unknown4: 1,
                unknown5: 0,
              },
            ],
          },
        ],
        links: null,
      }),
    },
    {
      label: 'orphan',
      page: () => ({
        pageType: 'popup',
        templateId: 0,
        origin: { x: 0, y: 0 },
        directory: null,
        panels: [],
        handlers: [],
        links: null,
      }),
    },
    {
      label: 'dial',
      page: (ref) =>
        basePage('\\AZAZ\\', {
          kind: 'azDial',
          id: 78,
          objects: [],
          handlers: [],
          letterPages: Array.from({ length: 26 }, (_, i) => (i === 0 ? ref('article') : null)),
          letterAnimations: Array.from({ length: 26 }, (_, i) => (i === 0 ? 'azaz0maa' : null)),
        }),
    },
    {
      label: 'index',
      page: () => ({
        pageType: 'index',
        templateId: 617,
        origin: { x: 89, y: 42 },
        directory: '\\INDEX\\',
        panels: [],
        handlers: [],
        links: null,
      }),
    },
    {
      label: 'nav',
      sharedPanel: (ref) => ({
        unknown1: 0,
        panel: {
          kind: 'navPanel',
          id: 849,
          objects: [
            { kind: 'bitmap', id: 2, ...plain, handlers: [], file: 'nav\\nav' },
            { kind: 'navHotspot', id: 850, ...plain, handlers: [], file: 'nav\\navb0m0a', unknown1: 1 },
          ],
          handlers: [],
          buttonIds: [850, 851, 852, 853, 854, 855, 856, 857, 858],
          buttonPages: [ref('index'), null, null, null, null, null, null, null, null],
        },
      }),
    },
    {
      label: 'frame',
      sharedPanel: () => ({
        unknown1: 0,
        panel: {
          kind: 'display',
          id: 387,
          objects: [
            { kind: 'bitmap', id: 2, ...plain, handlers: [], file: 'nav\\framebot' },
            {
              kind: 'scrollBar',
              id: 518,
              rect: box,
              cursor: null,
              unknown1: 1,
              unknown2: 519,
              unknown3: 0,
              unknown4: 0,
              unknown5: 0,
              parts: ['@LINEUP', null, null, null, null, null, null, 'nav\\part'],
            },
          ],
          handlers: [],
        },
      }),
    },
  ],
});
const db = parsePageDatabase(built.bytes);
const ref = (label: string): number => built.refs.get(label) ?? -1;

describe('collectReachable', () => {
  const reachable = collectReachable(db);

  it('follows the startup page, links, actions, the A–Z dial, the nav panel and the index', () => {
    expect([...reachable.pages.keys()]).toEqual(
      ['title', 'article', 'popup', 'dial', 'index'].map(ref).sort((a, b) => a - b),
    );
    expect([...reachable.sharedPanels.keys()]).toEqual([ref('nav'), ref('frame')]);
    expect(reachable.pages.has(ref('orphan'))).toBe(false);
  });

  it('covers the heap apart from unreferenced pages', () => {
    const spans = [...reachable.pages.values(), ...reachable.sharedPanels.values()].map(
      (item) => [item.ref, item.ref + item.byteLength] as const,
    );
    spans.push([ref('orphan'), ref('orphan') + db.getPage(ref('orphan')).byteLength]);
    spans.sort((a, b) => a[0] - b[0]);
    let position = 0;
    for (const [start, end] of spans) {
      expect(start).toBe(position);
      position = end;
    }
    expect(position).toBe(db.heapLength);
  });

  it('lists the pages a page refers to', () => {
    expect(pagesReferencedByPage(db.getPage(ref('article')))).toEqual([
      ref('popup'),
      ref('popup'),
      ref('title'),
      ref('dial'),
      ref('title'),
    ]);
  });
});

describe('media references', () => {
  it('lists the media of a page with their kinds', () => {
    expect(mediaReferencedByPage(db.getPage(ref('article')))).toEqual([
      { kind: 'bitmap', name: 'AIRP0m' },
      { kind: 'animation', name: 'AIRP0m0a' },
    ]);
    expect(mediaReferencedByPage(db.getPage(ref('popup')))).toEqual([
      { kind: 'bitmap', name: 'AIRP0j' },
      { kind: 'wave', name: 'AIRP0j0s' },
    ]);
    expect(mediaReferencedByPage(db.getPage(ref('dial')))).toEqual([{ kind: 'animation', name: 'azaz0maa' }]);
    expect(mediaReferencedByPanel(db.getSharedPanel(ref('frame'), 'display').panel)).toEqual([
      { kind: 'bitmap', name: 'nav\\framebot' },
      { kind: 'bitmap', name: '@LINEUP' },
      { kind: 'bitmap', name: 'nav\\part' },
    ]);
  });

  it('resolves names against the page directory', () => {
    expect(resolveMedia('\\ARTICLE1\\AIRP\\', { kind: 'bitmap', name: 'AIRP0m' })).toEqual({
      kind: 'file',
      path: 'ARTICLE1/AIRP/AIRP0m.DIB',
    });
    expect(resolveMedia('\\ARTICLE1\\AIRP\\', { kind: 'animation', name: 'AIRP0m0a' })).toEqual({
      kind: 'file',
      path: 'ARTICLE1/AIRP/AIRP0m0a.ANI',
    });
    expect(resolveMedia('\\WORKSHOP', { kind: 'wave', name: 'wksp0s' })).toEqual({
      kind: 'file',
      path: 'WORKSHOP/wksp0s.WAV',
    });
    expect(resolveMedia(null, { kind: 'bitmap', name: 'loose' })).toEqual({
      kind: 'file',
      path: 'loose.DIB',
    });
  });

  it('resolves names containing a backslash against the disc root', () => {
    expect(resolveMedia('\\ARTICLE1\\AIRP\\', { kind: 'bitmap', name: 'nav\\framebot' })).toEqual({
      kind: 'file',
      path: 'nav/framebot.DIB',
    });
    expect(resolveMedia(null, { kind: 'animation', name: '\\nav\\navb0m0a' })).toEqual({
      kind: 'file',
      path: 'nav/navb0m0a.ANI',
    });
  });

  it('resolves @ names to resources in the program', () => {
    expect(resolveMedia('\\HELP\\', { kind: 'bitmap', name: '@THUMB' })).toEqual({
      kind: 'resource',
      name: 'THUMB',
    });
  });
});
