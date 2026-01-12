/**
 * Pasted Strokes Store - Manages pasted strokes that are movable on canvas
 * These strokes are independent from original page-locked strokes
 */
import { writable, derived, get } from 'svelte/store';

/**
 * Pasted strokes - separate from original page strokes
 * These are movable and can be grouped into new pages
 */
export const pastedStrokes = writable([]);

/**
 * Selection within pasted strokes (indices)
 */
export const pastedSelection = writable(new Set());

/**
 * Count of pasted strokes
 */
export const pastedCount = derived(
  pastedStrokes,
  $strokes => $strokes.length
);

/**
 * Selected pasted strokes
 */
export const selectedPastedStrokes = derived(
  [pastedStrokes, pastedSelection],
  ([$strokes, $selection]) =>
    Array.from($selection).map(i => $strokes[i]).filter(Boolean)
);

/**
 * Whether any pasted strokes are selected
 */
export const hasPastedSelection = derived(
  pastedSelection,
  $selection => $selection.size > 0
);

/**
 * Add strokes from clipboard to pasted collection
 * Normalizes coordinates and applies initial offset
 * @param {Array} strokes - Strokes to paste
 * @param {Object} initialOffset - Starting position offset {x, y} in Ncode units
 */
export function pasteStrokes(strokes, initialOffset = { x: 0, y: 0 }) {
  if (!strokes || strokes.length === 0) return;
  
  const normalized = normalizeAndOffset(strokes, initialOffset);
  
  pastedStrokes.update(existing => {
    const updated = [...existing, ...normalized];
    console.log('📥 Pasted', normalized.length, 'strokes (total:', updated.length, ')');
    return updated;
  });
}

/**
 * Move selected pasted strokes by delta
 * @param {number} deltaX - X movement in Ncode units
 * @param {number} deltaY - Y movement in Ncode units
 */
export function movePastedStrokes(deltaX, deltaY) {
  const selection = get(pastedSelection);
  if (selection.size === 0) return;
  
  pastedStrokes.update(strokes => 
    strokes.map((stroke, index) => {
      if (!selection.has(index)) return stroke;
      
      return {
        ...stroke,
        _offset: {
          x: (stroke._offset?.x || 0) + deltaX,
          y: (stroke._offset?.y || 0) + deltaY
        }
      };
    })
  );
}

/**
 * Remove selected pasted strokes
 */
export function deleteSelectedPasted() {
  const selection = get(pastedSelection);
  
  if (selection.size === 0) return;
  
  pastedStrokes.update(strokes => {
    const filtered = strokes.filter((_, index) => !selection.has(index));
    console.log('🗑️ Deleted', selection.size, 'pasted strokes (', filtered.length, 'remaining)');
    return filtered;
  });
  
  pastedSelection.set(new Set());
}

/**
 * Clear all pasted strokes
 */
export function clearPastedStrokes() {
  const count = get(pastedStrokes).length;
  pastedStrokes.set([]);
  pastedSelection.set(new Set());
  if (count > 0) {
    console.log('🗑️ Cleared all', count, 'pasted strokes');
  }
}

/**
 * Toggle selection of a pasted stroke
 * @param {number} index - Stroke index
 * @param {boolean} multi - Whether to toggle (true) or replace (false)
 */
export function selectPastedStroke(index, multi = false) {
  pastedSelection.update(sel => {
    const newSel = multi ? new Set(sel) : new Set();
    if (newSel.has(index)) {
      newSel.delete(index);
    } else {
      newSel.add(index);
    }
    return newSel;
  });
}

/**
 * Clear pasted selection
 */
export function clearPastedSelection() {
  pastedSelection.set(new Set());
}

/**
 * Get pasted strokes formatted for saving as a new page
 * Applies offsets to create final coordinates
 * @param {number} book - Target book number
 * @param {number} page - Target page number
 * @returns {Array} Strokes ready for LogSeq storage
 */
export function getPastedAsNewPage(book, page) {
  const strokes = get(pastedStrokes);
  
  if (strokes.length === 0) return [];
  
  console.log('📄 Formatting', strokes.length, 'pasted strokes as B', book, '/P', page);
  
  return strokes.map(stroke => ({
    ...stroke,
    pageInfo: {
      section: 0,
      owner: 0,
      book: book,
      page: page
    },
    // Apply offset to dotArray coordinates
    dotArray: stroke.dotArray.map(dot => ({
      ...dot,
      x: dot.x + (stroke._offset?.x || 0),
      y: dot.y + (stroke._offset?.y || 0)
    })),
    // Remove pasted metadata
    _pasted: undefined,
    _pastedAt: undefined,
    _offset: undefined,
    _sourcePageInfo: undefined
  }));
}

/**
 * Helper: Normalize coordinates and apply initial offset
 * Finds the min bounds and translates all strokes to start from 0,0
 * Then applies the initial offset for paste positioning
 * @private
 */
function normalizeAndOffset(strokes, offset) {
  // Find bounds
  let minX = Infinity, minY = Infinity;
  strokes.forEach(stroke => {
    stroke.dotArray?.forEach(dot => {
      minX = Math.min(minX, dot.x);
      minY = Math.min(minY, dot.y);
    });
  });
  
  // If no valid bounds found, use 0,0
  if (minX === Infinity) {
    minX = 0;
    minY = 0;
  }
  
  return strokes.map(stroke => ({
    ...stroke,
    pageInfo: null,  // Detach from original page
    _pasted: true,
    _pastedAt: Date.now(),
    _sourcePageInfo: stroke.pageInfo,  // Remember where it came from
    // Normalize coordinates (start from 0,0)
    dotArray: stroke.dotArray.map(dot => ({
      ...dot,
      x: dot.x - minX,
      y: dot.y - minY
    })),
    _offset: { ...offset }
  }));
}
