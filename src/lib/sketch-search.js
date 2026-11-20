/**
 * sketch-search — sketches across the library, from scan records alone
 * (v3.24.0, docs/TRANSCRIPT-STRUCTURE-SPEC.md E.5). Pure: no stores, no IO.
 *
 * Each scan record carries `sketches: [{ id, label, lineIndex }]` (at most 20,
 * built in main). A sketch's tags (E.4) are the page's tags that cover its
 * line: Projects and People by block scope (lib/tag-scope.js, Phase D: the
 * block it sits in, or the whole page when the tag is named nowhere on it),
 * Topics always (they have no block scope). Scope is read from the record's
 * `transcriptionText` (or, for a page with hand corrections, its lines with ids),
 * so nothing here reads a page.
 *
 * Search (`matchSketches`):
 *   has:sketch                 every sketch
 *   has:sketch 6226-001        sketches whose tags (or label) answer to every word
 *   has:sketch person:isaiah   facets must each be met by one of the sketch's tags
 *   has:sketch weld            label words
 *   weld                       without has:sketch: sketches whose label holds every word
 *
 * Tested in src/lib/__tests__/sketch-search.test.js.
 */

import { linesFromText, pageScopes } from './tag-scope.js';
import { tagTypeOf, tagNames } from './tags.js';
import { facetTakesTag } from './search-query.js';
import { normalizeSketchSummary } from './line-kinds.js';

export const SKETCH_RESULTS_MAX = 24;

const idOf = (r) => (r.pageId != null ? String(r.pageId) : String(r.page));
const keyOf = (r) => `${r.book}/${idOf(r)}`;

/**
 * The tags of each sketch on one page.
 * @param {object} record  a scan record (with `sketches`)
 * @param {{ pageTags?: Record<string, string[]>, info?: object, blocks?: object, scopeLines?: Map|null }} ctx
 * @returns {Map<string, string[]>}  sketch id → tags (sorted)
 */
export function sketchTagsOf(record, { pageTags = {}, info = {}, blocks = {}, scopeLines = null } = {}) {
  const key = keyOf(record);
  const tags = (pageTags && pageTags[key]) || [];
  const out = new Map();
  const sketches = normalizeSketchSummary(record.sketches);
  if (!sketches.length) return out;
  const lines = (scopeLines && scopeLines.get(key)) || linesFromText(record.transcriptionText);
  const scopes = pageScopes(lines, tags, info, (blocks && blocks[key]) || {});
  for (const s of sketches) {
    const mine = tags.filter((t) => {
      const sc = scopes[t];
      if (sc) return sc.covered.has(s.lineIndex);
      return tagTypeOf(t, info) === 'topic';
    });
    out.set(s.id, mine.sort());
  }
  return out;
}

/**
 * Every sketch in the library, one entry each.
 * @param {Array<object>} records  the scan
 * @param {object} ctx  see sketchTagsOf
 * @returns {Array<{ key: string, record: object, id: string, label: string, lineIndex: number, tags: string[] }>}
 */
export function sketchEntries(records, ctx = {}) {
  const out = [];
  for (const r of records || []) {
    if (!r || !Array.isArray(r.sketches) || !r.sketches.length) continue;
    const tagsOf = sketchTagsOf(r, ctx);
    for (const s of normalizeSketchSummary(r.sketches)) {
      out.push({ key: keyOf(r), record: r, id: s.id, label: s.label, lineIndex: s.lineIndex, tags: tagsOf.get(s.id) || [] });
    }
  }
  return out;
}

/** Does a word name one of these tags (key, label or alias contain it)? */
function wordInTags(word, tags, info) {
  return tags.some((t) => tagNames(t, info).some((n) => n.toLowerCase().includes(word)));
}

/**
 * The sketches a parsed query finds, newest page first.
 * @param {ReturnType<typeof sketchEntries>} entries
 * @param {{ tokens: string[], facets?: Array, has?: string[], days?: string[] }} q  parseSearchQuery()
 * @param {{ info?: object, dates?: Map|null, onDays?: Set<string>|null }} [opts]  `onDays`: page keys written on the query's days
 */
export function matchSketches(entries, q, { info = {}, dates = null, onDays = null } = {}) {
  if (!q) return [];
  const has = (q.has || []).includes('sketch');
  const tokens = q.tokens || [];
  const facets = q.facets || [];
  // Without has:sketch, only words that are in a label bring sketches up.
  if (!has && !tokens.length) return [];
  const hits = (entries || []).filter((e) => {
    if (onDays && !onDays.has(e.key)) return false;
    if (!facets.every((f) => e.tags.some((t) => facetTakesTag(f, t, info)))) return false;
    const label = e.label.toLowerCase();
    return tokens.every((w) => label.includes(w) || (has && wordInTags(w, e.tags, info)));
  });
  const last = (k) => (dates && dates.get(k) && dates.get(k).lastMs) || 0;
  return hits
    .sort((a, b) => last(b.key) - last(a.key) || (a.key < b.key ? -1 : a.key > b.key ? 1 : a.lineIndex - b.lineIndex))
    .slice(0, SKETCH_RESULTS_MAX);
}

/**
 * The sketches carrying a tag, for a tag page's Sketches strip, newest first.
 * @param {Array<object>} records  the pages carrying the tag
 * @param {string} tag
 * @param {object} ctx  see sketchTagsOf, plus `dates`
 */
export function sketchesOfTag(records, tag, ctx = {}) {
  const entries = sketchEntries(records, ctx).filter((e) => e.tags.includes(tag));
  const last = (k) => (ctx.dates && ctx.dates.get(k) && ctx.dates.get(k).lastMs) || 0;
  return entries.sort((a, b) => last(b.key) - last(a.key) || a.lineIndex - b.lineIndex);
}
