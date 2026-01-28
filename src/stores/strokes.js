/**
 * Strokes Store - Manages stroke data from the pen
 * Svelte 4 writable and derived stores
 */
import { writable, derived } from 'svelte/store';
import { registerBookId, registerBookIds } from './book-aliases.js';

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

// Current page info (for tracking which page is being written to)
export const currentPageInfo = writable(null);

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
}

/**
 * Load strokes from storage format into the store
 * Used when loading data from LogSeq - restores blockUuid associations
 * @param {Array} storedStrokes - Strokes from storage (with blockUuid)
 * @param {Object} pageInfo - Page info to attach
 */
export function loadStrokesFromStorage(storedStrokes, pageInfo) {
  if (!storedStrokes || storedStrokes.length === 0) return;
  
  // Register book ID
  if (pageInfo?.book) {
    registerBookId(pageInfo.book);
  }
  
  // Convert from storage format (restores blockUuid)
  const fullStrokes = storedStrokes.map(stored => ({
    pageInfo: pageInfo,
    startTime: stored.startTime,
    endTime: stored.endTime,
    blockUuid: stored.blockUuid || null,
    dotArray: stored.points.map(([x, y, timestamp]) => ({
      x,
      y,
      f: 512,
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
