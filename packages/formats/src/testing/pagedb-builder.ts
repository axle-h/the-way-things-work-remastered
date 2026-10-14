/**
 * Builds synthetic page databases from the typed model, for tests (the repository holds no disc
 * bytes). It writes the layout in docs/formats/page-database.md: the inverse of the parser.
 *
 * Heap entries are named by label; their heap offsets are worked out by the builder, and every
 * `build` callback receives a `ref(label)` function to refer to them (forward references are fine).
 */
import { ByteWriter } from '../writer.ts';
import { encodeWindows1252 } from '../text.ts';
import {
  ACTION_TYPE_CODES,
  OBJECT_TYPE_CODES,
  PAGE_TYPE_CODES,
  PANEL_TYPE_CODES,
  type Action,
  type DisplayObject,
  type Handler,
  type IndexEntry,
  type Page,
  type PageRef,
  type Panel,
  type PanelRef,
  type Product,
  type Rect,
  type Rgb,
  type SharedPanel,
  type Template,
} from '../pagedb/model.ts';
import { NO_PAGE_REF } from '../pagedb/parse.ts';

export type RefOf = (label: string) => PageRef;

/** A page as written: the model without the fields the parser derives from its position. */
export type PageContent = Omit<Page, 'ref' | 'byteLength'>;
export type SharedPanelContent = Omit<SharedPanel, 'ref' | 'byteLength'>;

export type HeapEntrySpec =
  | { readonly label: string; readonly page: (ref: RefOf) => PageContent }
  | { readonly label: string; readonly sharedPanel: (ref: RefOf) => SharedPanelContent };

export interface PageDatabaseSpec {
  readonly product: (ref: RefOf) => Product;
  readonly index?: (ref: RefOf) => readonly IndexEntry[];
  /** Pages and shared panels, laid out in this order. */
  readonly heap: readonly HeapEntrySpec[];
  /** Strings to place first in the string table, before those the records use. */
  readonly strings?: readonly string[];
}

export interface BuiltPageDatabase {
  readonly bytes: Uint8Array;
  /** Heap offset of each labelled entry. */
  readonly refs: ReadonlyMap<string, PageRef>;
  /** Heap byte length of each labelled entry. */
  readonly lengths: ReadonlyMap<string, number>;
  readonly strings: readonly string[];
}

export function buildPageDatabase(spec: PageDatabaseSpec): BuiltPageDatabase {
  // Pass 1 measures each heap entry with placeholder refs (refs are fixed-size), pass 2 writes it.
  const placeholder: RefOf = () => 0;
  const lengths = new Map<string, number>();
  const refs = new Map<string, PageRef>();
  let offset = 0;
  for (const entry of spec.heap) {
    if (refs.has(entry.label)) throw new Error(`duplicate heap label ${entry.label}`);
    const length = encodeHeapEntry(new StringPool(), entry, placeholder).length;
    refs.set(entry.label, offset);
    lengths.set(entry.label, length);
    offset += length;
  }
  const refOf: RefOf = (label) => {
    const ref = refs.get(label);
    if (ref === undefined) throw new Error(`unknown heap label ${label}`);
    return ref;
  };

  const pool = new StringPool(spec.strings);
  const records = new Encoder(pool);
  records.product(spec.product(refOf));
  const index = spec.index?.(refOf) ?? [];
  records.list(index, (entry) => records.indexEntry(entry));
  const heap = new ByteWriter('be');
  for (const entry of spec.heap) heap.bytes(encodeHeapEntry(pool, entry, refOf));

  const table = new ByteWriter('be').u16(pool.strings.length);
  for (const text of pool.strings) {
    const bytes = encodeWindows1252(text);
    table.u16(bytes.length).bytes(bytes);
  }
  const heapOffset = 8 + table.length + records.writer.length;
  const file = new ByteWriter('be')
    .u32(heapOffset)
    .u32(table.length)
    .bytes(table.toBytes())
    .bytes(records.writer.toBytes())
    .bytes(heap.toBytes());
  return { bytes: file.toBytes(), refs, lengths, strings: pool.strings };
}

function encodeHeapEntry(pool: StringPool, entry: HeapEntrySpec, ref: RefOf): Uint8Array {
  const encoder = new Encoder(pool);
  if ('page' in entry) encoder.page(entry.page(ref));
  else encoder.sharedPanel(entry.sharedPanel(ref));
  return encoder.writer.toBytes();
}

class StringPool {
  readonly strings: string[] = [];
  readonly #indices = new Map<string, number>();

  constructor(initial: readonly string[] = []) {
    for (const text of initial) this.index(text);
  }

  /** The 1-based index of a string, adding it if new; 0 for `null`. */
  index(text: string | null): number {
    if (text === null) return 0;
    let index = this.#indices.get(text);
    if (index === undefined) {
      this.strings.push(text);
      index = this.strings.length;
      this.#indices.set(text, index);
    }
    return index;
  }
}

/** Writes model records in the file's big-endian layout. */
class Encoder {
  readonly pool: StringPool;
  readonly writer = new ByteWriter('be');

  constructor(pool: StringPool) {
    this.pool = pool;
  }

  str(text: string | null): void {
    this.writer.i16(this.pool.index(text));
  }

  pageRef(ref: PageRef | null): void {
    this.writer.u32(ref ?? NO_PAGE_REF);
  }

  rect(rect: Rect): void {
    this.writer.i16(rect.left).i16(rect.top).i16(rect.right).i16(rect.bottom);
  }

  rgb(colour: Rgb): void {
    this.writer.i16(colour.red).i16(colour.green).i16(colour.blue);
  }

  list<T>(items: readonly T[], write: (item: T) => void): void {
    this.writer.i16(items.length);
    for (const item of items) write(item);
  }

  /** A `u16` presence flag, then the block if present. */
  optional<T>(value: T | null, write: (value: T) => void): void {
    this.writer.u16(value === null ? 0 : 1);
    if (value !== null) write(value);
  }

  product(product: Product): void {
    const w = this.writer;
    this.str(product.title);
    w.i16(product.width).i16(product.height);
    this.str(product.version);
    this.str(product.defaultCursor);
    this.rgb(product.backgroundColour);
    w.u16(product.unknown1);
    this.pageRef(product.startupPage);
    this.list(product.templates, (template) => this.template(template));
    this.handlers(product.handlers);
  }

  template(template: Template): void {
    const w = this.writer;
    w.i16(PAGE_TYPE_CODES[template.pageType]).i16(template.id);
    this.optional(template.unknown1, ([a, b]) => w.i16(a).i16(b));
    w.u16(template.unknown2).i16(template.width).i16(template.height);
    this.optional(template.position, ({ x, y }) => w.i16(x).i16(y));
    w.u16(template.unknown3).i16(template.unknown4).u16(template.unknown5).u16(template.unknown6);
    this.optional(template.unknownRect, (rect) => this.rect(rect));
    this.list(template.unknownList1, (value) => w.i16(value));
    this.list(template.unknownList2, (value) => w.i16(value));
    this.list(template.panels, (slot) => this.panelRef(slot));
    this.handlers(template.handlers);
  }

  panelRef(slot: PanelRef): void {
    const w = this.writer;
    w.i16(PANEL_TYPE_CODES[slot.panelType]).i16(slot.panelId);
    this.optional(slot.sharedPanel, (ref) => w.u32(ref));
    this.rgb(slot.colour);
    w.i16(slot.width).i16(slot.height).i16(slot.x).i16(slot.y);
  }

  indexEntry(entry: IndexEntry): void {
    this.str(entry.name);
    this.writer.i16(entry.nameLength).i16(entry.unknown1);
    this.pageRef(entry.page);
    this.list(entry.seeAlso, (ref) => this.pageRef(ref));
  }

  page(page: PageContent): void {
    const w = this.writer;
    w.i16(PAGE_TYPE_CODES[page.pageType]).i16(page.templateId).i16(page.origin.x).i16(page.origin.y);
    this.str(page.directory);
    this.list(page.panels, (panel) => {
      w.i16(PANEL_TYPE_CODES[panel.kind]);
      this.panel(panel);
    });
    this.handlers(page.handlers);
    this.optional(page.links, (links) => links.forEach((ref) => this.pageRef(ref)));
  }

  sharedPanel(shared: SharedPanelContent): void {
    this.writer.i16(shared.unknown1);
    this.panel(shared.panel);
  }

  panel(panel: Panel): void {
    const w = this.writer;
    w.i16(panel.id);
    this.list(panel.objects, (object) => this.object(object));
    this.handlers(panel.handlers);
    if (panel.kind === 'azDial') {
      expectLength(panel.letterPages, 26, 'letterPages');
      expectLength(panel.letterAnimations, 26, 'letterAnimations');
      panel.letterPages.forEach((ref) => this.pageRef(ref));
      panel.letterAnimations.forEach((name) => this.str(name));
    } else if (panel.kind === 'navPanel') {
      expectLength(panel.buttonIds, 9, 'buttonIds');
      expectLength(panel.buttonPages, 9, 'buttonPages');
      panel.buttonIds.forEach((id) => w.i16(id));
      panel.buttonPages.forEach((ref) => this.pageRef(ref));
    }
  }

  object(object: DisplayObject): void {
    const w = this.writer;
    w.i16(OBJECT_TYPE_CODES[object.kind]);
    if (object.kind === 'scrollBitmap' || object.kind === 'scrollBar') {
      w.i16(object.id);
      this.rect(object.rect);
      this.str(object.cursor);
      w.u16(object.unknown1)
        .i16(object.unknown2)
        .i16(object.unknown3)
        .i16(object.unknown4)
        .i16(object.unknown5);
      if (object.kind === 'scrollBitmap') {
        this.str(object.file);
      } else {
        expectLength(object.parts, 8, 'parts');
        object.parts.forEach((name) => this.str(name));
      }
      return;
    }

    w.i16(object.id).u16(object.flags);
    if ((object.flags & 0x100) === 0) {
      if (object.rect === null) throw new Error('an object without flag 0x100 needs a rect');
      this.rect(object.rect);
    }
    this.str(object.cursor);
    this.handlers(object.handlers);
    switch (object.kind) {
      case 'bitmap':
        this.str(object.file);
        break;
      case 'animationControl':
        w.u16(object.unknown1);
        this.rect(object.unknownRect);
        this.str(object.file);
        this.str(object.unknownCursor);
        w.u16(object.unknown2).u16(object.unknown3).i16(object.unknown4);
        break;
      case 'hotspot':
        w.i16(object.unknown1);
        break;
      case 'azHotspot':
        w.i16(object.unknown1).i16(object.unknown2);
        break;
      case 'wordBox':
        break;
      case 'navHotspot':
      case 'animHotspot':
      case 'azAnimHotspot':
        this.str(object.file);
        w.i16(object.unknown1);
        break;
      case 'cancelButton':
        object.unknownStrings.forEach((text) => this.str(text));
        break;
    }
  }

  handlers(handlers: readonly Handler[]): void {
    this.list(handlers, (handler) => {
      this.writer.u16(handler.event);
      this.list(handler.actions, (action) => this.action(action));
    });
  }

  action(action: Action): void {
    const w = this.writer;
    w.i16(ACTION_TYPE_CODES[action.kind]);
    switch (action.kind) {
      case 'openPage':
      case 'changePage':
        this.pageRef(action.page);
        w.u16(action.unknown1);
        break;
      case 'closePage':
        this.pageRef(action.page);
        break;
      case 'sendMessage':
        w.i16(action.message).i16(action.parameter);
        break;
      case 'playWave':
        this.str(action.file);
        w.i16(action.unknown1).i16(action.unknown2).i16(action.unknown3).i16(action.unknown4);
        w.u16(action.unknown5);
        break;
      case 'playPics':
      case 'playPicsNoLoad':
      case 'playNonQueuedPics':
        this.str(action.file);
        w.i16(action.unknown1).i16(action.unknown2).u16(action.unknown3).i16(action.unknown4);
        w.u16(action.unknown5);
        break;
      case 'stopWave':
      case 'stopPics':
        this.str(action.name);
        break;
      case 'seekWave':
      case 'seekPics':
        break;
      case 'productOption':
        w.i16(action.option);
        break;
    }
  }
}

function expectLength(values: readonly unknown[], length: number, what: string): void {
  if (values.length !== length) throw new Error(`${what} must have ${length} entries, not ${values.length}`);
}
