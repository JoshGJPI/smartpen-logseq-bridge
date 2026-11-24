/**
 * Timeline tag filter (pure): the date features narrowed to pages carrying a
 * tag, and the tags the filter offers.
 *
 * Kept apart from timeline.js because it reads page tags (lib/tags.js imports
 * library-home.js, which imports timeline.js). Tested in
 * `src/lib/__tests__/timeline-tags.test.js`.
 */
import { timelinePages, inRange } from './timeline.js';
import { tagKey, compareTags } from './tags.js';

/** A timeline page entry's tags from the `pageTags` map (`_tags.json` pages). */
function entryTags(p, pageTags) {
  if (!pageTags) return [];
  const key = tagKey(p.book, p.pageId != null ? p.pageId : p.page);
  const list = key && pageTags[key];
  return Array.isArray(list) ? list : [];
}

/**
 * The index with only the pages that carry at least one of `selected` tags —
 * the date features' tag filter (any of, not all of). Applied after the book
 * filter, so what the feed shows is still what a load brings in. Same object
 * back when no tag is chosen.
 *
 * @param {Object|null} index
 * @param {Set<string>|null} selected  normalized tags
 * @param {Record<string, string[]>} pageTags  page key → tags
 */
export function filterIndexByTags(index, selected, pageTags) {
  if (!index || !selected || selected.size === 0) return index;
  const pages = {};
  for (const [key, p] of Object.entries(index.pages || {})) {
    if (p && entryTags(p, pageTags).some((t) => selected.has(t))) pages[key] = p;
  }
  return { ...index, pages };
}

/**
 * The tag filter's rows: every tag on a page of `index` (pass the
 * book-filtered index, so a tag only in left-out notebooks is never offered),
 * with how many of its pages hold ink in `[from, to]`. Tags in `keep` (the
 * chosen ones) are always listed, at 0 when no page here has them, so a choice
 * can still be unticked after its notebook is left out.
 *
 * @returns {Array<{tag: string, pages: number, inRange: number}>}
 */
export function indexTags(index, pageTags, from = null, to = null, keep = null) {
  const acc = new Map();
  for (const p of timelinePages(index)) {
    const tags = entryTags(p, pageTags);
    if (tags.length === 0) continue;
    const hit = !!from && !!to && Object.keys(p.days).some((d) => (p.days[d] || 0) > 0 && inRange(d, from, to));
    for (const tag of tags) {
      const e = acc.get(tag) || { tag, pages: 0, inRange: 0 };
      e.pages += 1;
      if (hit) e.inRange += 1;
      acc.set(tag, e);
    }
  }
  for (const tag of keep || []) if (!acc.has(tag)) acc.set(tag, { tag, pages: 0, inRange: 0 });
  return [...acc.values()].sort((a, b) => compareTags(a.tag, b.tag));
}
