// A small synthetic page database for the unit tests, shaped like the disc's (no disc bytes): a
// title chain, the Workshop, an A–Z machine with its "A" page, an article with links and a popup,
// and a shared navigation bar with some of its buttons.
import {
  HandlerEvent,
  parsePageDatabase,
  type DisplayObject,
  type Handler,
  type Panel,
  type Rgb,
  type Template,
} from '@twtw/formats';
import { buildPageDatabase, type PageContent, type RefOf } from '@twtw/formats/testing';

const black: Rgb = { red: 0, green: 0, blue: 0 };

const slot = (
  panelType: 'display' | 'azDial' | 'navPanel',
  panelId: number,
  x: number,
  y: number,
  shared: number | null = null,
) => ({
  panelType,
  panelId,
  sharedPanel: shared,
  colour: black,
  width: 0,
  height: 0,
  x,
  y,
});

const template = (pageType: Template['pageType'], id: number, panels: Template['panels']): Template => ({
  pageType,
  id,
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
  panels,
  handlers: [],
});

const rect = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom });

const onClick = (actions: Handler['actions']): Handler[] => [{ event: HandlerEvent.Click, actions }];

const hotspot = (bounds: ReturnType<typeof rect>, handlers: Handler[]): DisplayObject => ({
  kind: 'hotspot',
  id: 2,
  flags: 4,
  rect: bounds,
  cursor: 'Hand',
  handlers,
  unknown1: 0,
});

const navButton = (id: number, bounds: ReturnType<typeof rect>): DisplayObject => ({
  kind: 'navHotspot',
  id,
  flags: 0,
  rect: bounds,
  cursor: 'Hand',
  handlers: [],
  file: 'nav\\a',
  unknown1: 1,
});

const display = (objects: DisplayObject[], id = 1): Panel => ({ kind: 'display', id, objects, handlers: [] });

const page = (directory: string, panels: Panel[], templateId = 7): PageContent => ({
  pageType: 'base',
  templateId,
  origin: { x: 0, y: 0 },
  directory,
  panels,
  handlers: [],
  links: null,
});

const bitmap = (file: string): DisplayObject => ({
  kind: 'bitmap',
  id: 2,
  flags: 0,
  rect: rect(0, 0, 540, 450),
  cursor: null,
  handlers: [],
  file,
});

export const built = buildPageDatabase({
  product: (ref: RefOf) => ({
    title: 'Test',
    width: 640,
    height: 480,
    version: null,
    defaultCursor: 'Arrow',
    backgroundColour: black,
    unknown1: 0,
    startupPage: ref('title'),
    templates: [
      template('base', 7, [slot('navPanel', 849, 0, 0, ref('nav')), slot('display', 1, 94, 4)]),
      template('base', 77, [slot('navPanel', 849, 0, 0, ref('nav')), slot('azDial', 78, 94, 4)]),
      template('popup', 0, [slot('display', 1, 0, 0)]),
    ],
    handlers: [],
  }),
  heap: [
    {
      label: 'nav',
      sharedPanel: (ref) => ({
        unknown1: 0,
        panel: {
          kind: 'navPanel',
          id: 849,
          objects: [
            {
              kind: 'bitmap',
              id: 2,
              flags: 0,
              rect: rect(0, 0, 94, 460),
              cursor: null,
              handlers: [],
              file: 'nav\\nav',
            },
            navButton(850, rect(4, 3, 89, 75)),
            navButton(851, rect(4, 77, 90, 146)),
            navButton(852, rect(5, 149, 90, 231)),
            navButton(855, rect(5, 376, 90, 395)),
            navButton(857, rect(5, 417, 90, 435)),
          ],
          handlers: [],
          // As on the disc: Workshop, Principles, A–Z machine, Inventors, Timeline, two Options
          // popups, Index and Help; buttons 7 and 8 are ids 858 and 857.
          buttonIds: [850, 851, 852, 853, 854, 855, 856, 858, 857],
          buttonPages: [
            ref('workshop'),
            ref('popup'),
            ref('azmachine'),
            null,
            null,
            ref('popup'),
            null,
            null,
            null,
          ],
        },
      }),
    },
    {
      label: 'title',
      page: (ref) =>
        page('\\TITLE\\', [
          display([
            bitmap('TITL0m'),
            {
              kind: 'animHotspot',
              id: 2,
              flags: 32,
              rect: rect(0, 0, 0, 0),
              cursor: null,
              handlers: [
                {
                  event: HandlerEvent.Finished,
                  actions: [{ kind: 'changePage', page: ref('still'), unknown1: 0 }],
                },
              ],
              file: 'TITL0m0a',
              unknown1: 1,
            },
          ]),
        ]),
    },
    {
      label: 'still',
      page: (ref) =>
        page('\\TITLE\\', [
          display([
            hotspot(
              rect(0, 0, 638, 459),
              onClick([{ kind: 'changePage', page: ref('workshop'), unknown1: 0 }]),
            ),
          ]),
        ]),
    },
    {
      label: 'workshop',
      page: (ref) =>
        page('\\WORKSHOP\\', [
          display([
            bitmap('WWWW0M'),
            hotspot(
              rect(100, 100, 140, 140),
              onClick([{ kind: 'changePage', page: ref('airplane'), unknown1: 0 }]),
            ),
          ]),
        ]),
    },
    {
      label: 'azmachine',
      page: (ref) =>
        page(
          '\\AZAZ\\',
          [
            {
              kind: 'azDial',
              id: 78,
              objects: [bitmap('AZAZ0M')],
              handlers: [],
              letterPages: [ref('aza'), ...Array<null>(25).fill(null)],
              letterAnimations: Array<null>(26).fill(null),
            },
          ],
          77,
        ),
    },
    { label: 'aza', page: () => page('\\AZAZ\\', [display([bitmap('Az000m')])]) },
    {
      label: 'airplane',
      page: (ref) => ({
        ...page('\\ARTICLE1\\AIRP\\', [
          display([
            bitmap('AIRP0M'),
            hotspot(rect(10, 10, 50, 30), onClick([{ kind: 'openPage', page: ref('popup'), unknown1: 0 }])),
            hotspot(
              rect(25, 5, 60, 40),
              onClick([
                {
                  kind: 'playPics',
                  file: 'AIRP0m0a',
                  unknown1: -1,
                  unknown2: -1,
                  unknown3: 1,
                  unknown4: 1,
                  unknown5: 0,
                },
              ]),
            ),
            hotspot(
              rect(200, 200, 220, 220),
              onClick([{ kind: 'openPage', page: ref('popup'), unknown1: 0 }]),
            ),
            hotspot(
              rect(300, 300, 320, 320),
              onClick([{ kind: 'changePage', page: ref('workshop'), unknown1: 0 }]),
            ),
          ]),
        ]),
        // Principles, Machines, Inventors, History (page-database.md, Page).
        links: [ref('popup'), ref('aza'), ref('workshop'), ref('workshop')],
      }),
    },
    {
      label: 'popup',
      page: (ref) => ({
        ...page(
          '\\ARTICLE1\\AIRP\\',
          [
            display([
              bitmap('AIRP0j'),
              hotspot(
                rect(5, 5, 25, 15),
                onClick([{ kind: 'changePage', page: ref('workshop'), unknown1: 0 }]),
              ),
            ]),
          ],
          0,
        ),
        pageType: 'popup',
        origin: { x: 100, y: 50 },
      }),
    },
  ],
});

export const db = parsePageDatabase(built.bytes);

export function ref(label: string): number {
  const value = built.refs.get(label);
  if (value === undefined) throw new Error(`no heap entry ${label}`);
  return value;
}
