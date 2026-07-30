/**
 * Saved Pages Store — the scanned index of PageDoc files in the data folder.
 *
 * Records are metadata-only (see storage/scan.js): stroke counts, timestamps and
 * transcript text, never the strokes themselves, so the whole corpus never stays
 * resident. Strokes load lazily per page.
 *
 * Formerly `logseqPages.js`, from when LogSeq was the storage backend — renamed
 * in v2.3. Nothing here is LogSeq-specific.
 */
import { writable, derived } from 'svelte/store';

// Page metadata records, one per PageDoc file found by the scanner
export const savedPages = writable([]);

// Loading state
export const isScanning = writable(false);

// Last scan timestamp
export const lastScanTime = writable(null);

// Pages grouped by book
export const pagesByBook = derived(savedPages, ($pages) => {
  const grouped = {};
  for (const page of $pages) {
    const book = page.book;
    if (!grouped[book]) {
      grouped[book] = [];
    }
    grouped[book].push(page);
  }
  // Sort pages within each book (break page-number ties by suffix so
  // letter-suffixed variants like P127b follow P127 deterministically)
  for (const book of Object.keys(grouped)) {
    grouped[book].sort(
      (a, b) => (a.page - b.page) || String(a.suffix || '').localeCompare(String(b.suffix || ''))
    );
  }
  return grouped;
});

// Book IDs sorted
export const bookIds = derived(pagesByBook, ($grouped) => {
  return Object.keys($grouped).map(Number).sort((a, b) => a - b);
});

/**
 * Set the list of saved pages
 * @param {Array} pages - Array of page data objects
 */
export function setSavedPages(pages) {
  savedPages.set(pages);
  lastScanTime.set(Date.now());
}

/**
 * Set scanning state
 * @param {boolean} scanning - Whether currently scanning
 */
export function setScanning(scanning) {
  isScanning.set(scanning);
}

/**
 * Clear all saved-page data
 */
export function clearSavedPages() {
  savedPages.set([]);
  lastScanTime.set(null);
}

/**
 * Update a specific page's sync status
 * @param {number} book - Book ID
 * @param {number} page - Page number
 * @param {string} status - Sync status ('clean' | 'unsaved')
 *
 * Note: 'in-canvas' is NOT set here — whether a page's strokes are loaded is
 * derived from the strokes store (`canvasPageKeys`) so the badge follows the
 * canvas. Stamping it onto the record left it latched after a canvas Clear.
 */
export function updatePageSyncStatus(book, page, status) {
  savedPages.update(pages => {
    return pages.map(p => {
      if (p.book === book && p.page === page) {
        return { ...p, syncStatus: status };
      }
      return p;
    });
  });
}
