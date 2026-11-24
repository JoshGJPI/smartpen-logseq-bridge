/**
 * Timeline tag filter (pure): the date features narrowed to pages carrying a
 * tag, and the tags the filter offers.
 *
 * Kept apart from timeline.js because it reads page tags (lib/tags.js imports
 * library-home.js, which imports timeline.js). Tested in
 * `src/lib/__tests__/timeline-tags.test.js`.
 */
import { timelinePages, inRange, dayKey } from './timeline.js';
import { pageScopes } from './tag-scope.js';
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

/* ============================================================
 *  Block scope in the Timeline (v3.26.0)
 * ============================================================ */

/** Ncode units around a block's linked ink in which unlinked ink (an underline, a box) still counts. */
export const SCOPE_PAD = 3;

function strokeBox(stroke) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of (stroke && stroke.points) || []) {
    if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || (p[0] < 0 && p[1] < 0)) continue;
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  return Number.isFinite(minX) ? { minX, maxX, minY, maxY } : null;
}

/**
 * The strokes of a page that belong to `tags`' blocks (lib/tag-scope.js), for
 * the Timeline under a tag filter. Union over the tags.
 *
 * - A stroke linked to a covered line is in; one linked to another line is out.
 * - Unlinked ink (not yet transcribed, Not text, a dangling link) is in when its
 *   centre lies inside a block's linked ink box, padded by `SCOPE_PAD`: the
 *   underline under a project heading goes with it, a note written later in the
 *   margin of another block does not.
 * - Not narrowed (`strokes: null`, every stroke counts) when a tag covers the
 *   whole page (named nowhere on it), the page has no transcript, or its links
 *   can't be trusted (`trusted` false: transcribed before the fixed matcher and
 *   not relinked).
 *
 * @param {{strokes?: Array, transcript?: {lines?: Array}}} doc
 * @param {string[]} tags  the chosen tags that are on this page
 * @param {{info?: object, corrections?: object, trusted?: boolean}} opts
 * @returns {{strokes: Set<object>|null, why: 'scoped'|'whole-page'|'untranscribed'|'untrusted'|'no-tag'}}
 */
export function scopedStrokes(doc, tags, { info = {}, corrections = {}, trusted = true } = {}) {
  if (!tags || !tags.length) return { strokes: null, why: 'no-tag' };
  const lines = (doc && doc.transcript && Array.isArray(doc.transcript.lines)) ? doc.transcript.lines : [];
  if (!lines.length) return { strokes: null, why: 'untranscribed' };
  const scopes = Object.values(pageScopes(lines, tags, info, corrections || {}));
  if (!scopes.length || scopes.some((s) => s.wholePage)) return { strokes: null, why: 'whole-page' };
  if (!trusted) return { strokes: null, why: 'untrusted' };

  const lineIds = new Set(lines.map((l) => l && l.id).filter(Boolean));
  const blockOf = new Map();   // covered line id → block number
  let n = 0;
  for (const s of scopes) {
    for (const b of s.blocks) {
      for (let i = b.root; i < b.end; i++) if (lines[i] && lines[i].id) blockOf.set(lines[i].id, n);
      n++;
    }
  }
  const strokes = (doc && Array.isArray(doc.strokes)) ? doc.strokes : [];
  const out = new Set();
  const boxes = [];
  const loose = [];
  for (const st of strokes) {
    const id = st && st.lineId;
    if (id && lineIds.has(id)) {
      if (!blockOf.has(id)) continue;
      out.add(st);
      const b = strokeBox(st);
      if (!b) continue;
      const k = blockOf.get(id);
      const box = boxes[k];
      if (!box) boxes[k] = { ...b };
      else {
        if (b.minX < box.minX) box.minX = b.minX;
        if (b.maxX > box.maxX) box.maxX = b.maxX;
        if (b.minY < box.minY) box.minY = b.minY;
        if (b.maxY > box.maxY) box.maxY = b.maxY;
      }
    } else {
      loose.push(st);
    }
  }
  const pads = boxes.filter(Boolean);
  for (const st of loose) {
    const b = strokeBox(st);
    if (!b) continue;
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    if (pads.some((p) => cx >= p.minX - SCOPE_PAD && cx <= p.maxX + SCOPE_PAD && cy >= p.minY - SCOPE_PAD && cy <= p.maxY + SCOPE_PAD)) {
      out.add(st);
    }
  }
  return { strokes: out, why: 'scoped' };
}

/** `{ day: count }` for strokes by local capture day (startTime), as the index stores it. */
export function dayHistogram(strokes) {
  const days = {};
  for (const st of strokes || []) {
    const t = Number(st && st.startTime);
    if (!Number.isFinite(t) || t <= 0) continue;
    const d = dayKey(t);
    if (d) days[d] = (days[d] || 0) + 1;
  }
  return days;
}

/**
 * The index with each page's day histogram replaced by its scoped one, so the
 * activity grid, tallies and feed count only the tagged blocks' ink.
 * `scopeOf(key, entry)` returns `{ days }` (a page with no scoped ink has `{}`
 * and is dropped) or undefined when not known yet: such pages are left out and
 * listed in `missing`, so a page-level count never shows in their place.
 *
 * @returns {{index: Object|null, missing: string[]}}
 */
export function scopeIndex(index, scopeOf) {
  if (!index) return { index, missing: [] };
  const pages = {};
  const missing = [];
  for (const [key, p] of Object.entries(index.pages || {})) {
    if (!p) continue;
    const s = scopeOf(key, p);
    if (!s) { missing.push(key); continue; }
    if (!s.days || !Object.keys(s.days).length) continue;
    const strokes = Object.values(s.days).reduce((a, b) => a + b, 0);
    // first / last stroke are page-wide; readers fall back to the days (library-home pageDates).
    pages[key] = { ...p, days: s.days, strokes, firstStroke: null, lastStroke: null };
  }
  return { index: { ...index, pages }, missing };
}

/**
 * A feed day's pages narrowed to the chosen tags' blocks: each page's doc for
 * `daySessions()` keeps only its scoped strokes (the rest of the page stays in
 * the card as grey context, from the full doc), and `why` says per page key
 * whether it was narrowed. No chosen tag = the pages unchanged.
 *
 * @param {Array<{book: string, pageId: string, doc: Object}>} pages
 * @param {Set<string>} chosen
 * @param {{pageTags?: object, info?: object, blocks?: object, trusted?: (doc: Object) => boolean}} ctx
 * @returns {{pages: Array, why: Map<string, string>}}
 */
export function narrowDayPages(pages, chosen, { pageTags = {}, info = {}, blocks = {}, trusted = () => true } = {}) {
  const why = new Map();
  if (!chosen || chosen.size === 0) return { pages, why };
  const out = (pages || []).map((p) => {
    const key = tagKey(p.book, p.pageId);
    const tags = ((pageTags && pageTags[key]) || []).filter((t) => chosen.has(t));
    const res = scopedStrokes(p.doc, tags, { info, corrections: (blocks && blocks[key]) || {}, trusted: trusted(p.doc) });
    why.set(`${p.book}/${p.pageId}`, res.why);
    if (!res.strokes) return p;
    return { ...p, doc: { ...p.doc, strokes: p.doc.strokes.filter((s) => res.strokes.has(s)) } };
  });
  return { pages: out, why };
}
