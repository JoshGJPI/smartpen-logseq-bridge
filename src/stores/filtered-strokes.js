/**
 * Filtered Strokes Store
 * Tracks decorative strokes that were filtered during transcription
 * Optional - for visualization and debugging purposes
 */

import { writable, derived } from 'svelte/store';

/**
 * Store for filtered decorative strokes
 * Array of {stroke, index, type} objects
 */
export const filteredStrokes = writable([]);

/**
 * Derived store for filter statistics
 * Provides counts by type: boxes, underlines, circles
 */
export const filterStats = derived(filteredStrokes, $filtered => {
  const stats = { 
    total: $filtered.length,
    boxes: 0, 
    underlines: 0, 
    circles: 0 
  };
  
  $filtered.forEach(item => {
    if (item.type === 'box') stats.boxes++;
    else if (item.type === 'underline') stats.underlines++;
    else if (item.type === 'circle') stats.circles++;
  });
  
  return stats;
});

/**
 * Set the filtered strokes (called after transcription)
 * @param {Array} decorative - Array of decorative stroke objects
 */
export function setFilteredStrokes(decorative) {
  filteredStrokes.set(decorative);
}

/**
 * Clear the filtered strokes
 */
export function clearFilteredStrokes() {
  filteredStrokes.set([]);
}

/**
 * Get a specific filtered stroke by index
 * @param {number} index - Original stroke index
 * @returns {Object|null} Filtered stroke object or null
 */
export function getFilteredStrokeByIndex(index) {
  let result = null;
  filteredStrokes.update(strokes => {
    result = strokes.find(fs => fs.index === index);
    return strokes;
  });
  return result;
}
