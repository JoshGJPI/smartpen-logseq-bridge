/**
 * The Editor's text view: which transcripts to draw, and on which canvas page.
 *
 * Pure helpers for StrokeCanvas. A transcript can come from an unsaved MyScript
 * run (`pageTranscriptions`) or from a saved page's scan record (`savedPages`).
 * Their page keys don't always agree with the canvas's own (a scan record has no
 * pen section / owner), so pages are matched by book key and integer page.
 */

import { BOOK_KEY_FRAGMENT, compareBookKeys } from './volumes.js';

// S#/O#/B<bookKey>/P# — the book portion may carry a volume suffix.
const BOOK_PAGE_KEY_RE = new RegExp(`S\\d+\\/O\\d+\\/B(${BOOK_KEY_FRAGMENT})\\/P(\\d+)$`);

/**
 * True if a full canvas page key names this book and page. Book keys compare as
 * strings: parseInt("388v2") is 388, which would match volume 1's page too.
 * @param {string} pageKey  `S3/O1012/B388v2/P41`
 * @param {string|number} book  book key
 * @param {number} page  integer NCode page
 */
export function pageKeyMatches(pageKey, book, page) {
  const m = String(pageKey).match(BOOK_PAGE_KEY_RE);
  return !!m && m[1] === String(book) && Number(m[2]) === Number(page);
}

/**
 * The first key in `pageKeys` that names this book and page, or null.
 * @param {Iterable<string>} pageKeys
 */
export function findPageKey(pageKeys, book, page) {
  for (const key of pageKeys) {
    if (pageKeyMatches(key, book, page)) return key;
  }
  return null;
}

/**
 * Transcripts for the pages shown on the canvas, ordered by book then page.
 * An unsaved MyScript run wins over the saved page's text for the same page.
 *
 * @param {object} args
 * @param {Set<string>} args.selectedPages  canvas page keys currently shown
 * @param {Array} [args.pageTranscriptions]  `pageTranscriptionsArray` entries
 * @param {Array} [args.savedPages]  scan records
 * @returns {Array<{ pageKey, text, lines, pageId, pageInfo, strokeCount, source }>}
 */
export function collectVisibleTranscriptions({ selectedPages, pageTranscriptions = [], savedPages = [] }) {
  const shown = (pageKey, book, page) =>
    selectedPages.has(pageKey) || findPageKey(selectedPages, book, page) !== null;

  const out = [];

  for (const pt of pageTranscriptions || []) {
    if (!pt?.pageInfo || !shown(pt.pageKey, pt.pageInfo.book, pt.pageInfo.page)) continue;
    out.push({
      pageKey: pt.pageKey,
      text: pt.text,
      // Structured lines (indent levels / task state) drive the LogSeq-format
      // copy; `text` is what the canvas renders.
      lines: Array.isArray(pt.lines) ? pt.lines : null,
      pageId: String(pt.pageInfo.page),
      pageInfo: pt.pageInfo,
      strokeCount: pt.strokeCount,
      source: 'myscript'
    });
  }

  for (const rec of savedPages || []) {
    if (!rec?.transcriptionText) continue;
    const already = out.some(t =>
      String(t.pageInfo.book) === String(rec.book) && Number(t.pageInfo.page) === Number(rec.page)
    );
    if (already) continue;

    const pageKey = `S${rec.section || 0}/O${rec.owner || 0}/B${rec.book}/P${rec.page}`;
    if (!shown(pageKey, rec.book, rec.page)) continue;

    out.push({
      pageKey,
      text: rec.transcriptionText,
      // Scan records carry no lines; the copy path reads the PageDoc by pageId
      // (suffix-safe) to get the hierarchy.
      lines: null,
      pageId: rec.pageId != null ? String(rec.pageId) : String(rec.page),
      pageInfo: { section: rec.section || 0, owner: rec.owner || 0, book: rec.book, page: rec.page },
      strokeCount: rec.strokeCount || 0,
      source: 'saved'
    });
  }

  // Book keys sort through compareBookKeys: `a.book - b.book` is NaN for "388v2".
  return out.sort((a, b) =>
    compareBookKeys(String(a.pageInfo.book), String(b.pageInfo.book)) || (a.pageInfo.page - b.pageInfo.page)
  );
}
