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
import { compareBookKeys } from '../lib/volumes.js';
import { invalidatePage } from '../lib/viewer/page-cache.js';
import { buildTaskSummary, summaryWithState } from '../lib/tasks.js';

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

// Book KEYS sorted — NCode book first, then volume, so "388v2" sits directly
// under "388" rather than after "3880" (naive string sort) or vanishing into
// NaN (the old `.map(Number).sort()`).
export const bookIds = derived(pagesByBook, ($grouped) => {
  return Object.keys($grouped).sort(compareBookKeys);
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
 * Reflect a transcript saved in the Library reader back into its scan record:
 * lightweight fields only (no strokes or PageDoc residency), and drop the
 * page's cached doc so a re-view reads the fresh transcript. The global search
 * index is derived from this store, so it picks the new text up too.
 * @param {string} book  book key
 * @param {string} pageId  unique-within-book id (incl. suffix)
 * @param {Array<{text?: string, indentLevel?: number}>} lines
 */
export function applyTranscriptToRecord(book, pageId, lines) {
  const transcriptionText = lines.length
    ? lines.map((l) => '  '.repeat(l.indentLevel || 0) + (l.text || '')).join('\n')
    : null;
  savedPages.update((pages) =>
    pages.map((p) => {
      const id = p.pageId != null ? String(p.pageId) : String(p.page);
      if (p.book !== book || id !== String(pageId)) return p;
      return {
        ...p, transcriptionText, transcribed: !!transcriptionText, transcriptLineCount: lines.length,
        tasks: buildTaskSummary(lines)
      };
    })
  );
  invalidatePage(book, pageId);
}

/**
 * Reflect one task's new state (lib/viewer/task-state.js) in its scan record:
 * the `tasks` summary and `lastUpdated`, nothing else. The reader's cached doc
 * is dropped by the caller.
 * @param {string} book  book key
 * @param {string} pageId
 * @param {string} lineId
 * @param {'todo'|'done'|'waiting'} state
 * @param {string} [lastUpdated]  the doc's new metadata.lastUpdated
 */
export function applyTaskStateToRecord(book, pageId, lineId, state, lastUpdated) {
  savedPages.update((pages) =>
    pages.map((p) => {
      const id = p.pageId != null ? String(p.pageId) : String(p.page);
      if (String(p.book) !== String(book) || id !== String(pageId)) return p;
      const tasks = summaryWithState(p.tasks, lineId, state);
      return { ...p, tasks, lastUpdated: lastUpdated || p.lastUpdated };
    })
  );
}
