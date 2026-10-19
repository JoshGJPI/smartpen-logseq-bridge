/**
 * The reading pane's toolbar (reading-first package C): which View ▾ options
 * apply to what is showing, and the breadcrumb for an open page.
 *
 * Each option keeps its existing store or BookViewer method; this only decides
 * when it is offered, so the menu never holds a switch that does nothing.
 */

/**
 * View options, in menu order:
 *   content  Strokes | Transcript   (an open page)
 *   layout   Spread | Single         (an open page)
 *   times    hover-to-reveal times   (an open page showing strokes)
 *   paper    printed page behind ink (Library page or Timeline, when any book has paper)
 *   order    Newest | Oldest first   (Timeline)
 *
 * The Editor gets none: it never draws paper, and its canvas has its own toolbar.
 * The Library's home grid gets none either; its thumbnails draw no paper.
 *
 * @param {{destination: string, hasSelection?: boolean, contentMode?: string, backgroundsAvailable?: boolean}} s
 * @returns {Array<'content'|'layout'|'times'|'paper'|'order'>}
 */
export function viewOptionsFor({ destination, hasSelection = false, contentMode = 'strokes', backgroundsAvailable = false }) {
  if (destination === 'library') {
    if (!hasSelection) return [];
    const opts = ['content', 'layout'];
    if (contentMode === 'strokes') opts.push('times');
    if (backgroundsAvailable) opts.push('paper');
    return opts;
  }
  if (destination === 'timeline') {
    return backgroundsAvailable ? ['paper', 'order'] : ['order'];
  }
  return [];
}

/**
 * Page label for the breadcrumb: "P12", or "P12–P13" for a spread. The right
 * page is the next record in the book, as BookViewer pairs them.
 *
 * @param {{book: string, pageId: string}|null} selection
 * @param {Record<string, Array<{pageId?: string, page?: number}>>} pagesByBook - metadata-only scan records
 * @param {boolean} spread
 * @returns {string} '' when nothing is open or the page is not in the scan
 */
export function pageCrumb(selection, pagesByBook, spread) {
  if (!selection) return '';
  const pages = (pagesByBook && pagesByBook[selection.book]) || [];
  const idOf = (r) => (r.pageId != null ? String(r.pageId) : String(r.page));
  const i = pages.findIndex((r) => idOf(r) === String(selection.pageId));
  if (i < 0) return '';
  const left = `P${idOf(pages[i])}`;
  return spread && i + 1 < pages.length ? `${left}–P${idOf(pages[i + 1])}` : left;
}
