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
 *     "dismissed": { "3017/42": ["2327-018"] },
 *     "info":      { "tom": { "type": "person", "label": "Tom", "aliases": ["Thomas"], "company": "Burnell" },
 *                    "5444-006": { "name": "…", "client": "…", "active": true } }
 *   }
 *
 * `info` (v3.22.0) holds a tag's type and details, keyed by the normalized tag
 * (see "Tag info" below). A tag with no details has no entry. Phase D's
 * `blocks` will be another top-level sibling.
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
 * Whatever main read from `_tags.json` → `{ pages, dismissed, info }` holding
 * only valid keys, normalized non-empty lists and normalized info records.
 * Missing, corrupt or wrongly shaped input is three empty maps, never a thrown
 * error.
 * @param {any} raw
 * @returns {{pages: Record<string, string[]>, dismissed: Record<string, string[]>, info: Record<string, object>}}
 */
export function normalizeTagsFile(raw) {
  const ok = raw && typeof raw === 'object';
  return {
    pages: normalizeMap(ok ? raw.pages : null),
    dismissed: normalizeMap(ok ? raw.dismissed : null),
    info: normalizeInfoMap(ok ? raw.info : null)
  };
}

/* ============================================================
 *  Tag info: types and details (v3.22.0)
 * ============================================================ */

/**
 * The three tag types (docs/TRANSCRIPT-STRUCTURE-SPEC.md Phase C).
 * - **project**: the pattern alone (`isProjectTag`: job `2327-018`, proposal
 *   `P2026-141`). Never stored, never changed.
 * - **person**: a keyword whose info says `type: "person"`. The only type stored.
 * - **topic**: every other keyword (no stored type). A keyword is never a project.
 */
export const TAG_TYPES = ['project', 'person', 'topic'];

/** Longest label, alias, name, client or company, in characters. */
export const MAX_INFO_TEXT = 80;
/** Longest note. */
export const MAX_INFO_NOTE = 500;
/** Most aliases per tag. */
export const MAX_ALIASES = 20;

/*
 * Fields an info record may hold, per type (anything else is dropped):
 * - every type: `aliases` (case kept, exact duplicates dropped), `note`
 * - person: `type: "person"`, `label` (display name, case kept), `company`
 * - topic: `label`
 * - project: `name`, `client`, `active` (boolean), and on a proposal `job`
 *   (the job number it became)
 */

function cleanText(v, max = MAX_INFO_TEXT) {
  if (typeof v !== 'string') return '';
  const s = v.replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max).trim() : s;
}

function cleanNote(v) {
  if (typeof v !== 'string') return '';
  const s = v.replace(/\r\n?/g, '\n').trim();
  return s.length > MAX_INFO_NOTE ? s.slice(0, MAX_INFO_NOTE).trim() : s;
}

/**
 * Aliases as stored: trimmed, non-empty, at most MAX_ALIASES; exact
 * (case-sensitive) duplicates and the label itself dropped. A string is split
 * on commas and newlines (the Details field).
 */
export function normalizeAliases(list, label = '') {
  const raw = Array.isArray(list) ? list : typeof list === 'string' ? list.split(/[,\n]/) : [];
  const out = [];
  for (const a of raw) {
    const s = cleanText(a);
    if (s && s !== label && !out.includes(s)) out.push(s);
    if (out.length >= MAX_ALIASES) break;
  }
  return out;
}

/**
 * One tag's info record as stored, or null when nothing is left. The tag's
 * type decides which fields survive: a project number's record never holds a
 * type, and a keyword's `type` is kept only as `"person"` (topic is the
 * default, so it is never written). A label equal to the tag is dropped.
 *
 * @param {string} tag  normalized tag (the info key); anything else → null
 * @param {any} raw
 * @returns {object|null}
 */
export function normalizeTagInfo(tag, raw) {
  const t = normalizeTag(tag);
  if (!t || t !== tag || !raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const type = isProjectTag(t) ? 'project' : raw.type === 'person' ? 'person' : 'topic';
  const out = {};
  if (type === 'person') out.type = 'person';
  if (type !== 'project') {
    const label = cleanText(raw.label);
    if (label && label !== t) out.label = label;
  }
  if (type === 'person') {
    const company = cleanText(raw.company);
    if (company) out.company = company;
  }
  if (type === 'project') {
    const name = cleanText(raw.name);
    const client = cleanText(raw.client);
    if (name) out.name = name;
    if (client) out.client = client;
    if (typeof raw.active === 'boolean') out.active = raw.active;
    const job = normalizeTag(raw.job);
    if (projectKind(t) === 'proposal' && projectKind(job) === 'job') out.job = job;
  }
  const aliases = normalizeAliases(raw.aliases, out.label || '');
  if (aliases.length) out.aliases = aliases;
  const note = cleanNote(raw.note);
  if (note) out.note = note;
  return Object.keys(out).length ? out : null;
}

/** The `info` map as stored: normalized keys and records, empty ones dropped. */
export function normalizeInfoMap(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const key of Object.keys(raw)) {
    const rec = normalizeTagInfo(key, raw[key]);
    if (rec) out[key] = rec;
  }
  return out;
}

/** A tag's info record, or an empty object. */
export function infoOf(info, tag) {
  return (info && Object.prototype.hasOwnProperty.call(info, tag) && info[tag]) || {};
}

/**
 * A tag's type: 'project' by the pattern, 'person' when its info says so,
 * else 'topic'.
 * @param {string} tag
 * @param {Record<string, object>} [info]  the info map
 * @returns {'project'|'person'|'topic'}
 */
export function tagTypeOf(tag, info) {
  if (isProjectTag(tag)) return 'project';
  return infoOf(info, tag).type === 'person' ? 'person' : 'topic';
}

/** 'job' (`2327-018`), 'proposal' (`P2026-141`), or null for anything else. */
export function projectKind(tag) {
  if (!isProjectTag(tag)) return null;
  return tag.startsWith('P') ? 'proposal' : 'job';
}

/** What a chip shows: a project's number, else the stored label (capitals kept), else the tag. */
export function tagLabel(tag, info) {
  if (isProjectTag(tag)) return tag;
  return infoOf(info, tag).label || tag;
}

/** Every name a tag answers to: its key, its label (if any) and its aliases, in that order. */
export function tagNames(tag, info) {
  const rec = infoOf(info, tag);
  const out = [tag];
  if (rec.label && !out.includes(rec.label)) out.push(rec.label);
  for (const a of rec.aliases || []) if (!out.includes(a)) out.push(a);
  return out;
}

/**
 * Does `value` name this tag? Its key (`value` normalized), or its label or an
 * alias, compared case-insensitively: a search for "tom" finds Tom. (Phase D's
 * case-sensitive person match is on transcript text, not on searches.)
 */
export function tagAnswersTo(tag, info, value) {
  const v = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  if (!v) return false;
  if (normalizeTag(v) === tag) return true;
  const low = v.toLowerCase();
  return tagNames(tag, info).some((n) => n.toLowerCase() === low);
}

/** `info` with one tag's record replaced (normalized); null or an empty record removes it. */
export function withTagInfo(info, tag, record) {
  const next = { ...(info || {}) };
  const rec = record ? normalizeTagInfo(tag, record) : null;
  if (rec) next[tag] = rec;
  else delete next[tag];
  return next;
}

/**
 * `info` with a keyword's type set. 'person' adds `type` (and `label` when
 * none is stored yet: the capitals typed in "Add as Person"); 'topic' drops
 * the type and the person-only `company`. A project's type can't be set, and
 * nothing can become a project: `info` comes back unchanged.
 */
export function withTagType(info, tag, type, label = '') {
  if (!normalizeTag(tag) || isProjectTag(tag) || (type !== 'person' && type !== 'topic')) return info || {};
  const next = { ...infoOf(info, tag) };
  if (type === 'person') {
    next.type = 'person';
    if (!next.label && label) next.label = label;
  } else {
    delete next.type;
    delete next.company;
  }
  return withTagInfo(info, tag, next);
}

/**
 * Info after a rename or merge (`renameTagInMap`'s sibling, applied in the
 * same write). Onto a new name the record moves; fields the new name's type
 * can't hold are dropped (a keyword renamed to a project number loses its type
 * and label). Onto an existing tag (a merge, `exists`, or a target with info
 * of its own) the target keeps its own fields and gains the source's names as
 * aliases: its display name, its aliases, and for a person its key when no
 * target name already reads the same (case-insensitively), so "Thomas" still
 * finds the merged tag, and Phase D still matches it. The source's record goes
 * either way.
 */
export function renameTagInfo(info, from, to, exists = false) {
  const f = normalizeTag(from);
  const t = normalizeTag(to);
  const map = info || {};
  if (!f || !t || f === t || !hasOwn(map, f)) return map;
  const src = map[f];
  const next = { ...map };
  delete next[f];
  if (exists || hasOwn(next, t)) {
    const target = infoOf(next, t);
    const gained = [...(src.label ? [src.label] : []), ...(src.aliases || [])];
    const names = [...tagNames(t, next), ...gained].map((n) => n.toLowerCase());
    if (src.type === 'person' && !names.includes(f)) gained.push(f);
    return withTagInfo(next, t, { ...target, aliases: [...(target.aliases || []), ...gained] });
  }
  return withTagInfo(next, t, src);
}

const hasOwn = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);

/**
 * Is renaming onto `to` a merge? Yes when `to` is on some page OR has info of
 * its own (a tag on no page whose details were kept, v3.22.0). One rule for the
 * store's label and the tag manager's confirm.
 */
export function renameIsMerge(pages, info, to) {
  const t = normalizeTag(to);
  return !!t && (tagExists(pages, t) || hasOwn(info, t));
}

/**
 * `tagStats()` rows plus a 0-page row for each tag that has info but is on no
 * page (v3.22.0), so the tag manager can show, edit or delete it.
 */
export function withInfoOnlyTags(stats, info) {
  const have = new Set((stats || []).map((s) => s.tag));
  const extra = Object.keys(info || {}).filter((t) => !have.has(t)).map((tag) => ({ tag, pages: 0, notebooks: 0 }));
  return extra.length ? [...(stats || []), ...extra] : stats || [];
}

/** Info with a tag's record removed (the tag was deleted from every page). */
export function deleteTagInfo(info, tag) {
  const t = normalizeTag(tag);
  if (!t || !hasOwn(info, t)) return info || {};
  const next = { ...info };
  delete next[t];
  return next;
}

const sameRecord = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** The info records that differ, as main applies them: `{ tag: record }` to set, `{ tag: null }` to remove. */
export function diffTagInfo(prev, next) {
  const out = {};
  const p = prev || {};
  const n = next || {};
  for (const tag of new Set([...Object.keys(p), ...Object.keys(n)])) {
    if (!sameRecord(p[tag], n[tag])) out[tag] = n[tag] || null;
  }
  return out;
}

/**
 * Undo a failed info write: each tag it set goes back to its previous record,
 * but only where the map still holds what that write set (a later edit wins).
 */
export function rollbackInfoPatch(info, patch, prev) {
  let next = info || {};
  for (const tag of Object.keys(patch || {})) {
    if (!sameRecord(next[tag], patch[tag])) continue;
    next = { ...next };
    if (prev && prev[tag]) next[tag] = prev[tag];
    else delete next[tag];
  }
  return next;
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

/**
 * Tags after volume moves (v3.1.0). Tags stay with the source page key; only
 * when a move emptied the source page (finalizePageMoves `emptied`: no
 * strokes left, exactly one target) do they follow, and only onto a page that
 * has none, so nothing is ever overwritten. Dismissals follow the same way.
 * @param {{pages: Record<string, string[]>, dismissed: Record<string, string[]>}} maps
 * @param {Array<{fromBook, fromPage, toBook, toPage}>} moves
 * @returns {{pages: Record<string, string[]>, dismissed: Record<string, string[]>, carried: string[]}}
 *   `carried`: source keys whose tags moved
 */
export function planTagCarry({ pages = {}, dismissed = {} }, moves) {
  let p = pages;
  let d = dismissed;
  const carried = [];
  for (const m of moves || []) {
    const from = tagKey(m.fromBook, m.fromPage);
    const to = tagKey(m.toBook, m.toPage);
    if (!from || !to || from === to) continue;
    if (p[from] && !p[to]) {
      p = withPageList(withPageList(p, to, p[from]), from, []);
      carried.push(from);
    }
    if (d[from] && !d[to]) d = withPageList(withPageList(d, to, d[from]), from, []);
  }
  return { pages: p, dismissed: d, carried };
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
  { id: 'recent', label: 'Recent', title: 'Newest page written under the tag first' }
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

/* ----- Tag home display (v3.11.0): cards or pills, collapsible groups ----- */

/** Tag home display: 'cards' (thumbnail fans, the default) or 'pills' (name and counts only). */
export const TAG_VIEW_KEY = 'smartpen-library-tag-view';

/** A stored tag display, or 'cards'. */
export function parseTagView(raw) {
  return raw === 'pills' ? 'pills' : 'cards';
}

/**
 * The tag home's collapsible groups, keyed by tag type (v3.22.0): Projects,
 * People, Topics. Before 3.22 the ids were 'projects' and 'keywords'.
 */
export const TAG_GROUPS = ['project', 'person', 'topic'];
export const TAG_GROUP_LABELS = { project: 'Projects', person: 'People', topic: 'Topics' };
export const TAG_COLLAPSED_KEY = 'smartpen-library-tag-collapsed';

/** Pre-3.22 group ids: "keywords" reads as Topics. */
const OLD_GROUP_IDS = { projects: 'project', keywords: 'topic' };

/** A stored list of collapsed groups: type ids only (old ids mapped), no repeats, in group order. */
export function parseCollapsedGroups(raw) {
  if (!Array.isArray(raw)) return [];
  const ids = raw.map((g) => OLD_GROUP_IDS[g] || g);
  return TAG_GROUPS.filter((g) => ids.includes(g));
}

/**
 * Items split into the type groups, in TAG_GROUPS order, empty groups left
 * out: `[{ id, label, items }]`. `tagOf` reads an item's tag.
 */
export function groupByTagType(items, info, tagOf = (x) => x.tag) {
  const by = { project: [], person: [], topic: [] };
  for (const it of items || []) by[tagTypeOf(tagOf(it), info)].push(it);
  return TAG_GROUPS.filter((g) => by[g].length).map((id) => ({ id, label: TAG_GROUP_LABELS[id], items: by[id] }));
}

/* ----- A tag's pages: sort (v3.11.0) ----- */

/** Sorts for the pages under one tag (or Untagged), in display order. */
export const TAG_PAGE_SORT_ORDERS = [
  { id: 'notebook', label: 'Page order', title: 'By notebook, then page number' },
  { id: 'recent', label: 'Recent', title: 'Most recently written first (a page written on several days counts its latest stroke)' }
];
export const TAG_PAGE_SORT_KEY = 'smartpen-tag-page-sort';

/** A stored tag-page sort, or 'notebook'. */
export function parseTagPageSort(raw) {
  return TAG_PAGE_SORT_ORDERS.some((o) => o.id === raw) ? raw : 'notebook';
}

/**
 * `pageTiles()` entries under a tag, in the chosen order. 'notebook': notebook
 * (book key), then page, as compareRecords. 'recent': the page's latest stroke
 * (`lastMs`), newest first; ties and pages with no timed ink (last) fall back
 * to notebook order. A new array.
 */
export function sortTagPageTiles(tiles, order) {
  const byRecord = (a, b) => compareRecords(a.record, b.record);
  const list = [...(tiles || [])];
  if (order !== 'recent') return list.sort(byRecord);
  return list.sort((a, b) => {
    const am = Number.isFinite(a.lastMs) ? a.lastMs : null;
    const bm = Number.isFinite(b.lastMs) ? b.lastMs : null;
    if (am == null || bm == null) return am != null ? -1 : bm != null ? 1 : byRecord(a, b);
    return bm - am || byRecord(a, b);
  });
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

/* ----- Tag manager column sort (v3.2.0) ----- */

/** Sortable tag manager columns, and the direction a first click on each gives. */
export const TAG_STAT_COLUMNS = { tag: 'asc', type: 'asc', pages: 'desc', notebooks: 'desc' };
export const TAG_MANAGER_SORT_KEY = 'smartpen-tag-manager-sort';

/** A stored `{ by, dir }`, or most pages first. */
export function parseTagStatSort(raw) {
  const by = raw && Object.prototype.hasOwnProperty.call(TAG_STAT_COLUMNS, raw.by) ? raw.by : 'pages';
  const dir = raw && (raw.dir === 'asc' || raw.dir === 'desc') ? raw.dir : TAG_STAT_COLUMNS[by];
  return { by, dir };
}

/**
 * A header click: the same column flips direction, another column starts in
 * its natural direction (names A→Z, counts largest first).
 */
export function nextTagStatSort(current, by) {
  if (!Object.prototype.hasOwnProperty.call(TAG_STAT_COLUMNS, by)) return parseTagStatSort(current);
  if (current && current.by === by) return { by, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  return { by, dir: TAG_STAT_COLUMNS[by] };
}

/**
 * `tagStats()` rows in a column order. Name order is compareTags (project
 * numbers first, natural order); counts tie by name, A→Z either way. A new array.
 */
export function sortTagStats(rows, { by = 'pages', dir = 'desc' } = {}) {
  const sign = dir === 'asc' ? 1 : -1;
  const list = [...(rows || [])];
  if (by === 'tag') return list.sort((a, b) => sign * compareTags(a.tag, b.tag));
  if (by === 'type') {
    const rank = (r) => TAG_GROUPS.indexOf(r.type || tagTypeOf(r.tag));
    return list.sort((a, b) => sign * (rank(a) - rank(b)) || compareTags(a.tag, b.tag));
  }
  return list.sort((a, b) => sign * ((a[by] || 0) - (b[by] || 0)) || compareTags(a.tag, b.tag));
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
 * Filter choices most recently written first (v3.14.0), so a long filter row can
 * show only the first few: each tag ranks by the newest `lastMs` among the items
 * carrying it, then by count, then by name. Items without `lastMs` rank last.
 * @param {Array<{tag: string, count: number}>} choices  filterChoices()
 * @param {Array<{tags?: string[], lastMs?: number|null}>} items
 * @returns {Array<{tag: string, count: number}>} a new array
 */
export function rankFilterChoices(choices, items) {
  const newest = new Map();
  for (const it of items || []) {
    const ms = Number.isFinite(it.lastMs) ? it.lastMs : -Infinity;
    for (const t of it.tags || []) if (!newest.has(t) || ms > newest.get(t)) newest.set(t, ms);
  }
  const at = (t) => (newest.has(t) ? newest.get(t) : -Infinity);
  return [...(choices || [])].sort((a, b) =>
    (at(b.tag) - at(a.tag)) || (b.count - a.count) || compareTags(a.tag, b.tag));
}

/** How many filter chips a grid shows before "+N tags" (v3.14.0). */
export const FILTER_CHIPS_SHOWN = 8;

/**
 * Type-ahead for the tag editor: existing tags containing the typed text (the
 * exact tag first, then most used first), minus those already on the page, and whether to offer creating
 * the typed tag.
 * v3.22.0: with `info`, a tag also matches when its label or an alias contains
 * the typed text (case-insensitive), so "Thomas" offers `tom`.
 * @param {string} input
 * @param {Array<{tag: string, pages: number}>} stats  tagStats()
 * @param {string[]} have
 * @param {number} [limit]
 * @param {Record<string, object>} [info]  the info map
 * @returns {{options: Array<{tag: string, pages: number}>, create: string|null}}
 */
export function tagOptions(input, stats, have = [], limit = 6, info = null) {
  const q = normalizeTag(input);
  const typed = String(input || '').trim();
  const has = new Set(have);
  // Typed text that is no tag at all ("??") matches nothing.
  if (typed && !q) return { options: [], create: null };
  const needle = typed ? q.toLowerCase() : '';
  const low = typed.replace(/\s+/g, ' ').toLowerCase();
  const named = (tag) => !!info && tagNames(tag, info).slice(1).some((n) => n.toLowerCase().includes(low));
  const matches = (stats || [])
    .filter((s) => !has.has(s.tag) && (!needle || s.tag.toLowerCase().includes(needle) || named(s.tag)));
  // The exact tag first, so the highlighted row is what Enter adds.
  const exact = matches.findIndex((s) => s.tag === q);
  if (exact > 0) matches.unshift(matches.splice(exact, 1)[0]);
  const options = matches.slice(0, limit);
  const exists = q && (stats || []).some((s) => s.tag === q);
  return { options, create: q && !exists && !has.has(q) ? q : null };
}

/**
 * The "new tag" rows under the type-ahead (v3.22.0): a project number is one
 * row (its type is the pattern); a new keyword gets "Add as Topic" (what Enter
 * adds) and "Add as Person", whose label is the text as typed, capitals kept
 * ("Tom" → tag `tom`, label "Tom").
 * @param {string|null} create  tagOptions().create
 * @param {string} typed  the field's text
 * @returns {Array<{tag: string, create: 'project'|'topic'|'person', label?: string}>}
 */
export function createRows(create, typed) {
  if (!create) return [];
  if (isProjectTag(create)) return [{ tag: create, create: 'project' }];
  const label = cleanText(typed);
  return [{ tag: create, create: 'topic' }, { tag: create, create: 'person', label: label || create }];
}

/**
 * The tag Enter adds in a tag field: the highlighted row when the user moved
 * to it with ↑ ↓, else exactly what was typed (normalized), never a longer
 * tag that merely starts with it. null when there is nothing to add.
 * @param {Array<{tag: string}>} items  the list as shown
 * @param {number} hi  highlighted index
 * @param {boolean} navigated  ↑ / ↓ used since the last add
 * @param {string} text  the field's text
 */
export function tagEnterChoice(items, hi, navigated, text) {
  if (navigated && items && items[hi]) return items[hi].tag;
  return normalizeTag(text) || null;
}

/** Backspace in an empty tag field removes the last tag, once per key press (not on auto-repeat). */
export function backspaceRemovesTag(e, text) {
  return !!e && e.key === 'Backspace' && !e.repeat && text === '';
}
