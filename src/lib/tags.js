/**
 * tags — page tags: keywords and project numbers on pages (v3.1.0). Pure: no
 * DOM, no stores, no I/O.
 *
 * Tags are display metadata, like a page's rotation: they live in the
 * `pages/_tags.json` sidecar (electron/main.cjs, electron/tags-sidecar.cjs),
 * keyed by page key `"<bookKey>/<pageId>"`, and are never written into a
 * PageDoc. A page with no tags has no entry.
 *
 *   {
 *     "version": 1,
 *     "pages":     { "3017/42": ["P2026-141", "beam"], "388v2/7": ["2327-018"] },
 *     "dismissed": { "3017/42": ["2327-018"] }
 *   }
 *
 * This module owns the format: normalizing a tag, the per-page lists, every
 * edit (add, remove, rename, merge, delete) as a map → map function, the patch
 * a store sends to main, project-number suggestions from transcript text, and
 * what the Library derives from tags (index, cards, filters).
 *
 * Tested in `src/lib/__tests__/tags.test.js`.
 */

import { orientationKey, parseOrientationKey } from './page-orientation.js';
import { compareBookKeys } from './volumes.js';
import { pageKeyOf } from './library-home.js';

/** Sidecar format version. */
export const TAGS_VERSION = 1;

/** Longest keyword, in characters. */
export const MAX_TAG_LENGTH = 40;

/** A normalized project number: proposal `P2026-141` or job `2327-018`. */
const PROJECT_TAG_RE = /^P?\d{4}-\d{3}$/;

/** The dashes a hand-written or recognised number may carry: – — − (and -). */
const DASHES_RE = /[‐-―−]/g;

/* ============================================================
 *  Normalizing
 * ============================================================ */

/**
 * One tag as stored, or null when nothing is left.
 *
 * - Project number: `[[P2026-141]]`, `p 2026–141` → `P2026-141`; `2327-018`
 *   stays a job number (no P added). Whitespace and dash types are tolerated;
 *   letters standing for digits (`P2O26-141`) are not.
 * - Keyword: trimmed, lowercase, whitespace runs → `-`, accents dropped, only
 *   `a-z 0-9 - _` kept, at most MAX_TAG_LENGTH characters.
 *
 * @param {unknown} raw
 * @returns {string|null}
 */
export function normalizeTag(raw) {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  let s = String(raw).trim().replace(/^\[\[\s*/, '').replace(/\s*\]\]$/, '').replace(/^#/, '');
  s = s.replace(DASHES_RE, '-');

  const m = s.replace(/\s+/g, '').match(/^([Pp]?)(\d{4})-(\d{3})$/);
  if (m) return `${m[1] ? 'P' : ''}${m[2]}-${m[3]}`;

  const kw = s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_TAG_LENGTH)
    .replace(/-+$/, '');
  return kw || null;
}

/** True for a normalized project number (`P2026-141`, `2327-018`). */
export function isProjectTag(tag) {
  return typeof tag === 'string' && PROJECT_TAG_RE.test(tag);
}

/** Project numbers first, then keywords; each group in natural order. */
export function compareTags(a, b) {
  const pa = isProjectTag(a);
  const pb = isProjectTag(b);
  if (pa !== pb) return pa ? -1 : 1;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' }) ||
    (a < b ? -1 : a > b ? 1 : 0);
}

/**
 * A page's tag list as stored: normalized, de-duplicated, sorted. Anything
 * that does not normalize is dropped.
 * @param {unknown} list
 * @returns {string[]}
 */
export function normalizeTagList(list) {
  if (!Array.isArray(list)) return [];
  const out = new Set();
  for (const t of list) {
    const n = normalizeTag(t);
    if (n) out.add(n);
  }
  return [...out].sort(compareTags);
}

/* ============================================================
 *  Page keys and the sidecar
 * ============================================================ */

/**
 * The sidecar key for a page, `"388v2/151b"`: the same key and validation as
 * `_orientation.json` (book key by volumes.js, page id digits + one letter).
 * @returns {string|null}
 */
export const tagKey = orientationKey;

/** `"388v2/151b"` → `{ book: "388v2", pageId: "151b" }`, or null. */
export const parseTagKey = parseOrientationKey;

/** The tag key of a scan record. */
export function recordTagKey(record) {
  if (!record) return null;
  return tagKey(record.book, record.pageId != null ? record.pageId : record.page);
}

function normalizeMap(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const key of Object.keys(raw)) {
    const parsed = parseTagKey(key);
    if (!parsed) continue;
    const list = normalizeTagList(raw[key]);
    if (list.length) out[`${parsed.book}/${parsed.pageId}`] = list;
  }
  return out;
}

/**
 * Whatever main read from `_tags.json` → `{ pages, dismissed }` holding only
 * valid keys and normalized, non-empty lists. Missing, corrupt or wrongly
 * shaped input is two empty maps, never a thrown error.
 * @param {any} raw
 * @returns {{pages: Record<string, string[]>, dismissed: Record<string, string[]>}}
 */
export function normalizeTagsFile(raw) {
  const ok = raw && typeof raw === 'object';
  return {
    pages: normalizeMap(ok ? raw.pages : null),
    dismissed: normalizeMap(ok ? raw.dismissed : null)
  };
}

/* ============================================================
 *  Edits: map → map (never mutate the input)
 * ============================================================ */

/** `map` with one page's list replaced; an empty list removes the entry. */
export function withPageList(map, key, list) {
  const next = { ...(map || {}) };
  const tags = normalizeTagList(list);
  if (tags.length) next[key] = tags;
  else delete next[key];
  return next;
}

/** Add a tag to each of `keys`. */
export function addTagToKeys(map, keys, tag) {
  const t = normalizeTag(tag);
  if (!t) return map || {};
  let next = map || {};
  for (const key of keys || []) {
    const cur = next[key] || [];
    if (!cur.includes(t)) next = withPageList(next, key, [...cur, t]);
  }
  return next;
}

/** Remove a tag from each of `keys`. */
export function removeTagFromKeys(map, keys, tag) {
  const t = normalizeTag(tag);
  if (!t) return map || {};
  let next = map || {};
  for (const key of keys || []) {
    const cur = next[key];
    if (cur && cur.includes(t)) next = withPageList(next, key, cur.filter((x) => x !== t));
  }
  return next;
}

/**
 * Rename a tag on every page. Renaming onto a tag that already exists is a
 * merge: pages that had both keep one.
 */
export function renameTagInMap(map, from, to) {
  const f = normalizeTag(from);
  const t = normalizeTag(to);
  if (!f || !t || f === t) return map || {};
  let next = map || {};
  for (const key of Object.keys(next)) {
    const cur = next[key];
    if (cur.includes(f)) next = withPageList(next, key, cur.map((x) => (x === f ? t : x)));
  }
  return next;
}

/** Remove a tag from every page. */
export function deleteTagFromMap(map, tag) {
  return removeTagFromKeys(map, Object.keys(map || {}), tag);
}

/** True when `tag` is on some page of `map`. */
export function tagExists(map, tag) {
  const t = normalizeTag(tag);
  return !!t && Object.values(map || {}).some((list) => list.includes(t));
}

const sameList = (a, b) => (a || []).length === (b || []).length && (a || []).every((x, i) => x === b[i]);

/**
 * The entries that differ between two maps, as main applies them:
 * `{ key: tags[] }` to set, `{ key: null }` to remove.
 * @returns {Record<string, string[]|null>}
 */
export function diffTagMaps(prev, next) {
  const out = {};
  const p = prev || {};
  const n = next || {};
  for (const key of new Set([...Object.keys(p), ...Object.keys(n)])) {
    if (!sameList(p[key], n[key])) out[key] = n[key] ? [...n[key]] : null;
  }
  return out;
}

/**
 * Undo a failed write: for each key it set, put back the previous list, but
 * only where the map still holds what that write set (a later edit to the same
 * page wins).
 */
export function rollbackPatch(map, patch, prev) {
  let next = map || {};
  for (const key of Object.keys(patch || {})) {
    if (!sameList(next[key], patch[key] || undefined)) continue;
    next = withPageList(next, key, (prev && prev[key]) || []);
  }
  return next;
}

/* ============================================================
 *  Suggestions: project numbers in transcript text
 * ============================================================ */

/**
 * A project number in running text: not after a letter or digit, an optional
 * P (any case) and one optional space, four digits, a dash of any kind,
 * exactly three digits, and no digit after. `2026-10-21` (date), `555-1234`,
 * `12345-678` and `P2O26-141` do not match.
 */
const PROJECT_IN_TEXT_RE = /(?<![\p{L}\p{N}])([Pp]\s?)?(\d{4})[-‐-―−](\d{3})(?!\d)/gu;

/**
 * Project numbers in one string, in order.
 * @returns {Array<{tag: string, start: number, end: number}>}
 */
export function findProjectNumbers(text) {
  const out = [];
  if (typeof text !== 'string' || !text) return out;
  for (const m of text.matchAll(PROJECT_IN_TEXT_RE)) {
    out.push({ tag: `${m[1] ? 'P' : ''}${m[2]}-${m[3]}`, start: m.index, end: m.index + m[0].length });
  }
  return out;
}

/**
 * Project numbers a page's transcript suggests as tags: one per distinct
 * number, first occurrence wins, skipping anything in `exclude` (the page's
 * tags and its dismissals). Pattern only: nothing is validated.
 *
 * @param {Array<{id?: string, text?: string}>|string} lines  transcript lines,
 *   or a scan record's `transcriptionText` (one line per `\n`, no ids)
 * @param {{exclude?: Iterable<string>}} [opts]
 * @returns {Array<{tag: string, lineId: string|null, line: string, start: number, end: number}>}
 */
export function suggestProjectNumbers(lines, { exclude = [] } = {}) {
  const list = typeof lines === 'string'
    ? lines.split('\n').map((text) => ({ id: null, text }))
    : Array.isArray(lines) ? lines : [];
  const skip = new Set(exclude);
  const seen = new Set();
  const out = [];
  for (const l of list) {
    const text = l && typeof l.text === 'string' ? l.text : '';
    for (const hit of findProjectNumbers(text)) {
      if (seen.has(hit.tag)) continue;
      seen.add(hit.tag);
      if (skip.has(hit.tag)) continue;
      const lead = text.length - text.trimStart().length;
      out.push({ tag: hit.tag, lineId: l.id ?? null, line: text.trim(), start: hit.start - lead, end: hit.end - lead });
    }
  }
  return out;
}

/**
 * A suggestion's line split around the number, for highlighting without HTML.
 * Long lines are trimmed to about `max` characters around the match.
 * @returns {{before: string, match: string, after: string}}
 */
export function splitSuggestionLine(s, max = 90) {
  const line = (s && s.line) || '';
  const start = Math.max(0, Math.min(s?.start ?? 0, line.length));
  const end = Math.max(start, Math.min(s?.end ?? start, line.length));
  let before = line.slice(0, start);
  let after = line.slice(end);
  const room = Math.max(10, max - (end - start));
  if (before.length > room / 2) before = `…${before.slice(-Math.floor(room / 2))}`;
  if (after.length > room / 2) after = `${after.slice(0, Math.ceil(room / 2))}…`;
  return { before, match: line.slice(start, end), after };
}

/* ============================================================
 *  Derived: index, cards, untagged, filters
 * ============================================================ */

const idOf = (r) => (r.pageId != null ? String(r.pageId) : String(r.page));

/** Scan records in reading order: notebook, then page, then suffix. */
export function compareRecords(a, b) {
  return compareBookKeys(a.book, b.book) || (a.page - b.page) ||
    String(a.suffix || '').localeCompare(String(b.suffix || ''));
}

/**
 * tag → page keys, built once per change of the tag map.
 * @param {Record<string, string[]>} map
 * @returns {Map<string, string[]>}
 */
export function buildTagIndex(map) {
  const index = new Map();
  for (const key of Object.keys(map || {})) {
    for (const t of map[key]) {
      if (!index.has(t)) index.set(t, []);
      index.get(t).push(key);
    }
  }
  return index;
}

/**
 * The scan records under a tag, in reading order. Keys with no page on disk
 * (a page deleted since it was tagged) are skipped.
 * @param {string[]} keys
 * @param {Map<string, object>} records  `recordsByKey`
 */
export function recordsForKeys(keys, records) {
  const out = [];
  for (const k of keys || []) {
    const r = records && records.get(k);
    if (r) out.push(r);
  }
  return out.sort(compareRecords);
}

/** Pages with no tag, in reading order. */
export function untaggedRecords(records, map) {
  const m = map || {};
  return (records || []).filter((r) => !m[pageKeyOf(r.book, idOf(r))]).sort(compareRecords);
}

function fanOf(records, dates) {
  const timed = records
    .map((r, i) => ({ r, i, ms: dates?.get(pageKeyOf(r.book, idOf(r)))?.lastMs ?? null }))
    .filter((t) => t.ms != null)
    .sort((a, b) => b.ms - a.ms || b.i - a.i);
  const fan = timed.slice(0, 3).map((t) => t.r);
  for (let i = records.length - 1; fan.length < 3 && i >= 0; i--) {
    if (!fan.includes(records[i])) fan.push(records[i]);
  }
  return { fan, lastMs: timed.length ? timed[0].ms : null };
}

/**
 * One card per tag that is on at least one page on disk.
 * @param {Map<string, string[]>} index  buildTagIndex()
 * @param {Map<string, object>} records  every scan record by page key
 * @param {Map} [dates]  pageDates() of the unfiltered capture-date index
 * @returns {Array<{tag: string, project: boolean, pageCount: number, notebookCount: number, lastMs: number|null, fan: object[]}>}
 */
export function tagCards(index, records, dates = null) {
  const out = [];
  for (const [tag, keys] of index || []) {
    const recs = recordsForKeys(keys, records);
    if (!recs.length) continue;
    const { fan, lastMs } = fanOf(recs, dates);
    out.push({
      tag,
      project: isProjectTag(tag),
      pageCount: recs.length,
      notebookCount: new Set(recs.map((r) => String(r.book))).size,
      lastMs,
      fan
    });
  }
  return out;
}

/** The Untagged card: count, notebooks, fan. */
export function untaggedCard(records, map, dates = null) {
  const recs = untaggedRecords(records, map);
  const { fan, lastMs } = fanOf(recs, dates);
  return {
    pageCount: recs.length,
    notebookCount: new Set(recs.map((r) => String(r.book))).size,
    lastMs,
    fan
  };
}

/** Sort chips in tag grouping. "Recent" uses the newest page written under the tag. */
export const TAG_SORT_ORDERS = [
  { id: 'pages', label: 'Most pages' },
  { id: 'name', label: 'Name' },
  { id: 'recent', label: 'Recently written' }
];

export const TAG_SORT_KEY = 'smartpen-library-tag-sort';
export const LIBRARY_GROUP_KEY = 'smartpen-library-group';

/** A stored tag sort, or 'pages'. */
export function parseTagSort(raw) {
  return TAG_SORT_ORDERS.some((o) => o.id === raw) ? raw : 'pages';
}

/** A stored grouping: 'book' (default) or 'tag'. */
export function parseGroupBy(raw) {
  return raw === 'tag' ? 'tag' : 'book';
}

const byTag = (a, b) => compareTags(a.tag, b.tag);

/** Cards in the chosen order; ties by name. A new array. */
export function sortTagCards(cards, order) {
  const list = [...(cards || [])];
  if (order === 'name') return list.sort(byTag);
  if (order === 'recent') {
    return list.sort((a, b) => {
      if (a.lastMs == null || b.lastMs == null) return a.lastMs != null ? -1 : b.lastMs != null ? 1 : byTag(a, b);
      return b.lastMs - a.lastMs || byTag(a, b);
    });
  }
  return list.sort((a, b) => b.pageCount - a.pageCount || byTag(a, b));
}

/**
 * Per tag: how many pages and notebooks carry it, straight from the sidecar
 * (the tag manager's table). Most-used first.
 * @returns {Array<{tag: string, pages: number, notebooks: number}>}
 */
export function tagStats(map) {
  const out = [];
  for (const [tag, keys] of buildTagIndex(map)) {
    const books = new Set(keys.map((k) => parseTagKey(k)?.book));
    out.push({ tag, pages: keys.length, notebooks: books.size });
  }
  return out.sort((a, b) => b.pages - a.pages || compareTags(a.tag, b.tag));
}

/**
 * Items whose tags match the chosen filter: 'any' = at least one chosen tag,
 * 'all' = every chosen tag. No chosen tags = everything.
 * @template {{tags: string[]}} T
 * @param {T[]} items
 * @param {string[]} chosen
 * @param {'any'|'all'} mode
 * @returns {T[]}
 */
export function filterByTags(items, chosen, mode = 'any') {
  if (!chosen || !chosen.length) return items || [];
  return (items || []).filter((it) => {
    const tags = it.tags || [];
    return mode === 'all' ? chosen.every((c) => tags.includes(c)) : chosen.some((c) => tags.includes(c));
  });
}

/**
 * The filter chips to offer: tags present in the grid, with counts, minus the
 * chosen ones. In 'all' mode only tags found on the pages that still match
 * (so a click can never empty the grid), counted among those pages.
 * @returns {Array<{tag: string, count: number}>}
 */
export function filterChoices(items, chosen = [], mode = 'any') {
  const pool = mode === 'all' && chosen.length ? filterByTags(items, chosen, 'all') : items || [];
  const counts = new Map();
  for (const it of pool) for (const t of it.tags || []) counts.set(t, (counts.get(t) || 0) + 1);
  return [...counts]
    .filter(([t]) => !chosen.includes(t))
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => compareTags(a.tag, b.tag));
}

/**
 * Type-ahead for the tag editor: existing tags containing the typed text (most
 * used first), minus those already on the page, and whether to offer creating
 * the typed tag.
 * @param {string} input
 * @param {Array<{tag: string, pages: number}>} stats  tagStats()
 * @param {string[]} have
 * @returns {{options: Array<{tag: string, pages: number}>, create: string|null}}
 */
export function tagOptions(input, stats, have = [], limit = 6) {
  const q = normalizeTag(input);
  const typed = String(input || '').trim();
  const has = new Set(have);
  const needle = typed ? (q || '').toLowerCase() : '';
  const options = (stats || [])
    .filter((s) => !has.has(s.tag) && (!needle || s.tag.toLowerCase().includes(needle)))
    .slice(0, limit);
  const exists = q && (stats || []).some((s) => s.tag === q);
  return { options, create: q && !exists && !has.has(q) ? q : null };
}
