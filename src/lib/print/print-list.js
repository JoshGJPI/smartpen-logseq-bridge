/**
 * print-list — the pages a print job covers, in print order (pure).
 *
 * A page ref is `{ book, pageId }` (book key string, page id string), read from
 * disk when it prints. The list may also hold the Editor's selected strokes on a
 * page (`{ book, pageId, selection: true, key, strokes }`, from
 * print-selection.js `selectionItems()`), printed from memory, so unsaved ink
 * prints too; one page and a selection on it are separate items. The list may
 * hold pages from any notebook; it is the user's order, never re-sorted unless
 * they ask (`sortByBook`).
 *
 * Tested in `src/lib/__tests__/print-list.test.js`.
 */

import { compareBookKeys } from '../volumes.js';

/** True for a selected-strokes item (printed from memory), false for a page ref. */
export const isSelectionItem = (r) => !!(r && r.selection);

/**
 * `"388v2/151b"`, the page's identity in a list; a selection item's is
 * `"sel:<key>"`, its key naming the strokes, so the same selection is added once.
 */
export const refKey = (r) => (isSelectionItem(r) ? `sel:${r.key}` : `${r.book}/${r.pageId}`);

/** A clean ref (or selection item), or null. */
export function toRef(r) {
  if (!r || r.book == null || r.pageId == null) return null;
  const book = String(r.book);
  const pageId = String(r.pageId);
  if (!book || !pageId) return null;
  if (isSelectionItem(r)) {
    if (!r.key || !Array.isArray(r.strokes) || !r.strokes.length) return null;
    return { book, pageId, selection: true, key: String(r.key), strokes: r.strokes };
  }
  return { book, pageId };
}

/**
 * `list` with `refs` appended, skipping any page already in it (or repeated in
 * `refs`). Returns the same array when nothing was added.
 */
export function addRefs(list, refs) {
  const seen = new Set(list.map(refKey));
  const added = [];
  for (const raw of refs || []) {
    const r = toRef(raw);
    if (!r || seen.has(refKey(r))) continue;
    seen.add(refKey(r));
    added.push(r);
  }
  return added.length ? [...list, ...added] : list;
}

/** `list` without the pages in `refs`. */
export function removeRefs(list, refs) {
  const drop = new Set((refs || []).map((r) => refKey(r)));
  return list.filter((r) => !drop.has(refKey(r)));
}

/**
 * Move the item at `from` so it ends up at index `to` (in the resulting list).
 * Out-of-range indices leave the list as it was.
 */
export function moveRef(list, from, to) {
  if (!Number.isInteger(from) || !Number.isInteger(to)) return list;
  if (from < 0 || from >= list.length || from === to) return list;
  const clamped = Math.max(0, Math.min(list.length - 1, to));
  if (clamped === from) return list;
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(clamped, 0, item);
  return next;
}

/** Notebook then page ("P9" before "P10", "151" before "151b"). */
export function sortByBook(list) {
  return list.slice().sort((a, b) =>
    compareBookKeys(a.book, b.book) || a.pageId.localeCompare(b.pageId, undefined, { numeric: true }));
}
