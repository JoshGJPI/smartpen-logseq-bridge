/**
 * page-cache — a tiny LRU over full PageDocs for Book View.
 *
 * v2 perf (#3): the `logseqPages` records no longer carry strokes, so Book View
 * loads each page's PageDoc lazily, on demand. This cache keeps the last few
 * viewed docs resident so page-turning a spread (and re-rendering its two pages)
 * doesn't re-read disk every time, while older entries are evicted so the whole
 * library never accumulates in memory.
 *
 * Keyed by "B{book}/P{pageId}" where pageId includes any letter suffix, so
 * P151 and P151b never collide.
 */

import { getPage } from '$lib/storage/local-store.js';

const MAX_ENTRIES = 6; // a spread (2) + a little look-ahead/recency headroom
const cache = new Map();    // key -> PageDoc (Map preserves insertion order → LRU)
const inflight = new Map(); // key -> Promise<PageDoc|null> (dedupe concurrent reads)

function keyOf(book, pageId) {
  return `B${book}/P${pageId}`;
}

function evictIfNeeded() {
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
}

/**
 * Fetch a PageDoc, caching the result. Concurrent requests for the same page
 * share one disk read. Returns null if the page file doesn't exist.
 * @param {number} book
 * @param {string|number} pageId  unique-within-book id (incl. suffix)
 * @returns {Promise<import('$lib/storage/page-doc.js').PageDoc|null>}
 */
export async function getCachedPage(book, pageId) {
  const key = keyOf(book, pageId);

  if (cache.has(key)) {
    // Bump recency.
    const doc = cache.get(key);
    cache.delete(key);
    cache.set(key, doc);
    return doc;
  }

  if (inflight.has(key)) return inflight.get(key);

  const p = getPage(book, pageId)
    .then((doc) => {
      inflight.delete(key);
      if (doc) {
        cache.set(key, doc);
        evictIfNeeded();
      }
      return doc;
    })
    .catch((err) => {
      inflight.delete(key);
      throw err;
    });

  inflight.set(key, p);
  return p;
}

/**
 * Drop a page from the cache so the next read re-fetches from disk. Call after
 * a page is re-saved (e.g. a transcript edit) so a re-view shows fresh data.
 */
export function invalidatePage(book, pageId) {
  cache.delete(keyOf(book, pageId));
}

/** Clear the whole cache (e.g. on rescan / data-folder change). */
export function clearPageCache() {
  cache.clear();
  inflight.clear();
}
