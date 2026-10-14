// The startup-page patch (docs/reference-environments.md, "Starting at any base page"): a copy of
// the page database whose product record names another page as its startup page.
import { parsePageDatabase, type PageRef } from '@twtw/formats';

/** Bytes of the product record before its startup `pageref`: title, width, height, version,
 * default cursor (5 × 2 bytes), background colour (3 × 2) and one unknown `u16`. */
const PRODUCT_BYTES_BEFORE_STARTUP = 18;

/**
 * File offset of the product record's startup `pageref`: 8 + string-table length + 18, where the
 * string-table length is the big-endian `u32` at offset 4 (docs/formats/page-database.md).
 */
export function startupPageOffset(bytes: Uint8Array): number {
  if (bytes.length < 8) throw new Error('page database is too short for its header');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offset = 8 + view.getUint32(4) + PRODUCT_BYTES_BEFORE_STARTUP;
  if (offset + 4 > bytes.length) throw new Error(`startup page offset ${offset} is past the end of the file`);
  return offset;
}

/**
 * Returns a copy of the database with `target` as its startup page. Checks with our parser that
 * the patched field really is the product's startup page and that `target` is a base page (a popup
 * as the startup page gives an empty client area).
 */
export function patchStartupPage(bytes: Uint8Array, target: PageRef): Uint8Array {
  const db = parsePageDatabase(bytes);
  const offset = startupPageOffset(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const stored = view.getUint32(offset);
  if (stored !== (db.product.startupPage ?? 0xffffffff)) {
    throw new Error(
      `startup page field at ${offset} holds ${stored}, the parser says ${db.product.startupPage}`,
    );
  }
  const page = db.getPage(target);
  if (page.pageType !== 'base') {
    throw new Error(`page ${target} is a ${page.pageType} page; only base pages work as the startup page`);
  }
  const patched = bytes.slice();
  new DataView(patched.buffer).setUint32(offset, target);
  return patched;
}
