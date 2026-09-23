/**
 * Load Date Range — put a span of days' ink on the canvas.
 *
 * The date view's whole reason for existing: date does not line up with pages.
 * Across the reference corpus 154 of 289 pages hold ink from more than one day,
 * and 74% of day/page pairs sit on such a page — so filtering whole pages by
 * date would drag in mostly-unrelated writing. Filtering is therefore at STROKE
 * level, on `startTime`.
 *
 * Each touched page is split in two:
 *   - strokes inside the range → the `strokes` store, as ordinary canvas
 *     strokes: selectable, savable, transcribable.
 *   - everything else on that page → `contextInk`, drawn halftoned and owned by
 *     nothing (see stores/context-ink.js). This is what makes a partial page
 *     readable: the day's writing sits where it actually is on the page rather
 *     than floating with no surroundings.
 *
 * Loading a partial page is safe to save from. Saves are append-only and keyed
 * by `s{startTime}`: deletions are explicit, and the one geometry-rewrite path
 * is gated on the `pointsEdited` marker. Strokes absent from the canvas are
 * never inferred to be deleted — which is exactly the property this relies on.
 * `noteOnDiskStrokeIds` is still primed from the page's FULL stored stroke list,
 * so the pending-changes diff compares against what is really on disk and the
 * strokes that stayed behind are not reported as anything.
 */

import { get } from 'svelte/store';
import { strokes, log, noteOnDiskStrokeIds } from '$stores';
import { registerBookIds } from '$stores/book-aliases.js';
import { addContextInk, pruneContextInk } from '$stores/context-ink.js';
import { pagesInRange, rangeBoundsMs } from '$lib/timeline.js';
import { getPage, getTimelineIndex } from './local-store.js';
import { canvasPageInfoFor, storedStrokesToCanvas, mergeCanvasStrokes } from './load-page.js';

/**
 * Load every stroke captured between two local calendar days, inclusive.
 *
 * Merges into whatever is already on the canvas rather than replacing it — the
 * same rule as "Import Strokes", so a load can never discard unsaved work. Use
 * Clear first to start from empty.
 *
 * @param {Object} params
 * @param {string} params.from  day key "YYYY-MM-DD"
 * @param {string} params.to    day key "YYYY-MM-DD", inclusive
 * @param {Object} [params.index] a timeline index already in hand; fetched if absent
 * @param {Function} [params.onProgress] (message, current, total) => void
 * @returns {Promise<{success: boolean, pages?: number, imported?: number,
 *                    context?: number, duplicatesSkipped?: number, error?: string}>}
 */
export async function importDateRangeFromFolder({ from, to, index = null, onProgress = null } = {}) {
  try {
    const bounds = rangeBoundsMs(from, to);
    if (!bounds) throw new Error(`Invalid date range: ${from} → ${to}`);

    const idx = index || await getTimelineIndex();
    const targets = pagesInRange(idx, from, to);

    if (targets.length === 0) {
      log(`No ink captured between ${from} and ${to}`, 'warning');
      return { success: true, pages: 0, imported: 0, context: 0, duplicatesSkipped: 0 };
    }

    const incoming = [];
    const context = [];
    let pagesRead = 0;

    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      if (onProgress) onProgress(`Loading B${t.book}/P${t.pageId}…`, i + 1, targets.length);

      const doc = await getPage(t.book, t.pageId);
      if (!doc) {
        // The index named a page that is no longer there — a stale cache entry,
        // not an error worth failing the whole load over.
        console.warn(`[load-range] B${t.book}/P${t.pageId} named by the index but not on disk`);
        continue;
      }
      pagesRead++;

      const stored = Array.isArray(doc.strokes) ? doc.strokes : [];

      // Prime from the FULL list — this is the on-disk truth, and a partial load
      // must not make the strokes it left behind look like anything pending.
      // Book comes from the index entry (a book KEY), never doc.pageInfo.book,
      // which is numeric and would file a volume page under volume 1.
      noteOnDiskStrokeIds(t.book, doc.pageInfo?.page ?? t.page, stored);

      const inRange = [];
      const outside = [];
      for (const s of stored) {
        const st = Number(s.startTime);
        if (Number.isFinite(st) && st >= bounds.startMs && st < bounds.endMs) inRange.push(s);
        else outside.push(s);
      }

      // One shared pageInfo for BOTH halves of the page — they are the same page
      // and the renderer groups by its contents.
      const pageInfo = canvasPageInfoFor(doc, t.book);
      if (inRange.length > 0) {
        incoming.push(...storedStrokesToCanvas(inRange, pageInfo));
      }
      if (outside.length > 0) {
        context.push(...storedStrokesToCanvas(outside, pageInfo, { contextInk: true }));
      }
    }

    if (incoming.length === 0) {
      log(`No strokes loaded for ${from} → ${to}`, 'warning');
      return { success: true, pages: pagesRead, imported: 0, context: 0, duplicatesSkipped: 0 };
    }

    const bookIds = [...new Set(incoming.map(s => s.pageInfo?.book).filter(Boolean))];
    if (bookIds.length > 0) registerBookIds(bookIds);

    const merged = mergeCanvasStrokes(get(strokes), incoming);
    strokes.set(merged.strokes);

    // After the strokes store is updated, so a stroke that just became live is
    // not also added as a ghost of itself.
    const contextAdded = addContextInk(context);
    pruneContextInk();

    const span = from === to ? from : `${from} → ${to}`;
    const tail = merged.duplicatesSkipped > 0
      ? ` (${merged.duplicatesSkipped} already loaded)`
      : '';
    log(
      `Loaded ${merged.imported} stroke(s) from ${span} across ${pagesRead} page(s)`
      + (contextAdded > 0 ? `, plus ${contextAdded} shown as context` : '')
      + tail,
      'success'
    );

    return {
      success: true,
      pages: pagesRead,
      imported: merged.imported,
      context: contextAdded,
      duplicatesSkipped: merged.duplicatesSkipped
    };
  } catch (err) {
    console.error('Failed to load date range:', err);
    log(`Date range load failed: ${err.message}`, 'error');
    return { success: false, error: err.message };
  }
}
