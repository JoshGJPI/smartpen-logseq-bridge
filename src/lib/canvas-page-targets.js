/**
 * canvas-page-targets — which pages an Editor toolbar control acts on
 * (v3.19.0). Pure, so the rule is tested without the canvas.
 *
 * Page ids here are `"<bookKey>/<page>"` (`"388v2/42"`), the form tagKey() and
 * the orientation key use. The canvas holds integer NCode pages only.
 *
 * - Rotate acts on ONE page: the selection's page when every selected stroke is
 *   on one page, else the only page shown (`singlePageTarget`).
 * - Tags act on a LIST: the selection's pages when strokes are selected, else
 *   every page shown, in book then page order (`tagTargetPages`).
 */
import { BOOK_KEY_FRAGMENT, compareBookKeys } from './volumes.js';

const CANVAS_PAGE_KEY_RE = new RegExp(`^S\\d+\\/O\\d+\\/B(${BOOK_KEY_FRAGMENT})\\/P(\\d+)$`);

/** Most pages the Editor's Tags popover lists at once. */
export const MAX_TAG_TARGETS = 6;

/**
 * `"S3/O1012/B388v2/P42"` → `"388v2/42"`, or null for anything else.
 * @param {string} key
 */
export function pageIdFromCanvasKey(key) {
  const m = typeof key === 'string' ? key.match(CANVAS_PAGE_KEY_RE) : null;
  return m ? `${m[1]}/${m[2]}` : null;
}

/**
 * Distinct pages of the selected strokes, in first-seen order.
 * @param {Array<{pageInfo?: {book?: string, page?: number}}>} strokes
 * @param {Iterable<number>} selectedIndices  positions into `strokes`
 * @returns {string[]}
 */
export function selectionPageIds(strokes, selectedIndices) {
  const out = new Set();
  for (const i of selectedIndices || []) {
    const pi = strokes?.[i]?.pageInfo;
    if (pi && pi.book !== undefined && pi.book !== null && pi.page !== undefined && pi.page !== null) {
      out.add(`${pi.book}/${pi.page}`);
    }
  }
  return [...out];
}

/**
 * Pages shown on the canvas: the page selector's ticked keys that are still loaded.
 * @param {Iterable<string>} selectedPageKeys  canvas page keys ticked in the page selector
 * @param {{has: (k: string) => boolean}} loadedPages  the `pages` store's Map
 * @returns {string[]}
 */
export function shownPageIds(selectedPageKeys, loadedPages) {
  const out = [];
  for (const k of selectedPageKeys || []) {
    if (loadedPages && !loadedPages.has(k)) continue;
    const id = pageIdFromCanvasKey(k);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * The one page a single-page control (rotate) acts on, or null.
 * @param {string[]} selectionIds
 * @param {string[]} shownIds
 * @param {boolean} hasSelection
 */
export function singlePageTarget(selectionIds, shownIds, hasSelection) {
  if (hasSelection) return selectionIds.length === 1 ? selectionIds[0] : null;
  return shownIds.length === 1 ? shownIds[0] : null;
}

/** Book then page order (`"388/9"` before `"388/10"` before `"388v2/1"`). */
export function comparePageIds(a, b) {
  const [ab, ap] = splitPageId(a);
  const [bb, bp] = splitPageId(b);
  return compareBookKeys(ab, bb) || (Number(ap) - Number(bp));
}

/**
 * The pages the Tags popover lists: the selection's pages when strokes are
 * selected, else every page shown; sorted, capped at `max`.
 * @returns {{ pages: Array<{book: string, pageId: string}>, more: number, fromSelection: boolean }}
 */
export function tagTargetPages(selectionIds, shownIds, hasSelection, max = MAX_TAG_TARGETS) {
  const fromSelection = !!hasSelection && selectionIds.length > 0;
  const all = [...new Set(fromSelection ? selectionIds : shownIds)].sort(comparePageIds);
  const cap = Math.max(0, max);
  return {
    pages: all.slice(0, cap).map((id) => {
      const [book, pageId] = splitPageId(id);
      return { book, pageId };
    }),
    more: Math.max(0, all.length - cap),
    fromSelection
  };
}

/**
 * The text a page's tag suggestions are read from: its saved transcript (the
 * scan record's `transcriptionText`, so no page read) plus any MyScript result
 * not saved yet. Lines that the pending run repeats are harmless: suggestions
 * are deduped by tag.
 * @param {{book: string, pageId: string}} page
 * @param {Array<{book: string, page?: number, pageId?: string|number, transcriptionText?: string|null}>} records
 * @param {Array<{text?: string}>|null} pendingLines
 * @returns {Array<{id: null|string, text: string}>}
 */
export function suggestionLinesFor(page, records, pendingLines = null) {
  const out = [];
  const rec = (records || []).find((r) => {
    const id = r.pageId != null ? String(r.pageId) : String(r.page);
    return String(r.book) === String(page.book) && id === String(page.pageId);
  });
  if (rec && typeof rec.transcriptionText === 'string') {
    for (const text of rec.transcriptionText.split('\n')) out.push({ id: null, text: text.trim() });
  }
  for (const l of pendingLines || []) {
    if (l && typeof l.text === 'string') out.push({ id: l.id ?? null, text: l.text });
  }
  return out;
}

function splitPageId(id) {
  const s = String(id);
  const i = s.lastIndexOf('/');
  return i < 0 ? [s, ''] : [s.slice(0, i), s.slice(i + 1)];
}
