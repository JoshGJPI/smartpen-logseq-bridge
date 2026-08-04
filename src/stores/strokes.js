/**
 * Strokes Store - Manages stroke data from the pen
 * Svelte 4 writable and derived stores
 */
import { writable, derived, get } from 'svelte/store';
import { registerBookId, registerBookIds } from './book-aliases.js';
import { markUnsavedChanges } from './storage.js';
import { removePointsFromStroke } from '../lib/point-edit.js';

// Raw stroke data
export const strokes = writable([]);

// Batch mode flag - when true, canvas updates are paused
export const batchMode = writable(false);

// Pages derived from strokes - groups strokes by page key
export const pages = derived(strokes, $strokes => {
  const pageMap = new Map();
  $strokes.forEach(stroke => {
    const pageInfo = stroke.pageInfo || {};
    const key = `S${pageInfo.section || 0}/O${pageInfo.owner || 0}/B${pageInfo.book || 0}/P${pageInfo.page || 0}`;
    if (!pageMap.has(key)) {
      pageMap.set(key, []);
    }
    pageMap.get(key).push(stroke);
  });
  return pageMap;
});

// Stroke count
export const strokeCount = derived(strokes, $strokes => $strokes.length);

// Set of "B{book}/P{page}" keys that currently have strokes on the canvas.
// The Saved Pages list reads this to show its "In canvas" badge. It used to be
// written imperatively onto the page record when strokes were imported, which
// left the badge latched on after the canvas was cleared; derived from the
// strokes themselves it can never disagree with what's actually loaded.
export const canvasPageKeys = derived(pages, $pages => {
  const keys = new Set();
  for (const key of $pages.keys()) {
    const match = key.match(/B(\d+)\/P(\d+)/);
    if (match) keys.add(`B${match[1]}/P${match[2]}`);
  }
  return keys;
});

// Current page info (for tracking which page is being written to)
export const currentPageInfo = writable(null);

// How many loaded strokes are flagged as sketches. Drives the "Unmark" button's
// enabled state and the header count.
export const sketchStrokeCount = derived(strokes, $strokes =>
  $strokes.reduce((n, s) => n + (s.sketch ? 1 : 0), 0)
);

/**
 * Add a new stroke to the store
 * @param {Object} stroke - Stroke object with pageInfo, dotArray, etc.
 */
export function addStroke(stroke) {
  // Register the book ID if present
  if (stroke.pageInfo?.book) {
    registerBookId(stroke.pageInfo.book);
  }
  strokes.update(s => [...s, stroke]);
  markUnsavedChanges();
}

/**
 * Update the last stroke (for adding dots during pen move)
 * @param {Function} updater - Function that receives and returns the stroke
 */
export function updateLastStroke(updater) {
  strokes.update(s => {
    if (s.length === 0) return s;
    const newStrokes = [...s];
    newStrokes[newStrokes.length - 1] = updater(newStrokes[newStrokes.length - 1]);
    return newStrokes;
  });
}

/**
 * Add offline strokes (batch)
 * @param {Array} offlineStrokes - Array of stroke objects
 */
export function addOfflineStrokes(offlineStrokes) {
  // Register all unique book IDs
  const bookIds = [...new Set(offlineStrokes
    .map(s => s.pageInfo?.book)
    .filter(Boolean))];
  if (bookIds.length > 0) {
    registerBookIds(bookIds);
  }
  strokes.update(s => [...s, ...offlineStrokes]);
  if (offlineStrokes.length > 0) markUnsavedChanges();
}

/**
 * Start batch mode - pauses canvas updates during bulk imports
 */
export function startBatchMode() {
  batchMode.set(true);
}

/**
 * End batch mode - triggers canvas update after bulk import completes
 */
export function endBatchMode() {
  batchMode.set(false);
}

/**
 * Clear all strokes
 */
export function clearStrokes() {
  strokes.set([]);
  currentPageInfo.set(null);
}

/**
 * Remove strokes by indices
 * @param {number[]} indices - Array of stroke indices to remove
 */
export function removeStrokesByIndices(indices) {
  if (!indices || indices.length === 0) return;

  strokes.update(s => {
    // Create a Set for O(1) lookup
    const indicesToRemove = new Set(indices);
    // Filter out the strokes at those indices
    return s.filter((stroke, index) => !indicesToRemove.has(index));
  });
  markUnsavedChanges();
}

/**
 * Flag or unflag strokes as sketches.
 *
 * Sketch strokes render with a thickness that follows the pen force recorded at
 * each point (see `$lib/sketch-width.js`); everything else renders as a uniform
 * line. The flag is an annotation on top of captured geometry, so it is set from
 * the current selection long after the strokes were drawn.
 *
 * Marks the session dirty: the flag lives in the PageDoc, so it is lost unless
 * the page is saved. Toggling it on a stroke already stored on disk is reported
 * by `pendingChanges` as a *modification* (see `computePendingChangesMap`), so it
 * surfaces in the canvas page label and the save dialog as well as the header's
 * unsaved dot.
 *
 * @param {number[]|Set<number>} indices - stroke indices in the strokes store
 * @param {boolean} [sketch] - true to mark, false to unmark
 * @returns {number} how many strokes actually changed
 */
export function setStrokesSketch(indices, sketch = true) {
  const target = indices instanceof Set ? indices : new Set(indices || []);
  if (target.size === 0) return 0;

  let changed = 0;
  strokes.update(all =>
    all.map((stroke, index) => {
      if (!target.has(index)) return stroke;
      if (!!stroke.sketch === !!sketch) return stroke;
      changed++;
      const next = { ...stroke, sketch: !!sketch };
      // Drop the renderer's cached width array — it was computed for the other
      // mode and is keyed only by the sketch profile, not by this flag.
      delete next._sw;
      return next;
    })
  );

  if (changed > 0) markUnsavedChanges();
  return changed;
}

/**
 * Mark strokes as sketches. @see setStrokesSketch
 * @param {number[]|Set<number>} indices
 * @returns {number} how many changed
 */
export function markStrokesAsSketch(indices) {
  return setStrokesSketch(indices, true);
}

/**
 * Unmark strokes, returning them to uniform-width handwriting rendering.
 * @param {number[]|Set<number>} indices
 * @returns {number} how many changed
 */
export function unmarkStrokesAsSketch(indices) {
  return setStrokesSketch(indices, false);
}

/**
 * Delete individual captured points from strokes.
 *
 * The pen sometimes emits a dot at the Ncode origin partway through an otherwise
 * sound stroke, which draws a line out to the page corner and back. This removes
 * those points while leaving the rest of the stroke intact.
 *
 * THIS IS THE ONLY THING IN THE APP THAT MUTATES CAPTURED GEOMETRY. Every other
 * write is append-only, and `savePageToFolder()` refuses to rewrite a stored
 * stroke's `points` unless the stroke carries the `pointsEdited` marker set here
 * — so a truncated dotArray arriving from any other code path can never
 * overwrite what's on disk.
 *
 * Preserved deliberately:
 *   - `startTime` / `endTime`, and therefore the stroke's `s{startTime}` id, even
 *     when the first or last point goes. The id is what stroke dedupe, transcript
 *     `lineId` links and the LogSeq asset merge all key on; re-deriving it would
 *     orphan the stroke from its transcript line and re-import it as a duplicate.
 *   - each surviving dot's `f` (pen force) and the `sketch` flag, so a sketch
 *     stroke keeps its pressure-varying thickness across the edit. The cached
 *     width array is dropped (in `removePointsFromStroke`) so it recomputes for
 *     the shorter point series.
 *
 * @param {Map<number, Set<number>|number[]>} edits - strokeIndex → point indices
 * @returns {{editedIds: string[], removedPoints: number, editedStrokes: number,
 *            refused: Array<{strokeIndex:number, remaining:number}>}}
 *   `refused` lists strokes where the removal would have left fewer than two
 *   points (nothing to draw). Those are left untouched — the caller should offer
 *   whole-stroke deletion instead of silently leaving an invisible stroke.
 */
export function removeStrokePoints(edits) {
  if (!edits || edits.size === 0) {
    return { editedIds: [], removedPoints: 0, editedStrokes: 0, refused: [] };
  }

  const editedIds = [];
  const refused = [];
  let removedPoints = 0;

  strokes.update(all =>
    all.map((stroke, index) => {
      const drop = edits.get(index);
      if (!drop) return stroke;

      const result = removePointsFromStroke(stroke, drop);
      if (result.removed === 0) return stroke;
      if (!result.stroke) {
        refused.push({ strokeIndex: index, remaining: result.remaining });
        return stroke;
      }

      removedPoints += result.removed;
      editedIds.push(`s${stroke.startTime}`);
      // In-memory only: `strokeToStored()` builds stored strokes from a fixed key
      // list, so this marker cannot leak into the PageDoc.
      return { ...result.stroke, pointsEdited: true };
    })
  );

  if (removedPoints > 0) markUnsavedChanges();
  return { editedIds, removedPoints, editedStrokes: editedIds.length, refused };
}

/**
 * Drop the `pointsEdited` intent markers for a page after its save succeeded.
 *
 * The dirty-state diff doesn't depend on this — it compares the canvas point
 * count against the stored one, which the post-save index refresh brings back
 * into line by itself. This just keeps the store honest: the marker means "these
 * points still need writing", and once they're written it would be a lie, leaving
 * a later unrelated save of the same page to rewrite geometry it has no reason to
 * touch.
 *
 * @param {number} book
 * @param {number} page
 * @returns {number} how many strokes were cleared
 */
export function clearPointEditMarkers(book, page) {
  let cleared = 0;

  // Cheap pre-check so this can be called after every page save without cost.
  // Writing the store unconditionally would republish the whole strokes array —
  // and with it a pendingChanges recompute and a canvas repaint — once per saved
  // page, for the overwhelmingly common case of no point edits at all.
  const onPage = (s) => s.pointsEdited && s.pageInfo &&
    s.pageInfo.book === book && s.pageInfo.page === page;
  if (!get(strokes).some(onPage)) return 0;

  strokes.update(all =>
    all.map(stroke => {
      if (!stroke.pointsEdited) return stroke;
      const pi = stroke.pageInfo;
      if (!pi || pi.book !== book || pi.page !== page) return stroke;
      cleared++;
      const next = { ...stroke };
      delete next.pointsEdited;
      return next;
    })
  );

  return cleared;
}

/**
 * Load strokes from storage format into the store
 * Used when loading a saved page - restores lineId associations
 * @param {Array} storedStrokes - Strokes from storage (with blockUuid)
 * @param {Object} pageInfo - Page info to attach
 */
export function loadStrokesFromStorage(storedStrokes, pageInfo) {
  if (!storedStrokes || storedStrokes.length === 0) return;
  
  // Register book ID
  if (pageInfo?.book) {
    registerBookId(pageInfo.book);
  }
  
  // Convert from storage format (restores blockUuid, sketch flag, pressure)
  const fullStrokes = storedStrokes.map(stored => ({
    pageInfo: pageInfo,
    startTime: stored.startTime,
    endTime: stored.endTime,
    blockUuid: stored.blockUuid || null,
    sketch: !!stored.sketch,
    dotArray: stored.points.map(([x, y, timestamp, f]) => ({
      x,
      y,
      // Captured force when the tuple carries it; else the historical constant,
      // which downstream reads as "no real pressure data".
      f: typeof f === 'number' ? f : 512,
      timestamp
    }))
  }));
  
  // Add to store (avoiding duplicates by startTime)
  strokes.update(existing => {
    const existingIds = new Set(existing.map(s => s.startTime));
    const newStrokes = fullStrokes.filter(s => !existingIds.has(s.startTime));
    return [...existing, ...newStrokes];
  });
}

/**
 * Update blockUuid for specific strokes
 * @param {Map<string, string>} strokeToBlockMap - Map of stroke startTime -> blockUuid
 */
export function updateStrokeBlockUuids(strokeToBlockMap) {
  console.log(`[updateStrokeBlockUuids] Updating strokes with ${strokeToBlockMap.size} mappings`);

  let updatedCount = 0;
  let skippedCount = 0;

  strokes.update(allStrokes => {
    const result = allStrokes.map(stroke => {
      const blockUuid = strokeToBlockMap.get(String(stroke.startTime));
      if (blockUuid !== undefined) {
        updatedCount++;
        if (updatedCount <= 3) {
          console.log(`  ✓ Updated stroke ${stroke.startTime}: blockUuid = ${blockUuid.substring(0, 8)}...`);
        }
        return { ...stroke, blockUuid };
      }
      skippedCount++;
      return stroke;
    });

    console.log(`[updateStrokeBlockUuids] Complete: ${updatedCount} updated, ${skippedCount} skipped`);
    return result;
  });
}

/**
 * Get strokes that haven't been transcribed yet (no blockUuid)
 * @param {Array} strokeList - Array of strokes to filter
 * @returns {Array} Strokes without blockUuid
 */
export function getUntranscribedStrokes(strokeList) {
  return strokeList.filter(stroke => !stroke.blockUuid);
}

/**
 * Get strokes assigned to a specific block
 * @param {string} blockUuid - Block UUID to search for
 * @returns {Array} Strokes belonging to this block
 */
export function getStrokesForBlock(blockUuid) {
  let result = [];
  const unsubscribe = strokes.subscribe(allStrokes => {
    result = allStrokes.filter(s => s.blockUuid === blockUuid);
  });
  unsubscribe();
  return result;
}

/**
 * Reassign strokes from one block to another (for merges)
 * @param {string} fromBlockUuid - Source block UUID
 * @param {string} toBlockUuid - Target block UUID
 * @returns {number} Count of strokes reassigned
 */
export function reassignStrokes(fromBlockUuid, toBlockUuid) {
  let count = 0;
  strokes.update(allStrokes => {
    return allStrokes.map(stroke => {
      if (stroke.blockUuid === fromBlockUuid) {
        count++;
        return { ...stroke, blockUuid: toBlockUuid };
      }
      return stroke;
    });
  });
  return count;
}

/**
 * Clear blockUuid from strokes (for re-transcription)
 * @param {Array<number>} strokeTimestamps - Stroke startTimes to clear
 */
export function clearStrokeBlockUuids(strokeTimestamps) {
  const timestampSet = new Set(strokeTimestamps.map(Number));
  strokes.update(allStrokes => {
    return allStrokes.map(stroke => {
      if (timestampSet.has(stroke.startTime)) {
        return { ...stroke, blockUuid: null };
      }
      return stroke;
    });
  });
}

/**
 * Get current strokes array (for saving)
 * @returns {Array} Current strokes
 */
export function getStrokesSnapshot() {
  let snapshot = [];
  const unsubscribe = strokes.subscribe(s => snapshot = s);
  unsubscribe();
  return snapshot;
}

/**
 * Get strokes in a Y-coordinate range (for split operations)
 * @param {Array} strokeList - Strokes to search
 * @param {Object} yRange - { minY, maxY }
 * @param {number} tolerance - Y-tolerance (default 5)
 * @returns {Array} Strokes within Y range
 */
export function getStrokesInYRange(strokeList, yRange, tolerance = 5) {
  if (!yRange || typeof yRange.minY !== 'number' || typeof yRange.maxY !== 'number') {
    return [];
  }

  return strokeList.filter(stroke => {
    if (!stroke.dotArray || stroke.dotArray.length === 0) return false;

    // Check if any dot falls within the Y range
    return stroke.dotArray.some(dot =>
      dot.y >= (yRange.minY - tolerance) && dot.y <= (yRange.maxY + tolerance)
    );
  });
}

/**
 * Partition strokes by transcription status
 * Returns strokes grouped by whether they have a blockUuid assigned
 * @param {Array} strokeList - Strokes to partition
 * @returns {Object} { transcribed: Array, untranscribed: Array }
 */
export function partitionStrokesByTranscriptionStatus(strokeList) {
  const transcribed = [];
  const untranscribed = [];

  for (const stroke of strokeList) {
    if (stroke.blockUuid) {
      transcribed.push(stroke);
    } else {
      untranscribed.push(stroke);
    }
  }

  return { transcribed, untranscribed };
}

/**
 * Get strokes for a specific page that haven't been transcribed
 * Filters by book/page and excludes strokes with blockUuid
 * @param {number} book - Book ID
 * @param {number} page - Page number
 * @returns {Array} Untranscribed strokes for the page
 */
export function getUntranscribedStrokesForPage(book, page) {
  let result = [];
  const unsubscribe = strokes.subscribe(allStrokes => {
    result = allStrokes.filter(s =>
      s.pageInfo?.book === book &&
      s.pageInfo?.page === page &&
      !s.blockUuid &&
      !s.deleted
    );
  });
  unsubscribe();
  return result;
}

/**
 * Get all strokes for a page (both transcribed and untranscribed)
 * Excludes deleted strokes
 * @param {number} book - Book ID
 * @param {number} page - Page number
 * @returns {Array} All active strokes for the page
 */
export function getActiveStrokesForPageFromStore(book, page) {
  let result = [];
  const unsubscribe = strokes.subscribe(allStrokes => {
    result = allStrokes.filter(s =>
      s.pageInfo?.book === book &&
      s.pageInfo?.page === page &&
      !s.deleted
    );
  });
  unsubscribe();
  return result;
}
