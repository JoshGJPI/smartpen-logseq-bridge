/**
 * canvas-save-plan — the pure parts of the Editor's Save and Transcribe
 * (stores/canvas-save.js, stores/canvas-transcribe.js): which pages a save
 * writes, which deletion marks it settled, the log line per page, and how the
 * canvas is grouped for MyScript. No stores, no IO.
 *
 * Page keys here are the save dialog's `${book}-${page}` (SaveConfirmDialog).
 */

import { plural } from './plural.js';

/** The save dialog's key for a page. */
export const savePageKey = (book, page) => `${book}-${page}`;

/**
 * The pages a save writes, from the canvas strokes and the pages ticked in the
 * save dialog.
 *
 * A reassigned stroke (`movedFrom`) is grouped under its NEW page, where it
 * saves as an addition. The page it LEFT still holds it on disk and owes a
 * deletion, but may have no canvas strokes any more, so it is added here
 * whatever the selection: saving only the target would leave the stroke in
 * both volumes. `moveSources` records, per source page, where its strokes went
 * (the post-save move cleanup needs it after the markers are cleared).
 *
 * @param {Array} strokes  canvas strokes
 * @param {Iterable<string>} selectedKeys  `${book}-${page}` keys ticked in the dialog
 * @returns {{
 *   pagesToSave: Map<string, {book: string|number, page: number}>,
 *   moveSources: Map<string, {book: string|number, page: number, targets: Map<string, {book, page}>}>
 * }}
 */
export function groupPagesToSave(strokes, selectedKeys) {
  const selected = new Set(selectedKeys || []);
  const pagesToSave = new Map();
  const moveSources = new Map();

  for (const stroke of strokes || []) {
    const pi = stroke?.pageInfo;
    if (!pi || pi.book === undefined || pi.page === undefined) continue;
    const key = savePageKey(pi.book, pi.page);
    if (selected.has(key) && !pagesToSave.has(key)) {
      pagesToSave.set(key, { book: pi.book, page: pi.page });
    }
  }

  for (const stroke of strokes || []) {
    const from = stroke?.movedFrom;
    if (!from || from.book === undefined || from.page === undefined) continue;
    const key = savePageKey(from.book, from.page);
    if (!moveSources.has(key)) {
      moveSources.set(key, { book: from.book, page: from.page, targets: new Map() });
    }
    const pi = stroke.pageInfo;
    if (pi) {
      moveSources.get(key).targets.set(savePageKey(pi.book, pi.page), { book: pi.book, page: pi.page });
    }
    if (!pagesToSave.has(key)) pagesToSave.set(key, { book: from.book, page: from.page });
  }

  return { pagesToSave, moveSources };
}

/**
 * The deletion marks a save settled: indices (descending) of marked strokes
 * whose page was written. A mark on a page that was not selected, or whose
 * write failed, is still owed to disk and must stay marked (and on the canvas).
 *
 * @param {Array} strokes  canvas strokes
 * @param {Set<number>} deletedIndices  positions marked for deletion
 * @param {Set<string>} savedKeys  `${book}-${page}` of pages written successfully
 * @returns {number[]}
 */
export function settledDeletionIndices(strokes, deletedIndices, savedKeys) {
  const out = [];
  for (const index of deletedIndices || []) {
    const pi = strokes?.[index]?.pageInfo;
    if (!pi) continue;
    if (savedKeys.has(savePageKey(pi.book, pi.page))) out.push(index);
  }
  return out.sort((a, b) => b - a);
}

/**
 * The success log line for one saved page.
 *
 * A retime is counted by the save as one addition plus one deletion, so those
 * are taken back out of the added / deleted counts.
 *
 * @param {string} label  e.g. "B388/P12"
 * @param {{added?: number, deleted?: number, edited?: number, linesAdded?: number,
 *          transcriptChanged?: boolean, total?: number}} result  savePageToFolder's result
 * @param {{retimed?: number, movedAway?: number}} [counts]
 * @returns {string}
 */
export function describePageSave(label, result, { retimed = 0, movedAway = 0 } = {}) {
  const parts = [];
  const added = Math.max(0, (result.added || 0) - retimed);
  const deleted = Math.max(0, (result.deleted || 0) - retimed);
  if (added > 0) parts.push(`+${added} new`);
  if (retimed > 0) parts.push(`${retimed} retimed`);
  if (result.edited > 0) parts.push(`${result.edited} edited (points rewritten)`);
  if (movedAway > 0) parts.push(`→${movedAway} moved to another volume`);
  if (deleted > 0) parts.push(`-${deleted} deleted`);
  if (result.linesAdded > 0) parts.push(`+${result.linesAdded} transcript ${plural(result.linesAdded, 'line')}`);
  else if (result.transcriptChanged) parts.push('transcript updated');
  const changes = parts.length > 0 ? parts.join(', ') + ', ' : '';
  const total = result.total || 0;
  return `Saved ${label}: ${changes}${total} ${plural(total, 'stroke')} total`;
}

/**
 * The canvas grouped by page for MyScript. Every stroke counts toward the
 * page; only strokes not yet linked to a line (no `blockUuid`) are sent.
 * The key is the transcription store's `S{section}/O{owner}/B{book}/P{page}`.
 *
 * @param {Array} strokes  the strokes to transcribe (selection or all)
 * @returns {Map<string, {allStrokes: Array, untranscribedStrokes: Array,
 *   pageInfo: {section, owner, book, page}}>}
 */
export function groupStrokesForTranscription(strokes) {
  const byPage = new Map();
  for (const stroke of strokes || []) {
    const pi = stroke.pageInfo || {};
    const pageInfo = {
      section: pi.section || 0,
      owner: pi.owner || 0,
      book: pi.book || 0,
      page: pi.page || 0
    };
    const key = transcriptionPageKey(pageInfo);
    if (!byPage.has(key)) byPage.set(key, { allStrokes: [], untranscribedStrokes: [], pageInfo });
    const entry = byPage.get(key);
    entry.allStrokes.push(stroke);
    if (!stroke.blockUuid) entry.untranscribedStrokes.push(stroke);
  }
  return byPage;
}

/** The transcription store's page key. */
export function transcriptionPageKey(pageInfo) {
  const pi = pageInfo || {};
  return `S${pi.section || 0}/O${pi.owner || 0}/B${pi.book || 0}/P${pi.page || 0}`;
}

/**
 * How many of the pages `strokes` touch are only partly loaded (a date-range
 * load leaves the rest as context ink), so a transcription covers part of them.
 *
 * @param {Array} strokes
 * @param {Set<string>} contextInkPageKeys  `B{book}/P{page}` keys with context ink
 * @returns {number}
 */
export function countPartlyLoadedPages(strokes, contextInkPageKeys) {
  if (!contextInkPageKeys || contextInkPageKeys.size === 0) return 0;
  const partial = new Set();
  for (const stroke of strokes || []) {
    const pi = stroke.pageInfo || {};
    const key = `B${pi.book}/P${pi.page}`;
    if (contextInkPageKeys.has(key)) partial.add(key);
  }
  return partial.size;
}
