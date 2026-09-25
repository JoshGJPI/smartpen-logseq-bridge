/**
 * feed-pages — reference-counted PageDoc holder for the Timeline feed.
 *
 * The feed reads pages a day at a time as they scroll near and lets go of them
 * once they are well out of view, so a month-long range doesn't pull the corpus
 * onto the heap. It does NOT use `page-cache.js`: that LRU holds six docs for
 * the Books spread, and one busy day of the feed would evict all of them.
 *
 * Counted rather than per-day because pages are shared across days — 154 of 289
 * pages on the corpus hold ink from more than one day — so a page on Wednesday
 * and Friday is read once while either day is loaded, and released only when
 * both have let go.
 *
 * `load` is injected so the lifecycle is testable without IPC.
 */

import { getPage } from '../storage/local-store.js';

/**
 * @param {(book: string, pageId: string) => Promise<Object|null>} [load]
 */
export function createFeedPageLoader(load = getPage) {
  /** @type {Map<string, {refs: number, promise: Promise<Object|null>}>} */
  const entries = new Map();
  const keyOf = (book, pageId) => `${book}/${pageId}`;

  return {
    /** Read (or share) a page and hold it until the matching `release()`. */
    acquire(book, pageId) {
      const key = keyOf(book, pageId);
      let entry = entries.get(key);
      if (!entry) {
        const promise = Promise.resolve()
          .then(() => load(String(book), String(pageId)))
          .catch((err) => {
            // Forget a failed read so the next acquire retries rather than
            // handing every later caller the same rejection.
            if (entries.get(key) === entry) entries.delete(key);
            throw err;
          });
        entry = { refs: 0, promise };
        entries.set(key, entry);
      }
      entry.refs += 1;
      return entry.promise;
    },

    /** Drop one hold; the doc is forgotten once nothing holds it. */
    release(book, pageId) {
      const key = keyOf(book, pageId);
      const entry = entries.get(key);
      if (!entry) return;
      entry.refs -= 1;
      if (entry.refs <= 0) entries.delete(key);
    },

    /** Forget every page — the feed unmounting, or a rescan. */
    clear() {
      entries.clear();
    },

    /** How many distinct pages are held right now. */
    size() {
      return entries.size;
    }
  };
}
