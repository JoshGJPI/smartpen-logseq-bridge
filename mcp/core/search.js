/**
 * Global search, exactly as the header's search field runs it (SearchField.svelte):
 * parseSearchQuery() → runSearch() over the same context the Library stores
 * derive. lib/global-search.js and lib/search-query.js are already store-free
 * and import under plain Node, so nothing is ported; this file only builds the
 * context from the Node scan.
 *
 * App store → here:
 *   globalSearchIndex  buildSearchIndex(savedPages)       → buildSearchIndex(scan.pages)
 *   notebookNames      bookIds + formatBookName alias-only → notebookNames(scan)
 *   timelineIndexFiltered                                  → scan.index (the MCP has no Timeline book filter)
 *   searchDates        pageDates(timelineIndexFiltered)    → pageDates(scan.index)
 *   searchRecords      recordsByKey(savedPages)            → recordsByKey(scan.pages)
 *   tagStatsList       tagStats(pageTags)                  → tagStats(scan.tags)
 */
import { parseSearchQuery } from '../../src/lib/search-query.js';
import { buildSearchIndex, recordsByKey, runSearch } from '../../src/lib/global-search.js';
import { pageDates } from '../../src/lib/library-home.js';
import { tagStats } from '../../src/lib/tags.js';
import { compareBookKeys } from '../../src/lib/volumes.js';
import { bookName } from './store.js';

/** `{book, name}` per notebook with pages, sorted like the app's `bookIds`. */
export function notebookNames(scan) {
  const ids = [...new Set(scan.pages.map((p) => p.book))].sort(compareBookKeys);
  return ids.map((book) => ({ book, name: bookName(scan.aliases, book) }));
}

/** A search function that rebuilds the derived pieces only when the pages, aliases or tags change. */
export function createSearch() {
  let key = null;
  let built = null;
  return function search(scan, input, { now = new Date() } = {}) {
    const k = scan.pages.map((p) => `${p.book}/${p.pageId}:${p.mtimeMs}:${p.size}`).join('|')
      + `#${JSON.stringify(scan.aliases)}#${JSON.stringify(scan.tags)}`;
    if (k !== key) {
      built = {
        index: buildSearchIndex(scan.pages),
        notebooks: notebookNames(scan),
        timeline: scan.index,
        dates: pageDates(scan.index),
        records: recordsByKey(scan.pages),
        tags: tagStats(scan.tags)
      };
      key = k;
    }
    const q = parseSearchQuery(input, { now });
    return { q, res: runSearch(q, built), dates: built.dates };
  };
}
