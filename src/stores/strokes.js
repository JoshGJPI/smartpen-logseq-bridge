/**
 * Strokes Store - Manages stroke data from the pen
 * Svelte 4 writable and derived stores
 */
import { writable, derived } from 'svelte/store';

// Raw stroke data
export const strokes = writable([]);

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
  strokes.update(s => [...s, ...offlineStrokes]);
}

/**
 * Clear all strokes
 */
export function clearStrokes() {
  strokes.set([]);
  currentPageInfo.set(null);
}

/**
 * Get a specific stroke by index (one-time read)
 * @param {number} index 
 */
export function getStroke(index) {
  let result;
  strokes.subscribe(s => {
    result = s[index];
  })();
  return result;
}
