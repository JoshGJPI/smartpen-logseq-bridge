/**
 * Storage Store - Manages LogSeq storage state
 */
import { writable, derived } from 'svelte/store';

// Storage operation state
export const storageStatus = writable({
  isSaving: false,
  lastSave: null,
  lastError: null,
  savedPages: new Set() // Set of "B{book}/P{page}" strings
});

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

/**
 * Clear storage status
 */
export function clearStorageStatus() {
  storageStatus.update(s => ({
    ...s,
    lastSave: null,
    lastError: null
  }));
}

/**
 * Check if a page has been saved
 * @param {number} book - Book ID
 * @param {number} page - Page number
 * @returns {boolean} True if page is saved
 */
export function isPageSaved(book, page) {
  let saved = false;
  storageStatus.subscribe(s => {
    saved = s.savedPages.has(`B${book}/P${page}`);
  })();
  return saved;
}

// Derived: Has any saved pages
export const hasSavedPages = derived(
  storageStatus,
  $status => $status.savedPages.size > 0
);

// Derived: Storage status message
export const storageStatusMessage = derived(
  storageStatus,
  $status => {
    if ($status.isSaving) {
      return 'Saving to LogSeq...';
    }
    if ($status.lastError) {
      return `Error: ${$status.lastError.message}`;
    }
    if ($status.lastSave) {
      return `Saved ${$status.lastSave.page} (${$status.lastSave.added} new, ${$status.lastSave.total} total)`;
    }
    return null;
  }
);
