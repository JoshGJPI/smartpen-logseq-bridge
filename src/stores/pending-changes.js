/**
 * Pending Changes Store - Tracks local changes before they are saved to disk
 * Handles stroke deletions with undo capability and per-page change tracking
 */
import { writable, derived, get } from 'svelte/store';
import { strokes } from './strokes.js';
import { storageStatus, markUnsavedChanges } from './storage.js';
import { generateStrokeId } from '../lib/stroke-storage.js';
import { BOOK_KEY_FRAGMENT, toBookKey } from '../lib/volumes.js';

// Set of deleted stroke indices (local only, not yet written to disk)
export const deletedIndices = writable(new Set());

// Undo history - array of deletion operations
// Each operation is { deletedSet: Set, timestamp: number }
const deletionHistory = writable([]);

// Maximum undo history size
const MAX_UNDO_HISTORY = 20;

/**
 * Mark strokes as deleted (soft delete - kept in store but marked)
 * @param {number[]} indices - Array of stroke indices to delete
 */
export function markStrokesDeleted(indices) {
  if (!indices || indices.length === 0) return;

  deletedIndices.update(deleted => {
    const newDeleted = new Set(deleted);
    indices.forEach(i => newDeleted.add(i));
    return newDeleted;
  });
  markUnsavedChanges();
  
  // Add to undo history
  deletionHistory.update(history => {
    const newHistory = [...history, {
      deletedSet: new Set(indices),
      timestamp: Date.now()
    }];
    
    // Limit history size
    if (newHistory.length > MAX_UNDO_HISTORY) {
      newHistory.shift();
    }
    
    return newHistory;
  });
}

/**
 * Undo the last deletion operation
 * @returns {boolean} True if undo was successful
 */
export function undoLastDeletion() {
  let success = false;
  
  deletionHistory.update(history => {
    if (history.length === 0) return history;
    
    const lastOperation = history[history.length - 1];
    
    // Remove these indices from deletedIndices
    deletedIndices.update(deleted => {
      const newDeleted = new Set(deleted);
      lastOperation.deletedSet.forEach(i => newDeleted.delete(i));
      return newDeleted;
    });
    
    success = true;
    
    // Remove from history
    return history.slice(0, -1);
  });
  
  return success;
}

/**
 * Clear all deleted indices (after successful sync or manual clear)
 */
export function clearDeletedIndices() {
  deletedIndices.set(new Set());
  deletionHistory.set([]);
}

/**
 * Re-point the deletion marks after strokes are removed from the store.
 *
 * `deletedIndices` holds positions in the strokes array, so removing strokes
 * ahead of a mark shifts it. Left unadjusted, a mark would silently come to
 * refer to a *different* stroke and the next save would delete the wrong one
 * from disk — the one failure mode this store exists to prevent.
 *
 * Marks on the removed strokes themselves are dropped: those strokes are no
 * longer on the canvas, so there is nothing left to delete. That is correct for
 * unloading a page — under append-only, off the canvas never means gone from
 * disk, and a page you unload should not be deleted by the next save.
 *
 * The undo history is cleared rather than shifted. Its entries are index sets
 * from before the removal, and "undo a deletion" is not a meaningful offer once
 * the strokes it referred to may no longer be loaded.
 *
 * @param {number[]|Set<number>} removedIndices - indices removed from `strokes`
 */
export function adjustDeletionsAfterRemoval(removedIndices) {
  const removed = removedIndices instanceof Set
    ? removedIndices
    : new Set(removedIndices || []);
  if (removed.size === 0) return;

  const sorted = [...removed].sort((a, b) => a - b);

  deletedIndices.update(marks => {
    const next = new Set();
    marks.forEach(index => {
      if (removed.has(index)) return;   // the stroke itself went
      let shift = 0;
      for (const r of sorted) {
        if (r < index) shift++;
        else break;
      }
      next.add(index - shift);
    });
    return next;
  });

  deletionHistory.set([]);
}

/**
 * Check if a stroke is marked as deleted
 * @param {number} index - Stroke index
 * @returns {boolean} True if deleted
 */
export function isStrokeDeleted(index) {
  return get(deletedIndices).has(index);
}

/**
 * Get count of deleted strokes
 */
export const deletedCount = derived(
  deletedIndices,
  $deleted => $deleted.size
);

/**
 * Check if there are any pending deletions
 */
export const hasPendingDeletions = derived(
  deletedIndices,
  $deleted => $deleted.size > 0
);

/**
 * Check if undo is available
 */
export const canUndo = derived(
  deletionHistory,
  $history => $history.length > 0
);

/* -----------------------------------------------------------------
 *  On-disk stroke-state index
 *
 *  pendingChanges needs to know which canvas strokes already exist on disk so
 *  it can tell genuine additions apart from strokes that are merely loaded. It
 *  used to read the full strokes array out of every savedPages record — exactly
 *  the residency removed in perf #3. Instead we keep a small map of on-disk
 *  stroke state, populated ONLY for pages that currently have canvas strokes and
 *  evicted when those pages leave the canvas, so the whole library never stays
 *  resident just to power the dirty indicator.
 *
 *  Each entry carries the mutable per-stroke state a save can write back to an
 *  already-stored stroke: the sketch flag, and how many points the stored stroke
 *  has. That is deliberately a scalar-sized record and NOT the stroke — `points`
 *  itself is what makes the corpus expensive to keep resident. Keep any future
 *  field here similarly small.
 *
 *  Why a point COUNT rather than nothing at all: geometry used to be immutable
 *  under the append-only rule, so there was nothing to diff. Point editing (see
 *  `removeStrokePoints` in stores/strokes.js) makes it mutable in exactly one
 *  way — points are deleted, never added or moved — so a count is sufficient to
 *  detect the edit, and comparing counts makes the diff self-clearing: the
 *  post-save `noteOnDiskStrokeIds()` refresh brings the stored count in line and
 *  the page stops reporting an edit without anyone having to reset a flag.
 * ----------------------------------------------------------------- */

/**
 * @typedef {Object} OnDiskStrokeState
 * @property {boolean} sketch - the sketch flag as it exists on disk
 * @property {number|null} points - stored point count, or null if unknown
 */

// pageKey "B{book}/P{page}" (integer page — matches canvas grouping)
//   → Map<strokeId, OnDiskStrokeState>.
export const onDiskStrokeIds = writable(new Map());

// Pages with an in-flight lazy fetch, so the same page is never read twice.
const fetchingPages = new Set();

/**
 * Point count of a stored- or canvas-format stroke, or null when neither shape
 * is present (in which case the geometry diff stays silent rather than guessing).
 */
function pointCountOf(stroke) {
  if (Array.isArray(stroke.points)) return stroke.points.length;
  if (Array.isArray(stroke.dotArray)) return stroke.dotArray.length;
  return null;
}

function strokeStateMap(strokeArray) {
  const states = new Map();
  for (const s of strokeArray || []) {
    const id = s.id || (s.startTime != null ? `s${s.startTime}` : null);
    // `sketch` is absent rather than false when off, both on disk and on the
    // canvas, so normalise here — the diff compares booleans.
    if (id) states.set(id, { sketch: !!s.sketch, points: pointCountOf(s) });
  }
  return states;
}

/**
 * Record the on-disk state of a page's strokes. Called by the import and save
 * paths (which already hold the PageDoc), so the common case is primed with no
 * extra disk read and without a flash of "everything looks like an addition".
 * @param {number} book
 * @param {number} page  integer NCode page number
 * @param {Array} strokeArray  stored- or canvas-format strokes (need id/startTime)
 */
export function noteOnDiskStrokeIds(book, page, strokeArray) {
  const key = `B${book}/P${page}`;
  const states = strokeStateMap(strokeArray);
  onDiskStrokeIds.update((m) => {
    const next = new Map(m);
    next.set(key, states);
    return next;
  });
  fetchingPages.delete(key);
}

/** Forget a page's cached on-disk state (e.g. when it leaves the canvas). */
export function forgetOnDiskStrokeIds(book, page) {
  const key = `B${book}/P${page}`;
  onDiskStrokeIds.update((m) => {
    if (!m.has(key)) return m;
    const next = new Map(m);
    next.delete(key);
    return next;
  });
}

const BACKFILL_PAGE_KEY_RE = new RegExp(`^B(${BOOK_KEY_FRAGMENT})\\/P(\\d+)$`);

// Integer page keys currently present on the canvas.
const canvasPageKeys = derived(strokes, ($strokes) => {
  const keys = new Set();
  for (const s of $strokes) {
    const pi = s.pageInfo;
    if (!pi || pi.book === undefined || pi.page === undefined) continue;
    keys.add(`B${pi.book}/P${pi.page}`);
  }
  return keys;
});

// Keep onDiskStrokeIds scoped to the pages on the canvas: evict entries for
// pages that have left, and lazily fetch IDs for canvas pages we don't have yet
// (a fallback for paths that didn't prime us — e.g. re-importing offline data
// for an already-saved page). Guarded so it's a no-op outside Electron / tests.
canvasPageKeys.subscribe(($keys) => {
  const current = get(onDiskStrokeIds);

  // Evict pages no longer on the canvas (release the state maps).
  let mutated = false;
  const next = new Map(current);
  for (const key of next.keys()) {
    if (!$keys.has(key)) {
      next.delete(key);
      fetchingPages.delete(key);
      mutated = true;
    }
  }
  if (mutated) onDiskStrokeIds.set(next);

  // Lazily backfill any canvas page we don't have state for yet.
  if (typeof window === 'undefined' || !window.storageAPI) return;
  for (const key of $keys) {
    if (next.has(key) || fetchingPages.has(key)) continue;
    // Book KEY, not digits. With `\d+` here the backfill never fired for a
    // volume page, so every one of its strokes reported as a new addition on
    // every save — silently, forever.
    const m = key.match(BACKFILL_PAGE_KEY_RE);
    if (!m) continue;
    const book = m[1];
    const page = Number(m[2]);
    fetchingPages.add(key);
    // Dynamic import keeps this store free of a static dependency on the storage
    // layer (no import cycle, no transitive load during unit tests).
    import('../lib/storage/local-store.js')
      .then(({ getPage }) => getPage(book, page))
      .then((doc) => noteOnDiskStrokeIds(book, page, (doc && doc.strokes) || []))
      .catch(() => { fetchingPages.delete(key); });
  }
});

/**
 * Pure core of the pending-changes diff. Classifies each page's active canvas
 * strokes as:
 *   - additions     — id not in the page's on-disk state map
 *   - edits         — id IS on disk, but the stroke's GEOMETRY differs: it has
 *                     fewer points than the stored copy because the user deleted
 *                     points (see `removeStrokePoints`). Its own category rather
 *                     than a modification because saving it rewrites captured
 *                     data, which every other save path is forbidden to do — it
 *                     earns a distinct warning.
 *   - modifications — id IS on disk, geometry unchanged, but a mutable annotation
 *                     differs from the stored value (currently the sketch flag).
 *                     `savePageToFolder()` syncs those onto strokes already
 *                     stored, so they are genuine unsaved changes.
 *   - deletions     — indices explicitly marked for deletion
 *
 * A stroke is never counted twice. A new stroke that is also flagged or edited is
 * an addition only, since saving it writes the whole stroke anyway; a stroke that
 * is both edited and re-flagged counts as an edit, the stronger claim, and one
 * save carries both.
 * Extracted for unit testing.
 *
 * @param {Array} strokesArr            canvas strokes (with pageInfo + startTime)
 * @param {Set<number>} deletedSet      stroke indices marked for deletion
 * @param {Map<string,Map<string,OnDiskStrokeState>>} onDiskIds  pageKey → on-disk stroke state
 * @param {Set<string>} savedPages      pageKeys saved this session
 * @returns {Map<string,{book:number,page:number,additions:number[],edits:number[],modifications:number[],deletions:number[],isSaved:boolean}>}
 */
export function computePendingChangesMap(strokesArr, deletedSet, onDiskIds, savedPages) {
  const changes = new Map();

  // Group all canvas strokes by page.
  const canvasPageGroups = new Map();
  strokesArr.forEach((stroke, index) => {
    const pageInfo = stroke.pageInfo;
    if (!pageInfo || pageInfo.book === undefined || pageInfo.page === undefined) return;

    const pageKey = `B${pageInfo.book}/P${pageInfo.page}`;
    if (!canvasPageGroups.has(pageKey)) {
      canvasPageGroups.set(pageKey, { book: pageInfo.book, page: pageInfo.page, strokes: [], indices: [] });
    }
    const group = canvasPageGroups.get(pageKey);
    group.strokes.push(stroke);
    group.indices.push(index);
  });

  // Analyze each page for changes.
  canvasPageGroups.forEach((group, pageKey) => {
    const { book, page, strokes: pageStrokes, indices } = group;

    // Separate deleted vs active strokes.
    const activeIndices = [];
    const activeStrokes = [];
    const deletedIndicesForPage = [];

    indices.forEach((index, i) => {
      if (deletedSet.has(index)) {
        deletedIndicesForPage.push(index);
      } else {
        activeIndices.push(index);
        activeStrokes.push(pageStrokes[i]);
      }
    });

    const onDisk = onDiskIds.get(pageKey);

    let additionIndices = [];
    const editIndices = [];
    const modificationIndices = [];
    if (onDisk && onDisk.size > 0) {
      // Page exists on disk — an active stroke is an addition iff its id isn't
      // there; otherwise an edit iff its geometry shrank, else a modification iff
      // a stored annotation has changed.
      activeIndices.forEach((canvasIndex, i) => {
        const stroke = activeStrokes[i];
        const stored = onDisk.get(generateStrokeId(stroke));
        if (!stored) {
          additionIndices.push(canvasIndex);
          return;
        }
        // Only a known, differing count counts: an unknown stored count (null)
        // must not read as an edit, or every stroke on a page whose state came
        // from a shape without points would light up.
        const canvasPoints = Array.isArray(stroke.dotArray) ? stroke.dotArray.length : null;
        if (stored.points != null && canvasPoints != null && canvasPoints !== stored.points) {
          editIndices.push(canvasIndex);
        } else if (!!stroke.sketch !== !!stored.sketch) {
          modificationIndices.push(canvasIndex);
        }
      });
    } else {
      // Nothing known on disk for this page → every active stroke is new. No
      // edits or modifications: there is no stored value to differ from.
      additionIndices = [...activeIndices];
    }

    if (additionIndices.length > 0 || editIndices.length > 0 ||
        modificationIndices.length > 0 || deletedIndicesForPage.length > 0) {
      changes.set(pageKey, {
        book,
        page,
        additions: additionIndices,
        edits: editIndices,
        modifications: modificationIndices,
        deletions: deletedIndicesForPage,
        moves: [],
        isSaved: savedPages.has(pageKey)
      });
    }
  });

  /* ----- Moves: work owed to the page a stroke LEFT -------------------
   * A reassigned stroke is grouped above under its NEW page, where it reads
   * as an addition. That half is right. The other half isn't visible from
   * the canvas at all: the SOURCE page still holds the stroke on disk, and
   * under append-only nothing infers that from its absence. Worse, once every
   * stroke has left, the source page has no canvas strokes and so no group —
   * it would vanish from the save dialog entirely and quietly keep its copy.
   *
   * So walk `movedFrom` and attribute each stroke back to the page it owes a
   * deletion to, creating that page's entry if the loop above didn't.
   * ------------------------------------------------------------------- */
  strokesArr.forEach((stroke, index) => {
    const from = stroke?.movedFrom;
    if (!from || from.book === undefined || from.page === undefined) return;
    if (deletedSet.has(index)) return;   // already counted as an explicit deletion

    const sourceKey = `B${from.book}/P${from.page}`;
    let entry = changes.get(sourceKey);
    if (!entry) {
      entry = {
        book: from.book,
        page: from.page,
        additions: [],
        edits: [],
        modifications: [],
        deletions: [],
        moves: [],
        isSaved: savedPages.has(sourceKey)
      };
      changes.set(sourceKey, entry);
    }
    entry.moves.push(index);
  });

  return changes;
}

/**
 * Compute pending changes per page.
 * Returns a Map of pageKey -> { additions, edits, modifications, deletions, book, page, isSaved }.
 */
export const pendingChanges = derived(
  [strokes, deletedIndices, storageStatus, onDiskStrokeIds],
  ([$strokes, $deletedIndices, $storageStatus, $onDiskStrokeIds]) =>
    computePendingChangesMap($strokes, $deletedIndices, $onDiskStrokeIds, $storageStatus.savedPages)
);

/**
 * Check if there are any pending changes
 */
export const hasPendingChanges = derived(
  pendingChanges,
  $changes => {
    for (const [_, pageChanges] of $changes) {
      if (pageChanges.additions.length > 0 ||
          pageChanges.edits.length > 0 ||
          pageChanges.modifications.length > 0 ||
          pageChanges.deletions.length > 0 ||
          (pageChanges.moves?.length || 0) > 0) {
        return true;
      }
    }
    return false;
  }
);

/**
 * Get filtered strokes for a page (excluding deleted ones)
 * Used during save to get the final stroke list
 * @param {number} book - Book ID
 * @param {number} page - Page number
 * @returns {Array} Strokes for this page (not deleted)
 */
export function getActiveStrokesForPage(book, page) {
  const $strokes = get(strokes);
  const $deletedIndices = get(deletedIndices);
  
  return $strokes
    .map((stroke, index) => ({ stroke, index }))
    .filter(({ stroke, index }) => {
      const pageInfo = stroke.pageInfo;
      return pageInfo &&
        pageInfo.book === book &&
        pageInfo.page === page &&
        !$deletedIndices.has(index);
    })
    .map(({ stroke }) => stroke);
}

/**
 * Get stroke IDs for deleted strokes on a specific page
 * Converts index-based deletedIndices to stroke ID format used in the PageDoc
 * This enables explicit deletion tracking instead of arithmetic inference
 * @param {number} book - Book ID
 * @param {number} page - Page number
 * @returns {Set<string>} Set of stroke IDs (format: "s{startTime}") marked for deletion
 */
export function getDeletedStrokeIdsForPage(book, page) {
  const $strokes = get(strokes);
  const $deletedIndices = get(deletedIndices);

  const deletedIds = new Set();

  $deletedIndices.forEach(index => {
    const stroke = $strokes[index];
    if (!stroke) return;

    const pageInfo = stroke.pageInfo;
    if (!pageInfo || pageInfo.book !== book || pageInfo.page !== page) return;

    // Generate the same ID format used in storage (s{startTime})
    deletedIds.add(generateStrokeId(stroke));
  });

  return deletedIds;
}

/**
 * Get summary of pending changes (for display)
 * @returns {Object} Summary with counts
 */
export function getPendingChangesSummary() {
  const $pendingChanges = get(pendingChanges);
  
  let totalAdditions = 0;
  let totalEdits = 0;
  let totalModifications = 0;
  let totalDeletions = 0;
  let totalMoves = 0;
  let pagesWithChanges = 0;

  for (const [_, pageChanges] of $pendingChanges) {
    const moves = pageChanges.moves?.length || 0;
    if (pageChanges.additions.length > 0 ||
        pageChanges.edits.length > 0 ||
        pageChanges.modifications.length > 0 ||
        pageChanges.deletions.length > 0 ||
        moves > 0) {
      pagesWithChanges++;
      totalAdditions += pageChanges.additions.length;
      totalEdits += pageChanges.edits.length;
      totalModifications += pageChanges.modifications.length;
      totalDeletions += pageChanges.deletions.length;
      totalMoves += moves;
    }
  }

  return {
    totalAdditions,
    totalEdits,
    totalModifications,
    totalDeletions,
    totalMoves,
    pagesWithChanges,
    changes: $pendingChanges
  };
}

/**
 * Stroke ids this page must LOSE because the user reassigned them to another
 * volume. Companion to `getDeletedStrokeIdsForPage` — the save path unions the
 * two, since "remove this id from the stored page" is the same operation either
 * way. Without it, a reassigned stroke is added to its target while the source
 * keeps its copy, leaving it in both volumes.
 *
 * @param {string|number} book source book key
 * @param {number|string} page source page
 * @returns {Set<string>}
 */
export function getMovedAwayStrokeIdsForPage(book, page) {
  const $strokes = get(strokes);
  const $deletedIndices = get(deletedIndices);
  const bookKey = toBookKey(book);
  const movedIds = new Set();

  $strokes.forEach((stroke, index) => {
    const from = stroke?.movedFrom;
    if (!from || $deletedIndices.has(index)) return;
    if (toBookKey(from.book) !== bookKey || String(from.page) !== String(page)) return;
    movedIds.add(generateStrokeId(stroke));
  });

  return movedIds;
}
