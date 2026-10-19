/**
 * The Library's table of contents (reading-first package C): notebooks and
 * their pages, from the metadata-only scan records. No page is read: the
 * `transcribed` flag and `strokeCount` already ride on each record.
 */

const idOf = (r) => (r.pageId != null ? String(r.pageId) : String(r.page));

/**
 * @param {Record<string, Array<object>>} pagesByBook  `pagesByBook` store (pages sorted)
 * @param {string[]} bookIds  `bookIds` store (book keys, volume-aware order)
 * @param {(book: string) => string} nameOf  display name for a book key
 * @returns {Array<{book: string, name: string, transcribed: number,
 *   pages: Array<{pageId: string, transcribed: boolean, strokeCount: number}>}>}
 */
export function buildContents(pagesByBook, bookIds, nameOf = (b) => `B${b}`) {
  if (!pagesByBook || !Array.isArray(bookIds)) return [];
  const out = [];
  for (const book of bookIds) {
    const records = pagesByBook[book];
    if (!records || records.length === 0) continue;
    const pages = records.map((r) => ({
      pageId: idOf(r),
      transcribed: !!r.transcribed,
      strokeCount: r.strokeCount || 0
    }));
    out.push({
      book,
      name: nameOf(book),
      transcribed: pages.filter((p) => p.transcribed).length,
      pages
    });
  }
  return out;
}
