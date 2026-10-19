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
 * Tested in `src/lib/__tests__/thumbs.test.js`.
 */

import { getPage } from '$lib/storage/local-store.js';
import { peekCachedPage } from './page-cache.js';
import { generateThumbnailSVG } from './page-svg.js';

/**
 * @param {{read: (book: string, pageId: string) => Promise<object|null>,
 *          peek?: (book: string, pageId: string) => object|null,
 *          render: (strokes: Array, rotation: number) => string,
 *          maxEntries?: number, concurrency?: number}} deps
 */
export function createThumbLoader({ read, peek = () => null, render, maxEntries = 150, concurrency = 2 }) {
  const svgs = new Map();     // key -> svg string (insertion order = LRU)
  const inflight = new Map(); // key -> Promise<string>
  const queue = [];
  let running = 0;
  const stats = { reads: 0, peeks: 0, hits: 0 };

  const keyOf = (book, pageId, rotation) => `${book}/${pageId}@${rotation || 0}`;

  function remember(key, svg) {
    svgs.set(key, svg);
    while (svgs.size > maxEntries) svgs.delete(svgs.keys().next().value);
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

  /** The SVG for a page, or '' when it cannot be read. Never throws. */
  function get(book, pageId, rotation = 0) {
    const key = keyOf(book, pageId, rotation);
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
      const svg = render(cached.strokes || [], rotation);
      remember(key, svg);
      return Promise.resolve(svg);
    }

    const p = new Promise((resolve) => {
      queue.push(async () => {
        try {
          stats.reads++;
          const doc = await read(book, pageId);
          const svg = render((doc && doc.strokes) || [], rotation);
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
  function peekSvg(book, pageId, rotation = 0) {
    return svgs.get(keyOf(book, pageId, rotation)) ?? null;
  }

  /** Forget every thumbnail (rescan, data-folder change). */
  function clear() {
    svgs.clear();
  }

  return { get, peekSvg, clear, stats, size: () => svgs.size };
}

/** The app's loader: 240×180 thumbnails, read through local-store. */
export const thumbs = createThumbLoader({
  read: (book, pageId) => getPage(book, pageId),
  peek: peekCachedPage,
  render: (strokes, rotation) => generateThumbnailSVG(strokes, 240, 180, undefined, rotation)
});
