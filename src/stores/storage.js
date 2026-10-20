/**
 * Storage Store - Manages save state for the local data folder
 */
import { writable, derived } from 'svelte/store';

// Storage operation state
export const storageStatus = writable({
  isSaving: false,
  lastSave: null,
  lastError: null,
  savedPages: new Set() // Set of "B{book}/P{page}" strings
});

/**
 * v2.0 Unsaved-changes indicator.
 *
 * Bumped whenever the canvas state diverges from what was last persisted
 * (new strokes, pending deletions, pasted strokes). Reset by recordSuccessfulSave.
 *
 * This is intentionally a coarse "dirty" flag rather than a precise change-set.
 * It powers the header dot and the window-close prompt.
 */
export const unsavedChanges = writable(false);

export function markUnsavedChanges() {
  unsavedChanges.set(true);
}

export function clearUnsavedChanges() {
  unsavedChanges.set(false);
}

// Storage statistics
export const storageStats = writable({
  totalPages: 0,
  totalStrokes: 0,
  lastUpdate: null
});

/**
 * Set saving status
 * @param {boolean} saving - True if save operation in progress
 */
export function setStorageSaving(saving) {
  storageStatus.update(s => ({ ...s, isSaving: saving }));
}

/**
 * Record successful save
 * @param {string} pageKey - Page identifier (e.g., "B3017/P42")
 * @param {Object} result - Save result with stats
 */
export function recordSuccessfulSave(pageKey, result) {
  storageStatus.update(s => {
    const savedPages = new Set(s.savedPages);
    savedPages.add(pageKey);
    
    return {
      isSaving: false,
      lastSave: {
        page: pageKey,
        timestamp: Date.now(),
        added: result.added || 0,
        total: result.total || 0
      },
      lastError: null,
      savedPages
    };
  });
  
  storageStats.update(s => ({
    ...s,
    totalPages: s.totalPages + (result.added > 0 ? 1 : 0),
    lastUpdate: Date.now()
  }));

  // Successful save clears the unsaved-changes flag.
  unsavedChanges.set(false);
}

/**
 * Record storage error
 * @param {string} error - Error message
 */
export function recordStorageError(error) {
  storageStatus.update(s => ({
    ...s,
    isSaving: false,
    lastError: {
      message: error,
      timestamp: Date.now()
    }
  }));
}

