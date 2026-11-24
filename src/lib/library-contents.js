/**
 * The Library's table of contents (reading-first package C): notebooks and
 * their pages, from the metadata-only scan records. No page is read: the
 * `transcribed` flag and `strokeCount` already ride on each record. Whether a
 * transcript is linked to its ink comes from the capture-date index's `linked`
 * (main's ink-trust.cjs, cached per file), so pages still to relink show too.
 */

const idOf = (r) => (r.pageId != null ? String(r.pageId) : String(r.page));

/**
 * @param {Record<string, Array<object>>} pagesByBook  `pagesByBook` store (pages sorted)
 * @param {string[]} bookIds  `bookIds` store (book keys, volume-aware order)
 * @param {(book: string) => string} nameOf  display name for a book key
 * @param {{pages?: Record<string, {linked?: boolean|null}>}|null} [timeline]  capture-date index
 * @returns {Array<{book: string, name: string, transcribed: number, unlinked: number,
 *   pages: Array<{pageId: string, transcribed: boolean, unlinked: boolean, strokeCount: number}>}>}
 *   `unlinked`: transcribed, and the index says its lines are not linked to the ink
 *   (false until the index has the page).
 */
export function buildContents(pagesByBook, bookIds, nameOf = (b) => `B${b}`, timeline = null) {
  const idx = (timeline && timeline.pages) || {};
  if (!pagesByBook || !Array.isArray(bookIds)) return [];
  const out = [];
  for (const book of bookIds) {
    const records = pagesByBook[book];
    if (!records || records.length === 0) continue;
    const pages = records.map((r) => {
      const pageId = idOf(r);
      const transcribed = !!r.transcribed;
      const entry = idx[`${book}/${pageId}`];
      return {
        pageId,
        transcribed,
        unlinked: transcribed && !!entry && entry.linked === false,
        strokeCount: r.strokeCount || 0
      };
    });
    out.push({
      book,
      name: nameOf(book),
      transcribed: pages.filter((p) => p.transcribed).length,
      unlinked: pages.filter((p) => p.unlinked).length,
      pages
    });
  }
  return out;
}
