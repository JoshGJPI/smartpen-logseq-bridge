/**
 * view-history — Back / Forward between views (v3.13.0). Pure: no stores, no DOM.
 *
 * An entry is a snapshot of where the right pane is:
 *   { dest, notebook, view, selection, sequence, order }
 * (`destination`, `libraryNotebook`, `libraryView`, `viewerSelection`,
 * `readerSequence`, `readerOrder`; stores/view-history.js takes it). Two
 * entries are the same view when their `viewKey()`s match: the Editor and the
 * Timeline are one view each, the Library is its home, a notebook's grid, a
 * libraryView (tag, Untagged, suggestions, tag manager, Tasks) or an open page.
 * The reading order and sequence ride along but don't make a new view.
 *
 * Like a browser: a new view drops everything forward of the current one, and
 * the list keeps the last HISTORY_MAX entries. `replace` puts the view in place
 * of the current one (turning pages in the reader), so Back from a page goes to
 * where the reading started, not to every page turned past.
 *
 * Tested in src/lib/__tests__/view-history.test.js.
 */

export const HISTORY_MAX = 50;

/** @typedef {{ entries: object[], index: number }} ViewHistory */

/** @returns {ViewHistory} */
export function emptyHistory() {
  return { entries: [], index: -1 };
}

/**
 * The view an entry shows, as a string: equal strings are the same view.
 * @param {{dest?: string, notebook?: string|null, view?: {kind: string, tag?: string}|null, selection?: {book: string, pageId: string}|null}} e
 */
export function viewKey(e) {
  if (!e || !e.dest) return '';
  if (e.dest !== 'library') return e.dest;
  if (e.selection) return `page:${e.selection.book}/${e.selection.pageId}`;
  if (e.notebook) return `notebook:${e.notebook}`;
  if (e.view) return `view:${e.view.kind}${e.view.tag != null ? `:${e.view.tag}` : ''}`;
  return 'library';
}

/**
 * The history with `entry` as the current view. The same view as the current
 * one only refreshes it (forward kept); `replace` swaps the current one and
 * drops forward; anything else is a new entry after the current one.
 * @param {ViewHistory} h
 * @param {object} entry
 * @param {{ replace?: boolean, max?: number }} [opts]
 * @returns {ViewHistory}
 */
export function recordView(h, entry, { replace = false, max = HISTORY_MAX } = {}) {
  if (!entry || !viewKey(entry)) return h;
  const cur = h.entries[h.index];
  if (cur && viewKey(cur) === viewKey(entry)) return refreshCurrent(h, entry);
  const kept = h.entries.slice(0, cur && replace ? h.index : h.index + 1);
  const entries = [...kept, entry];
  const drop = Math.max(0, entries.length - Math.max(1, max));
  return { entries: entries.slice(drop), index: entries.length - 1 - drop };
}

/** The current entry replaced in place (nothing else changes). */
export function refreshCurrent(h, entry) {
  if (h.index < 0 || !entry) return h;
  const entries = [...h.entries];
  entries[h.index] = entry;
  return { entries, index: h.index };
}

export function canStep(h, dir) {
  const i = h.index + (dir === 'back' ? -1 : 1);
  return h.index >= 0 && i >= 0 && i < h.entries.length;
}

/** The entry one step 'back' or 'forward', or null. */
export function stepTarget(h, dir) {
  return canStep(h, dir) ? h.entries[h.index + (dir === 'back' ? -1 : 1)] : null;
}

/** The history moved one step (unchanged when it can't). */
export function stepped(h, dir) {
  return canStep(h, dir) ? { entries: h.entries, index: h.index + (dir === 'back' ? -1 : 1) } : h;
}

/** A short name for an entry, for the buttons' tooltips. */
export function viewLabel(e, bookName = (b) => `B${b}`) {
  if (!e) return '';
  if (e.dest === 'editor') return 'Editor';
  if (e.dest === 'timeline') return 'Timeline';
  if (e.selection) return `${bookName(e.selection.book)} p.${e.selection.pageId}`;
  if (e.notebook) return bookName(e.notebook);
  if (e.view) {
    if (e.view.kind === 'tag') return `Tag: ${e.view.tag}`;
    return ({ untagged: 'Untagged', suggestions: 'Suggestions', tags: 'Manage tags', tasks: 'Tasks' })[e.view.kind] || 'Library';
  }
  return 'Library';
}

/**
 * Back / Forward from the keyboard or a mouse's side buttons: Alt+← / Alt+→,
 * or mouse button 3 / 4. 'back' | 'forward' | null.
 * @param {{type?: string, key?: string, altKey?: boolean, ctrlKey?: boolean, metaKey?: boolean, shiftKey?: boolean, button?: number}} e
 */
export function historyGesture(e) {
  if (!e) return null;
  if (e.type === 'mouseup' || e.type === 'mousedown' || e.type === 'auxclick') {
    return e.button === 3 ? 'back' : e.button === 4 ? 'forward' : null;
  }
  if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return null;
  return e.key === 'ArrowLeft' ? 'back' : e.key === 'ArrowRight' ? 'forward' : null;
}
