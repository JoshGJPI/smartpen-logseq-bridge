/**
 * Selection Store - Manages selected stroke indices
 * Supports multi-select with Ctrl+click and range with Shift+click
 */
import { writable, derived } from 'svelte/store';
import { strokes } from './strokes.js';

// Set of selected stroke indices
export const selectedIndices = writable(new Set());

// Last selected index (for shift+click range selection)
export const lastSelectedIndex = writable(null);

// Selected strokes (actual stroke objects)
export const selectedStrokes = derived(
  [strokes, selectedIndices],
  ([$strokes, $selectedIndices]) => {
    return Array.from($selectedIndices)
      .map(i => $strokes[i])
      .filter(Boolean);
  }
);

// Selection count
export const selectionCount = derived(
  selectedIndices, 
  $sel => $sel.size
);

// Whether any strokes are selected
export const hasSelection = derived(
  selectedIndices,
  $sel => $sel.size > 0
);

/**
 * Select or deselect a single stroke
 * @param {number} index - Stroke index
 * @param {boolean} multi - Whether to toggle (Ctrl+click behavior)
 */
export function selectStroke(index, multi = false) {
  selectedIndices.update(sel => {
    const newSel = multi ? new Set(sel) : new Set();
    if (newSel.has(index)) {
      newSel.delete(index);
    } else {
      newSel.add(index);
    }
    return newSel;
  });
  lastSelectedIndex.set(index);
}

/**
 * Select a range of strokes (Shift+click behavior)
 * @param {number} fromIndex - Start of range
 * @param {number} toIndex - End of range
 * @param {boolean} addToExisting - Whether to add to existing selection
 */
export function selectRange(fromIndex, toIndex, addToExisting = false) {
  const start = Math.min(fromIndex, toIndex);
  const end = Math.max(fromIndex, toIndex);
  
  selectedIndices.update(sel => {
    const newSel = addToExisting ? new Set(sel) : new Set();
    for (let i = start; i <= end; i++) {
      newSel.add(i);
    }
    return newSel;
  });
}

/**
 * Select all strokes
 * @param {number} count - Total number of strokes
 */
export function selectAll(count) {
  selectedIndices.update(() => {
    const newSel = new Set();
    for (let i = 0; i < count; i++) {
      newSel.add(i);
    }
    return newSel;
  });
}

/**
 * Clear all selection
 */
export function clearSelection() {
  selectedIndices.set(new Set());
  lastSelectedIndex.set(null);
}

/**
 * Handle stroke click with modifier keys
 * @param {number} index - Clicked stroke index
 * @param {boolean} ctrlKey - Whether Ctrl/Cmd was held
 * @param {boolean} shiftKey - Whether Shift was held
 */
export function handleStrokeClick(index, ctrlKey, shiftKey) {
  let lastIndex;
  lastSelectedIndex.subscribe(v => lastIndex = v)();
  
  if (shiftKey && lastIndex !== null) {
    // Range selection
    selectRange(lastIndex, index, ctrlKey);
  } else if (ctrlKey) {
    // Toggle selection
    selectStroke(index, true);
  } else {
    // Single selection
    selectStroke(index, false);
  }
  
  lastSelectedIndex.set(index);
}
