/**
 * page-reader — where you are in a notebook and how you move through it
 * (reading-first package D). Pure: no DOM, no stores.
 *
 * Pages are the metadata-only scan records of ONE book key, in the order
 * `pagesByBook` sorts them (page number, then suffix, so P151b follows P151).
 * A volume ("388v2") is its own book key with its own list, so nothing here
 * does arithmetic on a book. A spread is the open page plus the next record,
 * exactly as BookViewer pairs them: it is not aligned to odd/even pages.
 *
 * Tested in `src/lib/__tests__/page-reader.test.js`.
 */

import { isTypingTarget } from '../left-panel.js';

/** The unique-within-book page id of a scan record ("12", "151b"). */
export function pageIdOf(record) {
  if (!record) return '';
  return record.pageId != null ? String(record.pageId) : String(record.page);
}

/**
 * Where the open page sits in its book.
 *
 * @param {{book: string, pageId: string}|null} selection
 * @param {Record<string, Array<{pageId?: string, page?: number}>>} pagesByBook
 * @param {boolean} spread
 * @returns {{index: number, total: number, left: string, right: string|null, label: string}|null}
 *          null when nothing is open or the page is not in the scan;
 *          label is "P12 of 48" or "P12–P13 of 48"
 */
export function pagePosition(selection, pagesByBook, spread) {
  if (!selection) return null;
  const pages = (pagesByBook && pagesByBook[selection.book]) || [];
  const index = pages.findIndex((r) => pageIdOf(r) === String(selection.pageId));
  if (index < 0) return null;
  const left = pageIdOf(pages[index]);
  const right = spread && index + 1 < pages.length ? pageIdOf(pages[index + 1]) : null;
  const range = right ? `P${left}–P${right}` : `P${left}`;
  return { index, total: pages.length, left, right, label: `${range} of ${pages.length}` };
}

/**
 * The record index a "Go to page…" entry means, or -1.
 *
 * Accepts "151", "P151", "p 151b", "151B". An exact page id wins ("151b" opens
 * P151b, "151" opens P151 when it exists); a bare number whose page exists only
 * as suffixed variants opens the first of them, so a page is never unreachable
 * by its number.
 *
 * @param {string} input
 * @param {Array<{pageId?: string, page?: number}>} pages  one book's records, in order
 */
export function resolveGoToPage(input, pages) {
  if (typeof input !== 'string' || !Array.isArray(pages)) return -1;
  const m = input.trim().match(/^p?\s*(\d+)\s*([a-z]*)$/i);
  if (!m) return -1;
  const num = String(parseInt(m[1], 10));
  const want = `${num}${m[2].toLowerCase()}`;
  const exact = pages.findIndex((r) => pageIdOf(r).toLowerCase() === want);
  if (exact >= 0 || m[2]) return exact;
  return pages.findIndex((r) => String(parseInt(pageIdOf(r), 10)) === num);
}

/**
 * The index a page turn lands on, or -1 when there is nowhere to go. A spread
 * moves two records, a single page one; going back from the second record
 * lands on the first rather than refusing.
 *
 * @param {number} index  the open (left) page's index
 * @param {number} total  records in the book
 * @param {'prev'|'next'} dir
 * @param {boolean} spread
 */
export function turnTarget(index, total, dir, spread) {
  if (!(index >= 0) || !(total > 0) || index >= total) return -1;
  const step = spread ? 2 : 1;
  if (dir === 'prev') return index > 0 ? Math.max(0, index - step) : -1;
  if (dir === 'next') return index + step < total ? index + step : -1;
  return -1;
}

/**
 * Is this keydown a page turn? ← / → only, never while typing (the transcript
 * editor's inputs, Go to page, search), never with a modifier (Alt+← is history
 * in some shells, Shift+← extends a selection), never mid-IME, never when
 * something else handled it, and never while a transcript is being edited.
 *
 * @param {KeyboardEvent} e
 * @param {{editing?: boolean}} [state]
 * @returns {'prev'|'next'|null}
 */
export function pageTurnKey(e, { editing = false } = {}) {
  if (!e || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return null;
  if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return null;
  if (e.isComposing || e.defaultPrevented || editing) return null;
  if (isTypingTarget(e.target)) return null;
  return e.key === 'ArrowLeft' ? 'prev' : 'next';
}

/**
 * The shared toolbar's zoom readout for the pages showing ink: "62%", or
 * "62% · 58%" when the two were fitted to different sizes (each page fits its
 * own ink or paper, so a spread's zooms can differ). '' when no ink is shown.
 *
 * @param {number|null} a  left page's zoom factor, null when it shows no ink
 * @param {number|null} b  right page's
 */
export function zoomText(a, b) {
  const ps = [a, b].filter((z) => Number.isFinite(z) && z > 0).map((z) => Math.round(z * 100));
  if (!ps.length) return '';
  return ps.length === 2 && ps[0] !== ps[1] ? `${ps[0]}% · ${ps[1]}%` : `${ps[0]}%`;
}
