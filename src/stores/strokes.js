/**
 * Strokes Store - Manages stroke data from the pen
 * Svelte 4 writable and derived stores
 */
import { writable, derived, get } from 'svelte/store';
import { registerBookId, registerBookIds } from './book-aliases.js';
import { markUnsavedChanges } from './storage.js';
import { removePointsFromStroke } from '../lib/point-edit.js';
import {
  BOOK_KEY_FRAGMENT, toBookKey, withVolume, parseBookKey
} from '../lib/volumes.js';
import { applyActiveVolume } from './volumes.js';

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
// The book portion is a BOOK KEY ("388", "388v2"), not bare digits — a `\d+`
// here silently dropped every volume page from the set, so "Import Strokes"
// never greyed out and pending-changes never backfilled them.
const PAGE_KEY_RE = new RegExp(`B(${BOOK_KEY_FRAGMENT})\\/P(\\d+)`);

export const canvasPageKeys = derived(pages, $pages => {
  const keys = new Set();
  for (const key of $pages.keys()) {
    const match = key.match(PAGE_KEY_RE);
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
  // Resolve the active volume here — the boundary between what the pen reported
  // and what the app stores. Upstream in pen-sdk.js `pageInfo.book` is still the
  // raw NCode id and must stay that way for transfer matching.
  const resolved = stroke?.pageInfo
    ? { ...stroke, pageInfo: applyActiveVolume(stroke.pageInfo) }
    : stroke;

  if (resolved.pageInfo?.book) {
    registerBookId(resolved.pageInfo.book);
  }
  strokes.update(s => [...s, resolved]);
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
  // Offline strokes share one pageInfo object per book+page (pen-sdk assigns it
  // by reference), so cache the resolution rather than re-deriving it per stroke.
  const resolvedByPageInfo = new Map();
  const resolved = (offlineStrokes || []).map(s => {
    if (!s?.pageInfo) return s;
    let pi = resolvedByPageInfo.get(s.pageInfo);
    if (pi === undefined) {
      pi = applyActiveVolume(s.pageInfo);
      resolvedByPageInfo.set(s.pageInfo, pi);
    }
    return pi === s.pageInfo ? s : { ...s, pageInfo: pi };
  });

  const bookIds = [...new Set(resolved
    .map(s => s.pageInfo?.book)
    .filter(Boolean))];
  if (bookIds.length > 0) {
    registerBookIds(bookIds);
  }
  strokes.update(s => [...s, ...resolved]);
  if (resolved.length > 0) markUnsavedChanges();
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
 * Which loaded strokes belong to a page.
 *
 * @param {string|number} book - book KEY ("388" or "388v2")
 * @param {string|number} page - NCode page number
 * @returns {number[]} indices into the strokes store, ascending
 */
export function strokeIndicesForPage(book, page) {
  const bookKey = String(book);
  const pageNum = Number(page);
  const out = [];
  get(strokes).forEach((stroke, index) => {
    const pi = stroke?.pageInfo;
    if (!pi) return;
    if (String(pi.book) === bookKey && Number(pi.page) === pageNum) out.push(index);
  });
  return out;
}

/**
 * Take a page off the canvas without touching what is stored for it.
 *
 * Distinct from deleting strokes, and deliberately does NOT call
 * `markUnsavedChanges()`: unloading is the inverse of importing, not an edit.
 * Under append-only, missing from the canvas never means deleted on disk, so a
 * page removed here is untouched in its PageDoc and can simply be imported
 * again.
 *
 * Callers must re-point every index-keyed store afterwards — see
 * `unloadPageFromCanvas()` in `stores/canvas.js`, which is the entry point that
 * does. Calling this directly leaves the selection and deletion marks pointing
 * at the wrong strokes.
 *
 * @param {string|number} book - book KEY
 * @param {string|number} page - NCode page number
 * @returns {number[]} the indices that were removed
 */
export function removeStrokesForPage(book, page) {
  const indices = strokeIndicesForPage(book, page);
  if (indices.length === 0) return [];

  const remove = new Set(indices);
  strokes.update(s => s.filter((_, index) => !remove.has(index)));
  return indices;
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
  // Compare via toBookKey so a caller passing the number 388 still matches a
  // stroke carrying the key "388" — the two spellings are one book.
  const bookKey = toBookKey(book);
  const onPage = (s) => s.pointsEdited && s.pageInfo &&
    toBookKey(s.pageInfo.book) === bookKey && s.pageInfo.page === page;
  if (!get(strokes).some(onPage)) return 0;

  strokes.update(all =>
    all.map(stroke => {
      if (!onPage(stroke)) return stroke;
      cleared++;
      const next = { ...stroke };
      delete next.pointsEdited;
      return next;
    })
  );

  return cleared;
}

/**
 * Move strokes to a different volume of the same NCode book.
 *
 * Rewrites `pageInfo.book` to the target book key. Everything else survives:
 * startTime/endTime (so the `s{startTime}` id stays stable — the source page's
 * deletion finds the stroke by that id), points, force, and the sketch flag.
 *
 * Two things are deliberate:
 *
 * **`blockUuid` is cleared.** It points at a transcript line on the SOURCE page.
 * Carrying it over would either orphan the reference or bind the stroke to an
 * unrelated line on the target.
 *
 * **`movedFrom` is stamped on.** Under append-only, missing-from-canvas never
 * means deleted-on-disk — so without this the stroke would be *added* to the
 * target while the source keeps its copy, leaving it in both volumes. The marker
 * is what `getMovedAwayStrokeIdsForPage()` reads to turn the copy into a move.
 * In-memory only: `strokeToStored()` builds from a fixed key list, so it can
 * never reach the PageDoc.
 *
 * @param {number[]|Set<number>} indices stroke indices in the strokes store
 * @param {number} targetVolume
 * @returns {{moved: number, skipped: number, targets: string[]}}
 */
export function reassignVolume(indices, targetVolume) {
  const target = indices instanceof Set ? indices : new Set(indices || []);
  if (target.size === 0) return { moved: 0, skipped: 0, targets: [] };

  const volume = Number(targetVolume);
  if (!Number.isInteger(volume) || volume < 1) {
    return { moved: 0, skipped: target.size, targets: [] };
  }

  let moved = 0;
  let skipped = 0;
  const targets = new Set();

  strokes.update(all =>
    all.map((stroke, index) => {
      if (!target.has(index)) return stroke;

      const pi = stroke.pageInfo;
      const currentKey = toBookKey(pi?.book);
      if (!currentKey) { skipped++; return stroke; }

      const nextKey = withVolume(currentKey, volume);
      if (!nextKey) { skipped++; return stroke; }
      if (nextKey === currentKey) return stroke;   // already there — not a move

      const parsed = parseBookKey(nextKey);
      moved++;
      targets.add(nextKey);

      const next = {
        ...stroke,
        pageInfo: {
          ...pi,
          book: nextKey,
          ncodeBook: parsed.ncodeBook,
          volume: parsed.volume
        },
        blockUuid: null
      };
      // Keep the FIRST origin if a stroke is moved twice before saving, so the
      // deletion still names the page that actually holds it on disk.
      if (!next.movedFrom) {
        next.movedFrom = { book: currentKey, page: pi.page };
      }
      return next;
    })
  );

  if (moved > 0) markUnsavedChanges();
  return { moved, skipped, targets: [...targets] };
}

/**
 * Drop the `movedFrom` markers for strokes whose source page has been saved.
 *
 * Mirrors `clearPointEditMarkers`: once the source page's save has removed the
 * stroke from disk, the marker means "still needs deleting somewhere", which
 * would be a lie — and would make a later unrelated save of that page delete a
 * stroke id that is no longer there.
 *
 * @param {string|number} book source book key
 * @param {number|string} page source page
 * @returns {number} how many markers were cleared
 */
export function clearMovedFromMarkers(book, page) {
  const bookKey = toBookKey(book);
  const onPage = (s) => s.movedFrom &&
    toBookKey(s.movedFrom.book) === bookKey && String(s.movedFrom.page) === String(page);

  // Same cheap pre-check as clearPointEditMarkers: writing the store
  // unconditionally would republish the strokes array once per saved page.
  if (!get(strokes).some(onPage)) return 0;

  let cleared = 0;
  strokes.update(all =>
    all.map(stroke => {
      if (!onPage(stroke)) return stroke;
      cleared++;
      const next = { ...stroke };
      delete next.movedFrom;
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
