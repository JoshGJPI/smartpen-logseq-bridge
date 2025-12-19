/**
 * LogSeq Pages Store - Track smartpen data stored in LogSeq
 */
import { writable, derived } from 'svelte/store';

// Raw page data from LogSeq
export const logseqPages = writable([]);

// Loading state
export const isScanning = writable(false);

// Last scan timestamp
export const lastScanTime = writable(null);

// Pages grouped by book
export const pagesByBook = derived(logseqPages, ($pages) => {
  const grouped = {};
  for (const page of $pages) {
    const book = page.book;
    if (!grouped[book]) {
      grouped[book] = [];
    }
    grouped[book].push(page);
  }
  // Sort pages within each book
  for (const book of Object.keys(grouped)) {
    grouped[book].sort((a, b) => a.page - b.page);
  }
  return grouped;
});

// Book IDs sorted
export const bookIds = derived(pagesByBook, ($grouped) => {
  return Object.keys($grouped).map(Number).sort((a, b) => a - b);
});

/**
 * Set the list of LogSeq pages
 * @param {Array} pages - Array of page data objects
 */
export function setLogseqPages(pages) {
  logseqPages.set(pages);
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
 * Clear all LogSeq page data
 */
export function clearLogseqPages() {
  logseqPages.set([]);
  lastScanTime.set(null);
}

/**
 * Update a specific page's sync status
 * @param {number} book - Book ID
 * @param {number} page - Page number
 * @param {string} status - Sync status ('clean' | 'unsaved' | 'in-canvas')
 */
export function updatePageSyncStatus(book, page, status) {
  logseqPages.update(pages => {
    return pages.map(p => {
      if (p.book === book && p.page === page) {
        return { ...p, syncStatus: status };
      }
      return p;
    });
  });
}
