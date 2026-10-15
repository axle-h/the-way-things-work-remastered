/**
 * Parser for the page database (`DKCODE/TWTW.PNG`), implemented from
 * docs/formats/page-database.md.
 *
 * The header, string table, product record and A–Z index are parsed eagerly. Pages and shared
 * panels live in the page heap and are parsed on demand by heap offset, then cached.
 */
import { ByteReader, FormatError } from '../reader.ts';
import { decodeWindows1252 } from '../text.ts';
import {
  ACTION_TYPE_CODES,
  OBJECT_TYPE_CODES,
  PAGE_TYPE_CODES,
  PANEL_TYPE_CODES,
  type Action,
  type ActionKind,
  type DisplayObject,
  type DisplayObjectKind,
  type Handler,
  type IndexEntry,
  type Page,
  type PageRef,
  type PageType,
  type Panel,
  type PanelRef,
  type PanelType,
  type Point,
  type Product,
  type Rect,
  type Rgb,
  type SharedPanel,
  type Template,
} from './model.ts';

/** The `pageref` value meaning "no page". */
export const NO_PAGE_REF = 0xffffffff;

const LETTER_COUNT = 26;
const NAV_BUTTON_COUNT = 9;
const SCROLL_BAR_PARTS = 8;
/** Display-object flag: the object has no rectangle. */
const FLAG_NO_RECT = 0x100;

const pageTypeByCode = invert(PAGE_TYPE_CODES);
const panelTypeByCode = invert(PANEL_TYPE_CODES);
const objectKindByCode = invert(OBJECT_TYPE_CODES);
const actionKindByCode = invert(ACTION_TYPE_CODES);

/** Parses a page database. Throws {@link FormatError} if the file is malformed. */
export function parsePageDatabase(bytes: Uint8Array, name = 'TWTW.PNG'): PageDatabase {
  return new PageDatabase(bytes, name);
}

export class PageDatabase {
  /** File offset of the page heap. */
  readonly heapOffset: number;
  /** Byte length of the string table as declared in the header. */
  readonly stringTableLength: number;
  /** The string table; `str` index `i` refers to `strings[i - 1]`. */
  readonly strings: readonly string[];
  readonly product: Product;
  /** The A–Z index, in file order. */
  readonly index: readonly IndexEntry[];

  readonly #heap: ByteReader;
  readonly #pages = new Map<PageRef, Page>();
  readonly #sharedPanels = new Map<PageRef, { type: PanelType; panel: SharedPanel }>();

  constructor(bytes: Uint8Array, name = 'TWTW.PNG') {
    const file = new ByteReader(bytes, { order: 'be', name });
    this.heapOffset = file.u32();
    this.stringTableLength = file.u32();
    const stringTableEnd = file.position + this.stringTableLength;
    if (this.heapOffset > file.length || stringTableEnd > this.heapOffset) {
      throw file.error(
        `header is inconsistent: heap at ${this.heapOffset}, string table ends at ${stringTableEnd}, ` +
          `file length ${file.length}`,
        0,
      );
    }

    this.strings = readStringTable(file.take(this.stringTableLength));
    const records = new RecordReader(file.take(this.heapOffset - stringTableEnd), this.strings);
    this.product = records.product();
    this.index = records.index();
    if (!records.reader.atEnd) {
      throw records.reader.error(`${records.reader.remaining} unexpected bytes before the page heap`);
    }
    this.#heap = file.take(file.remaining);
  }

  /** Byte length of the page heap. */
  get heapLength(): number {
    return this.#heap.length;
  }

  /** The text of a `str` index: `null` for 0. Throws if the index is out of range. */
  string(index: number): string | null {
    return resolveString(this.strings, index);
  }

  /** The template a page uses (matched by id), if any. */
  templateFor(page: Page): Template | undefined {
    return this.product.templates.find((template) => template.id === page.templateId);
  }

  /** The page at a heap offset, parsed on first use. */
  getPage(ref: PageRef): Page {
    let page = this.#pages.get(ref);
    if (page === undefined) {
      page = new RecordReader(this.#heapAt(ref, 'page'), this.strings).page(ref);
      this.#pages.set(ref, page);
    }
    return page;
  }

  /**
   * The shared panel at a heap offset, parsed on first use. Its type is not stored with it; it
   * comes from the template's {@link PanelRef.panelType}.
   */
  getSharedPanel(ref: PageRef, type: PanelType): SharedPanel {
    const cached = this.#sharedPanels.get(ref);
    if (cached !== undefined) {
      if (cached.type !== type) {
        throw new FormatError(
          `${this.#heap.name}: shared panel at heap offset ${ref} requested as ${type}, previously as ${cached.type}`,
          this.heapOffset + ref,
        );
      }
      return cached.panel;
    }
    const panel = new RecordReader(this.#heapAt(ref, 'shared panel'), this.strings).sharedPanel(ref, type);
    this.#sharedPanels.set(ref, { type, panel });
    return panel;
  }

  #heapAt(ref: PageRef, what: string): ByteReader {
    if (!Number.isInteger(ref) || ref < 0 || ref >= this.#heap.length) {
      throw new FormatError(
        `${this.#heap.name}: ${what} reference ${ref} is outside the page heap (length ${this.#heap.length})`,
        this.heapOffset,
      );
    }
    return this.#heap.slice(ref);
  }
}

function readStringTable(reader: ByteReader): string[] {
  const count = reader.u16();
  const strings: string[] = [];
  for (let i = 0; i < count; i++) {
    const length = reader.u16();
    strings.push(decodeWindows1252(reader.bytesView(length)));
  }
  if (!reader.atEnd) {
    throw reader.error(`string table has ${reader.remaining} bytes after its ${count} strings`);
  }
  return strings;
}

function resolveString(strings: readonly string[], index: number): string | null {
  if (index === 0) return null;
  const text = strings[index - 1];
  if (text === undefined || index < 0) {
    throw new RangeError(`string index ${index} is outside the string table (1–${strings.length})`);
  }
  return text;
}

/** Reads the records of the database from one big-endian reader, resolving strings as it goes. */
class RecordReader {
  readonly reader: ByteReader;
  readonly #strings: readonly string[];

  constructor(reader: ByteReader, strings: readonly string[]) {
    this.reader = reader;
    this.#strings = strings;
  }

  // ---- primitives

  str(): string | null {
    const index = this.reader.i16();
    if (index < 0 || index > this.#strings.length) {
      throw this.reader.error(
        `string index ${index} is outside the string table (1–${this.#strings.length})`,
      );
    }
    return resolveString(this.#strings, index);
  }

  pageRef(): PageRef | null {
    const value = this.reader.u32();
    return value === NO_PAGE_REF ? null : value;
  }

  rect(): Rect {
    const r = this.reader;
    return { left: r.i16(), top: r.i16(), right: r.i16(), bottom: r.i16() };
  }

  rgb(): Rgb {
    const r = this.reader;
    return { red: r.i16(), green: r.i16(), blue: r.i16() };
  }

  /** A `u16` presence flag. Only 0 and 1 are accepted, so that no information is dropped. */
  present(what: string): boolean {
    const value = this.reader.u16();
    if (value > 1) throw this.reader.error(`${what} flag is ${value}; expected 0 or 1`, this.#at(-2));
    return value === 1;
  }

  count(what: string): number {
    const value = this.reader.i16();
    if (value < 0) throw this.reader.error(`negative ${what} count ${value}`, this.#at(-2));
    return value;
  }

  repeat<T>(count: number, read: () => T): T[] {
    const items: T[] = [];
    for (let i = 0; i < count; i++) items.push(read());
    return items;
  }

  /** `i16` count, then that many items. */
  list<T>(what: string, read: () => T): T[] {
    return this.repeat(this.count(what), read);
  }

  #at(delta: number): number {
    return this.reader.origin + this.reader.position + delta;
  }

  // ---- header records

  product(): Product {
    const r = this.reader;
    const title = this.str();
    const width = r.i16();
    const height = r.i16();
    const version = this.str();
    const defaultCursor = this.str();
    const backgroundColour = this.rgb();
    const unknown1 = r.u16();
    const startupPage = this.pageRef();
    const templates = this.list('template', () => this.template());
    const handlers = this.handlers();
    return {
      title,
      width,
      height,
      version,
      defaultCursor,
      backgroundColour,
      unknown1,
      startupPage,
      templates,
      handlers,
    };
  }

  template(): Template {
    const r = this.reader;
    const pageType = this.pageType();
    const id = r.i16();
    const unknown1 = this.present('template block A') ? ([r.i16(), r.i16()] as const) : null;
    const unknown2 = r.u16();
    const width = r.i16();
    const height = r.i16();
    const position = this.present('template block B') ? this.point() : null;
    const unknown3 = r.u16();
    const unknown4 = r.i16();
    const unknown5 = r.u16();
    const unknown6 = r.u16();
    const unknownRect = this.present('template block C') ? this.rect() : null;
    const unknownList1 = this.list('template list', () => r.i16());
    const unknownList2 = this.list('template list', () => r.i16());
    const panels = this.list('panel', () => this.panelRef());
    const handlers = this.handlers();
    return {
      pageType,
      id,
      unknown1,
      unknown2,
      width,
      height,
      position,
      unknown3,
      unknown4,
      unknown5,
      unknown6,
      unknownRect,
      unknownList1,
      unknownList2,
      panels,
      handlers,
    };
  }

  panelRef(): PanelRef {
    const r = this.reader;
    const panelType = this.panelType();
    const panelId = r.i16();
    const sharedPanel = this.present('shared panel') ? r.u32() : null;
    const colour = this.rgb();
    const width = r.i16();
    const height = r.i16();
    const x = r.i16();
    const y = r.i16();
    return { panelType, panelId, sharedPanel, colour, width, height, x, y };
  }

  index(): IndexEntry[] {
    const r = this.reader;
    return this.list('index entry', () => ({
      name: this.str(),
      nameLength: r.i16(),
      unknown1: r.i16(),
      page: this.pageRef(),
      seeAlso: this.list('see-also', () => this.pageRef()),
    }));
  }

  point(): Point {
    return { x: this.reader.i16(), y: this.reader.i16() };
  }

  // ---- type codes

  pageType(): PageType {
    return this.#code('page type', pageTypeByCode);
  }

  panelType(): PanelType {
    return this.#code('panel type', panelTypeByCode);
  }

  #code<T>(what: string, table: ReadonlyMap<number, T>): T {
    const code = this.reader.i16();
    const value = table.get(code);
    if (value === undefined) throw this.reader.error(`unknown ${what} ${code}`, this.#at(-2));
    return value;
  }

  // ---- page heap

  page(ref: PageRef): Page {
    const r = this.reader;
    const pageType = this.pageType();
    const templateId = r.i16();
    const origin = this.point();
    const directory = this.str();
    const panels = this.list('panel', () => this.panel(this.panelType()));
    const handlers = this.handlers();
    const links = this.present('page links')
      ? ([this.pageRef(), this.pageRef(), this.pageRef(), this.pageRef()] as const)
      : null;
    return {
      ref,
      byteLength: r.position,
      pageType,
      templateId,
      origin,
      directory,
      panels,
      handlers,
      links,
    };
  }

  sharedPanel(ref: PageRef, type: PanelType): SharedPanel {
    const unknown1 = this.reader.i16();
    const panel = this.panel(type);
    return { ref, byteLength: this.reader.position, unknown1, panel };
  }

  panel(type: PanelType): Panel {
    const r = this.reader;
    const id = r.i16();
    const objects = this.list('object', () => this.object());
    const handlers = this.handlers();
    switch (type) {
      case 'display':
        return { kind: 'display', id, objects, handlers };
      case 'azDial':
        return {
          kind: 'azDial',
          id,
          objects,
          handlers,
          letterPages: this.repeat(LETTER_COUNT, () => this.pageRef()),
          letterAnimations: this.repeat(LETTER_COUNT, () => this.str()),
        };
      case 'navPanel':
        return {
          kind: 'navPanel',
          id,
          objects,
          handlers,
          buttonIds: this.repeat(NAV_BUTTON_COUNT, () => r.i16()),
          buttonPages: this.repeat(NAV_BUTTON_COUNT, () => this.pageRef()),
        };
    }
  }

  object(): DisplayObject {
    const kind: DisplayObjectKind = this.#code('object type', objectKindByCode);
    if (kind === 'scrollBitmap' || kind === 'scrollBar') return this.scrollObject(kind);

    const r = this.reader;
    const id = r.i16();
    const flags = r.u16();
    const rect = flags & FLAG_NO_RECT ? null : this.rect();
    const cursor = this.str();
    const handlers = this.handlers();
    const common = { id, flags, rect, cursor, handlers };
    switch (kind) {
      case 'bitmap':
        return { kind, ...common, file: this.str() };
      case 'animationControl': {
        const unknown1 = r.u16();
        const unknownRect = this.rect();
        const file = this.str();
        const unknownCursor = this.str();
        const unknown2 = r.u16();
        const unknown3 = r.u16();
        const unknown4 = r.i16();
        return { kind, ...common, unknown1, unknownRect, file, unknownCursor, unknown2, unknown3, unknown4 };
      }
      case 'hotspot':
        return { kind, ...common, unknown1: r.i16() };
      case 'azHotspot':
        return { kind, ...common, unknown1: r.i16(), unknown2: r.i16() };
      case 'wordBox':
        return { kind, ...common };
      case 'navHotspot':
      case 'animHotspot':
      case 'azAnimHotspot':
        return { kind, ...common, file: this.str(), unknown1: r.i16() };
      case 'cancelButton':
        return { kind, ...common, unknownStrings: [this.str(), this.str(), this.str()] };
    }
  }

  scrollObject(kind: 'scrollBitmap' | 'scrollBar'): DisplayObject {
    const r = this.reader;
    const common = {
      id: r.i16(),
      rect: this.rect(),
      cursor: this.str(),
      unknown1: r.u16(),
      unknown2: r.i16(),
      unknown3: r.i16(),
      unknown4: r.i16(),
      unknown5: r.i16(),
    };
    return kind === 'scrollBitmap'
      ? { kind, ...common, file: this.str() }
      : { kind, ...common, parts: this.repeat(SCROLL_BAR_PARTS, () => this.str()) };
  }

  handlers(): Handler[] {
    return this.list('handler', () => ({
      event: this.reader.u16(),
      actions: this.list('action', () => this.action()),
    }));
  }

  action(): Action {
    const r = this.reader;
    const kind: ActionKind = this.#code('action type', actionKindByCode);
    switch (kind) {
      case 'openPage':
      case 'changePage':
        return { kind, page: this.pageRef(), unknown1: r.u16() };
      case 'closePage':
        return { kind, page: this.pageRef() };
      case 'sendMessage':
        return { kind, target: r.i16(), message: r.i16() };
      case 'playWave':
        return {
          kind,
          file: this.str(),
          unknown1: r.i16(),
          unknown2: r.i16(),
          unknown3: r.i16(),
          unknown4: r.i16(),
          unknown5: r.u16(),
        };
      case 'playPics':
      case 'playPicsNoLoad':
      case 'playNonQueuedPics':
        return {
          kind,
          file: this.str(),
          unknown1: r.i16(),
          unknown2: r.i16(),
          unknown3: r.u16(),
          unknown4: r.i16(),
          unknown5: r.u16(),
        };
      case 'stopWave':
      case 'stopPics':
        return { kind, name: this.str() };
      case 'seekWave':
      case 'seekPics':
        return { kind };
      case 'productOption':
        return { kind, option: r.i16() };
    }
  }
}

function invert<K extends string>(codes: Readonly<Record<K, number>>): ReadonlyMap<number, K> {
  return new Map(Object.entries<number>(codes).map(([key, code]) => [code, key as K]));
}
