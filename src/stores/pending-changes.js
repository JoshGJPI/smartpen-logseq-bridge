/**
 * Pending Changes Store - Tracks local changes before sync to LogSeq
 * Handles stroke deletions with undo capability and per-page change tracking
 */
import { writable, derived, get } from 'svelte/store';
import { strokes } from './strokes.js';
import { storageStatus } from './storage.js';

// Set of deleted stroke indices (local only, not synced to LogSeq yet)
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

/**
 * Compute pending changes per page
 * Returns a Map of pageKey -> { additions, deletions, book, page }
 */
export const pendingChanges = derived(
  [strokes, deletedIndices, storageStatus],
  ([$strokes, $deletedIndices, $storageStatus]) => {
    const changes = new Map();
    
    // Group all strokes by page
    $strokes.forEach((stroke, index) => {
      const pageInfo = stroke.pageInfo;
      if (!pageInfo || pageInfo.book === undefined || pageInfo.page === undefined) return;
      
      const pageKey = `B${pageInfo.book}/P${pageInfo.page}`;
      
      if (!changes.has(pageKey)) {
        changes.set(pageKey, {
          book: pageInfo.book,
          page: pageInfo.page,
          additions: [],
          deletions: [],
          isSaved: $storageStatus.savedPages.has(pageKey)
        });
      }
      
      const pageChanges = changes.get(pageKey);
      
      if ($deletedIndices.has(index)) {
        // This stroke is marked for deletion
        pageChanges.deletions.push(index);
      } else if (!pageChanges.isSaved) {
        // This is a new stroke (page not saved yet)
        pageChanges.additions.push(index);
      }
    });
    
    return changes;
  }
);

/**
 * Check if there are any pending changes
 */
export const hasPendingChanges = derived(
  pendingChanges,
  $changes => {
    for (const [_, pageChanges] of $changes) {
      if (pageChanges.additions.length > 0 || pageChanges.deletions.length > 0) {
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
 * Get summary of pending changes (for display)
 * @returns {Object} Summary with counts
 */
export function getPendingChangesSummary() {
  const $pendingChanges = get(pendingChanges);
  
  let totalAdditions = 0;
  let totalDeletions = 0;
  let pagesWithChanges = 0;
  
  for (const [_, pageChanges] of $pendingChanges) {
    if (pageChanges.additions.length > 0 || pageChanges.deletions.length > 0) {
      pagesWithChanges++;
      totalAdditions += pageChanges.additions.length;
      totalDeletions += pageChanges.deletions.length;
    }
  }
  
  return {
    totalAdditions,
    totalDeletions,
    pagesWithChanges,
    changes: $pendingChanges
  };
}
