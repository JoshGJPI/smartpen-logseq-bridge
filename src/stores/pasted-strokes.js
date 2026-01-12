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
 * Duplicate selected strokes (copy + paste in one action)
 * @param {Array} strokes - Strokes to duplicate
 * @param {Object} initialOffset - Starting position offset {x, y} in Ncode units
 * @returns {number} Number of duplicated strokes
 */
export function duplicateStrokes(strokes, initialOffset = { x: 50, y: 50 }) {
  if (!strokes || strokes.length === 0) return 0;
  
  const normalized = normalizeAndOffset(strokes, initialOffset);
  
  // Log timestamp generation for first duplicated stroke
  if (normalized.length > 0) {
    const first = normalized[0];
    console.log('🆔 Generated unique timestamps for duplicated strokes:');
    console.log(`   First stroke: ${first.startTime} → ${first.endTime} (duration: ${first.endTime - first.startTime}ms)`);
    console.log(`   First dot: ${first.dotArray[0].timestamp}, Last dot: ${first.dotArray[first.dotArray.length - 1].timestamp}`);
  }
  
  pastedStrokes.update(existing => {
    const updated = [...existing, ...normalized];
    console.log('🔄 Duplicated', normalized.length, 'strokes (total pasted:', updated.length, ')');
    return updated;
  });
  
  return normalized.length;
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
 * Returns the count of deleted strokes for feedback
 * @returns {number} Number of deleted strokes
 */
export function deleteSelectedPasted() {
  const selection = get(pastedSelection);
  
  if (selection.size === 0) return 0;
  
  const deletedCount = selection.size;
  
  pastedStrokes.update(strokes => {
    const filtered = strokes.filter((_, index) => !selection.has(index));
    console.log('🗑️ Deleted', deletedCount, 'pasted strokes (', filtered.length, 'remaining)');
    return filtered;
  });
  
  pastedSelection.set(new Set());
  return deletedCount;
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
 * Applies offsets and normalizes coordinates relative to top-left anchor
 * @param {number} book - Target book number
 * @param {number} page - Target page number
 * @param {Set} selectedIndices - Optional set of indices to convert (defaults to all)
 * @returns {Array} Strokes ready for LogSeq storage
 */
export function getPastedAsNewPage(book, page, selectedIndices = null) {
  const allStrokes = get(pastedStrokes);
  
  if (allStrokes.length === 0) return [];
  
  // Filter to selected strokes if specified
  const strokesToConvert = selectedIndices && selectedIndices.size > 0
    ? allStrokes.filter((_, idx) => selectedIndices.has(idx))
    : allStrokes;
  
  if (strokesToConvert.length === 0) return [];
  
  console.log('📄 Formatting', strokesToConvert.length, 'pasted strokes as B', book, '/P', page);
  
  // First pass: apply offsets to get actual positions
  const strokesWithOffsets = strokesToConvert.map(stroke => ({
    ...stroke,
    dotArray: stroke.dotArray.map(dot => ({
      ...dot,
      x: dot.x + (stroke._offset?.x || 0),
      y: dot.y + (stroke._offset?.y || 0)
    }))
  }));
  
  // Find the top-left anchor point (minimum x and y across all strokes)
  let anchorX = Infinity;
  let anchorY = Infinity;
  
  strokesWithOffsets.forEach(stroke => {
    stroke.dotArray.forEach(dot => {
      anchorX = Math.min(anchorX, dot.x);
      anchorY = Math.min(anchorY, dot.y);
    });
  });
  
  // If no valid bounds found, use 0,0
  if (anchorX === Infinity) {
    anchorX = 0;
    anchorY = 0;
  }
  
  console.log('  📍 Anchor point:', anchorX.toFixed(2), anchorY.toFixed(2));
  
  // Second pass: normalize coordinates relative to anchor point
  return strokesWithOffsets.map(stroke => ({
    ...stroke,
    pageInfo: {
      section: 0,
      owner: 0,
      book: book,
      page: page
    },
    // Normalize coordinates relative to anchor (top-left becomes 0,0)
    dotArray: stroke.dotArray.map(dot => ({
      ...dot,
      x: dot.x - anchorX,
      y: dot.y - anchorY
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
 * IMPORTANT: Generates NEW unique timestamps to prevent conflicts
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
  
  // Generate base timestamp for this duplication batch
  const baseTimestamp = Date.now();
  
  return strokes.map((stroke, strokeIndex) => {
    // Calculate time span of original stroke
    const originalDuration = stroke.endTime - stroke.startTime;
    
    // Generate new timestamps that preserve relative timing
    // Each stroke gets incrementally later timestamp (1ms apart)
    const newStartTime = baseTimestamp + (strokeIndex * 1);
    const newEndTime = newStartTime + originalDuration;
    
    // Generate new dot timestamps that preserve relative timing within stroke
    const dotTimestamps = stroke.dotArray.map((dot, dotIndex) => {
      if (dotIndex === 0) return newStartTime;
      if (dotIndex === stroke.dotArray.length - 1) return newEndTime;
      
      // Interpolate timestamps for middle dots
      const progress = dotIndex / (stroke.dotArray.length - 1);
      return Math.round(newStartTime + (originalDuration * progress));
    });
    
    return {
      // Generate new timestamps (NOT copied from original)
      startTime: newStartTime,
      endTime: newEndTime,
      
      // Mark as duplicated
      pageInfo: null,  // Detach from original page
      _pasted: true,
      _pastedAt: baseTimestamp,
      _sourcePageInfo: stroke.pageInfo,  // Remember where it came from
      
      // Normalize coordinates (start from 0,0) with new timestamps
      dotArray: stroke.dotArray.map((dot, dotIndex) => ({
        x: dot.x - minX,
        y: dot.y - minY,
        f: dot.f,
        timestamp: dotTimestamps[dotIndex]
      })),
      
      _offset: { ...offset }
    };
  });
}
