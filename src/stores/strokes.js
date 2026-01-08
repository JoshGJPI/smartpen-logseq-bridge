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
