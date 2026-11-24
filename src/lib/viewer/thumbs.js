/**
 * thumbs — page thumbnails for the Library home, a notebook's page grid and
 * search results (reading-first package E).
 *
 * Thumbnails are the one place the Library reads pages without opening one, so
 * they are kept away from the reader's LRU page cache (6 docs, a spread plus
 * look-ahead): a home screen of thumbnails read through it would evict the
 * spread you just left. Instead:
 *   - a doc the page cache already holds is used without bumping it (`peek`);
 *   - otherwise the page is read directly, the small SVG string is built, and
 *     the doc is dropped at once;
 *   - only the SVG strings are kept, in a bounded LRU keyed by book key, page
 *     id (P151 and P151b don't collide) and rotation;
 *   - at most `concurrency` reads run at once, so scrolling a grid does not
 *     queue dozens of IPC reads ahead of a page you click.
 * Components ask only for thumbnails that are on screen (PageThumb's
 * IntersectionObserver).
 *
 * The doc read for a thumbnail is also judged once (`judge`, the app's
 * `isTrustworthyTranscript`), so a page tile can colour its transcribed ✓ by
 * whether the lines are linked to the ink, without a read of its own. Kept per
 * page (not per rotation) beside the SVGs and dropped with them.
 *
 * Tested in `src/lib/__tests__/thumbs.test.js`.
 */

import { getPage } from '$lib/storage/local-store.js';
import { peekCachedPage } from './page-cache.js';
import { generateThumbnailSVG } from './page-svg.js';
import { isTrustworthyTranscript } from './ink-text.js';

/**
 * @param {{read: (book: string, pageId: string) => Promise<object|null>,
 *          peek?: (book: string, pageId: string) => object|null,
 *          render: (strokes: Array, rotation: number) => string,
 *          judge?: (doc: object) => boolean,
 *          maxEntries?: number, concurrency?: number}} deps
 */
export function createThumbLoader({ read, peek = () => null, render, judge = null, maxEntries = 150, concurrency = 2 }) {
  const svgs = new Map();     // key -> svg string (insertion order = LRU)
  const trust = new Map();    // "book/pageId" -> boolean (judge's answer for the doc read)
  const inflight = new Map(); // key -> Promise<string>
  const queue = [];
  let running = 0;
  const stats = { reads: 0, peeks: 0, hits: 0 };

  // A sketch's crop (v3.24.0) is keyed by page + line id, under the page's prefix,
  // so invalidating the page drops it too.
  const keyOf = (book, pageId, rotation, lineId = null) => `${book}/${pageId}@${rotation || 0}${lineId ? `#${lineId}` : ''}`;
  const inkOf = (strokes, lineId) => (lineId ? (strokes || []).filter((s) => s && s.lineId === lineId) : strokes || []);

  function remember(key, svg) {
    svgs.set(key, svg);
    while (svgs.size > maxEntries) svgs.delete(svgs.keys().next().value);
  }

  function note(book, pageId, doc) {
    if (!judge || !doc) return;
    const k = `${book}/${pageId}`;
    trust.delete(k);
    trust.set(k, !!judge(doc));
    while (trust.size > maxEntries) trust.delete(trust.keys().next().value);
  }

  function pump() {
    while (running < concurrency && queue.length) {
      const job = queue.shift();
      running++;
      job().finally(() => {
        running--;
        pump();
      });
    }
  }

  /**
   * The SVG for a page, or '' when it cannot be read. Never throws. With
   * `lineId` (v3.24.0) only that line's ink, fitted to its own box: a sketch's
   * crop thumbnail.
   */
  function get(book, pageId, rotation = 0, lineId = null) {
    const key = keyOf(book, pageId, rotation, lineId);
    if (svgs.has(key)) {
      stats.hits++;
      const svg = svgs.get(key);
      svgs.delete(key);
      svgs.set(key, svg);
      return Promise.resolve(svg);
    }
    if (inflight.has(key)) return inflight.get(key);

    const cached = peek(book, pageId);
    if (cached) {
      stats.peeks++;
      note(book, pageId, cached);
      const svg = render(inkOf(cached.strokes, lineId), rotation);
      remember(key, svg);
      return Promise.resolve(svg);
    }

    const p = new Promise((resolve) => {
      queue.push(async () => {
        try {
          stats.reads++;
          const doc = await read(book, pageId);
          note(book, pageId, doc);
          const svg = render(inkOf(doc && doc.strokes, lineId), rotation);
          remember(key, svg);
          resolve(svg);
        } catch {
          resolve('');
        } finally {
          inflight.delete(key);
        }
      });
    });
    inflight.set(key, p);
    pump();
    return p;
  }

  /** The SVG if already built (no read), else null. */
  function peekSvg(book, pageId, rotation = 0, lineId = null) {
    return svgs.get(keyOf(book, pageId, rotation, lineId)) ?? null;
  }

  /**
   * Whether the page's transcript is linked to its ink, as judged on the doc
   * last read for one of its thumbnails; null when no doc has been read.
   */
  function peekTrust(book, pageId) {
    return trust.get(`${book}/${pageId}`) ?? null;
  }

  /** Forget one page's thumbnails, every rotation (the page was re-saved). */
  function invalidate(book, pageId) {
    const prefix = `${book}/${pageId}@`;
    for (const k of [...svgs.keys()]) if (k.startsWith(prefix)) svgs.delete(k);
    trust.delete(`${book}/${pageId}`);
  }

  /** Forget every thumbnail (rescan, data-folder change). */
  function clear() {
    svgs.clear();
    trust.clear();
  }

  return { get, peekSvg, peekTrust, invalidate, clear, stats, size: () => svgs.size };
}

/** The app's loader: 240×180 thumbnails, read through local-store. */
export const thumbs = createThumbLoader({
  read: (book, pageId) => getPage(book, pageId),
  peek: peekCachedPage,
  judge: isTrustworthyTranscript,
  render: (strokes, rotation) => generateThumbnailSVG(strokes, 240, 180, undefined, rotation)
});
