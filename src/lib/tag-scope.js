/**
 * tag-scope — which lines of a page a tag covers (v3.23.0,
 * docs/TRANSCRIPT-STRUCTURE-SPEC.md Phase D.1). Pure: no DOM, no stores, no I/O.
 *
 * A Project or Person tag on a page covers **blocks**, not the whole page, when
 * its name is written there:
 *
 * - **Roots**: lines whose text names the tag. A project: `findProjectNumbers()`
 *   on the line finds the tag. A person: the display name or an alias as a whole
 *   word, **case-sensitive** (decision 4: "Rich update" names Rich, "rich mix"
 *   does not), a possessive allowed ("Tom's"). A person with no display name
 *   answers to its key capitalised ("isaiah" → "Isaiah"). Topics have no block scope (null).
 * - **Block**: a root and every following line with a deeper indent, up to the
 *   next line at the root's indent or shallower. A root that is itself a child
 *   covers only itself and its own children.
 * - **Hand corrections** (`_tags.json` `blocks`, owned by lib/tags.js): *add*
 *   makes a line a root although the name isn't written there, *remove* drops a
 *   root that matched by accident. By line id, so they apply only to lines that
 *   carry ids (a page read); ids no longer on the page are ignored.
 * - **No root at all**: the tag covers the whole page ("named nowhere on this
 *   page").
 *
 * Scope is only ever computed for tags ON the page (the caller passes the
 * page's tags): text alone never puts a page under a person.
 *
 * Lines are `{ id?, text, indentLevel }`: a PageDoc's transcript lines, or a
 * scan record's `transcriptionText` read back with `linesFromText()` (two
 * spaces per indent level, one line per transcript line, no ids). Both give the
 * same roots and blocks, so the Person page and the Tasks view need no page
 * reads (tested in tag-scope.test.js).
 *
 * Phase E's "sketches of a person" takes `coveredLineIds()`.
 *
 * Tested in src/lib/__tests__/tag-scope.test.js.
 */

import { findProjectNumbers, isProjectTag, tagTypeOf, infoOf } from './tags.js';
import { isKindLine, lineScanText } from './line-kinds.js';

/* ============================================================
 *  Lines
 * ============================================================ */

const levelOf = (l) => Math.max(0, Math.floor(Number(l && l.indentLevel) || 0));
const textOf = (l) => (l && typeof l.text === 'string' ? l.text : '');

/**
 * A scan record's `transcriptionText` as lines (main.cjs buildTranscriptionText:
 * `'  '.repeat(indentLevel) + text`, joined by newlines). No ids.
 * @param {string|null} text
 * @returns {Array<{id: null, text: string, indentLevel: number}>}
 */
export function linesFromText(text) {
  if (typeof text !== 'string' || !text) return [];
  return text.split('\n').map((row) => {
    const lead = row.length - row.replace(/^ +/, '').length;
    const level = Math.floor(lead / 2);
    return { id: null, text: row.slice(level * 2), indentLevel: level };
  });
}

/**
 * A scan record's `transcriptionText` from transcript lines: two spaces per
 * indent level, then the line's text with its own leading spaces dropped
 * (v3.23.0), so `linesFromText()` reads every line back at its stored indent.
 * MIRRORED by main.cjs buildTranscriptionText(); the MCP store and
 * stores/saved-pages.js call this one.
 * @returns {string|null}
 */
export function buildTranscriptionText(lines) {
  if (!Array.isArray(lines) || lines.length === 0) return null;
  // A sketch line (v3.24.0) reads `[sketch] label` (line-kinds.js lineScanText).
  return lines.map((l) => '  '.repeat((l && l.indentLevel) || 0) + lineScanText(l)).join('\n');
}

/**
 * Just what scope needs from transcript lines: `{ id, text, indentLevel }` (small, for caching).
 * A kind line's text is its scan text (`[sketch] label`), so scope from lines and
 * from `transcriptionText` agree (v3.24.0).
 */
export function scopeLinesOf(lines) {
  return (Array.isArray(lines) ? lines : []).filter(Boolean).map((l) => ({
    id: typeof l.id === 'string' ? l.id : null,
    text: isKindLine(l) ? lineScanText(l) : textOf(l),
    indentLevel: levelOf(l)
  }));
}

/* ============================================================
 *  Names
 * ============================================================ */

/**
 * A key as a name, for a person with no display name: dashes to spaces, each
 * word capitalised (`isaiah` → "Isaiah", `tom-b` → "Tom B"). Keys are lowercase,
 * and a case-sensitive match on "isaiah" would miss the name as written.
 */
export function nameFromKey(tag) {
  return String(tag || '').split(/[-_]+/).filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/**
 * The names a person is matched by in transcript text, as written (capitals
 * kept): the display name, then the aliases; with no display name, the key
 * capitalised (nameFromKey). Projects and topics: [].
 */
export function personNames(tag, info) {
  if (tagTypeOf(tag, info) !== 'person') return [];
  const rec = infoOf(info, tag);
  const out = [rec.label || nameFromKey(tag)];
  for (const a of rec.aliases || []) if (a && !out.includes(a)) out.push(a);
  return out;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const reCache = new Map();

/**
 * A regex finding any of `names` as a whole word, case-sensitive. A name's
 * inner spaces match any run of white space. A possessive ("Tom's", "Tom’s")
 * passes because the apostrophe is not a word character.
 */
function namesRe(names) {
  const key = names.join('\u0000');
  let re = reCache.get(key);
  if (!re) {
    const alts = names
      .map((n) => n.trim()).filter(Boolean)
      .sort((a, b) => b.length - a.length)
      .map((n) => n.split(/\s+/).map(escapeRe).join('\\s+'));
    re = alts.length ? new RegExp(`(?<![\\p{L}\\p{N}_])(?:${alts.join('|')})(?![\\p{L}\\p{N}_])`, 'u') : null;
    if (reCache.size > 500) reCache.clear();
    reCache.set(key, re);
  }
  return re;
}

/** Does `text` name a person by one of `names` (whole word, case-sensitive)? */
export function textNamesAny(text, names) {
  if (typeof text !== 'string' || !text || !names || !names.length) return false;
  const re = namesRe(names);
  return !!re && re.test(text);
}

/**
 * A matcher for one tag's roots: `(text) => boolean`, or null for a tag with no
 * block scope (a Topic, or anything that isn't a tag).
 * @param {string} tag
 * @param {Record<string, object>} [info]  the info map
 */
export function rootMatcher(tag, info) {
  if (isProjectTag(tag)) return (text) => findProjectNumbers(text).some((h) => h.tag === tag);
  const names = personNames(tag, info);
  if (!names.length) return null;
  return (text) => textNamesAny(text, names);
}

/** True when the tag has block scope: a Project or a Person. */
export function hasBlockScope(tag, info) {
  return isProjectTag(tag) || tagTypeOf(tag, info) === 'person';
}

/* ============================================================
 *  Scope
 * ============================================================ */

/** The index after the last line of the block rooted at `i` (exclusive end). */
export function blockEnd(lines, i) {
  const lvl = levelOf(lines[i]);
  let j = i + 1;
  while (j < lines.length && levelOf(lines[j]) > lvl) j++;
  return j;
}

const idSet = (list) => new Set((Array.isArray(list) ? list : []).filter((x) => typeof x === 'string'));

/**
 * One tag's scope on one page, or null for a tag with no block scope.
 *
 * @param {Array<{id?: string|null, text?: string, indentLevel?: number}>} lines
 * @param {string} tag
 * @param {{info?: Record<string, object>, correction?: {add?: string[], remove?: string[]}}} [opts]
 * @returns {null | {
 *   tag: string,
 *   matched: number[],     // lines whose text names the tag (before corrections)
 *   roots: number[],       // after corrections, in line order
 *   added: number[],       // roots by hand (add)
 *   removed: number[],     // text matches dropped by hand (remove)
 *   blocks: Array<{root: number, end: number}>,   // outermost roots only: a nested root's block is inside one of these
 *   covered: Set<number>,  // every covered line index
 *   wholePage: boolean     // no root: the tag covers the page
 * }}
 */
export function tagScope(lines, tag, { info = {}, correction = null } = {}) {
  const match = rootMatcher(tag, info);
  if (!match) return null;
  const list = Array.isArray(lines) ? lines : [];
  const add = idSet(correction && correction.add);
  const remove = idSet(correction && correction.remove);
  const matched = [];
  const roots = [];
  const added = [];
  const removed = [];
  list.forEach((l, i) => {
    const id = l && typeof l.id === 'string' ? l.id : null;
    const byText = match(textOf(l));
    if (byText) matched.push(i);
    if (id && add.has(id) && !byText) {
      added.push(i);
      roots.push(i);
    } else if (byText) {
      if (id && remove.has(id) && !add.has(id)) removed.push(i);
      else roots.push(i);
    }
  });
  const covered = new Set();
  const blocks = [];
  if (!roots.length) {
    for (let i = 0; i < list.length; i++) covered.add(i);
  } else {
    for (const r of roots) {
      if (covered.has(r)) continue;   // nested inside an earlier block
      const end = blockEnd(list, r);
      blocks.push({ root: r, end });
      for (let i = r; i < end; i++) covered.add(i);
    }
  }
  return { tag, matched, roots, added, removed, blocks, covered, wholePage: !roots.length };
}

/**
 * Scope for each tag ON the page that has block scope (Projects and People).
 * @param {Array<object>} lines
 * @param {string[]} tags  the page's tags
 * @param {Record<string, object>} [info]
 * @param {Record<string, {add?: string[], remove?: string[]}>} [corrections]  this page's `blocks` entry
 * @returns {Record<string, ReturnType<typeof tagScope>>}
 */
export function pageScopes(lines, tags, info = {}, corrections = {}) {
  const out = {};
  for (const tag of tags || []) {
    const s = tagScope(lines, tag, { info, correction: (corrections || {})[tag] || null });
    if (s) out[tag] = s;
  }
  return out;
}

/**
 * The ids of the lines each tag covers, per tag on the page (for Phase E's
 * "sketches of a person" and anything else that takes lines and wants ids).
 * Lines without ids are left out.
 * @returns {Record<string, string[]>}
 */
export function coveredLineIds(lines, tags, info = {}, corrections = {}) {
  const out = {};
  const list = Array.isArray(lines) ? lines : [];
  const scopes = pageScopes(list, tags, info, corrections);
  for (const tag of Object.keys(scopes)) {
    const ids = [];
    for (const i of [...scopes[tag].covered].sort((a, b) => a - b)) {
      const id = list[i] && list[i].id;
      if (typeof id === 'string') ids.push(id);
    }
    out[tag] = ids;
  }
  return out;
}

/**
 * Is a task in a tag's scope, from the scan summary alone (D.3)? Yes when the
 * scope is the whole page, or when the task's own line or one of its `heads`
 * (its ancestor lines, nearest 3) is a root: by its text, or added by hand, and
 * not removed by hand. When `scope` came from lines with ids, the covered ids
 * decide instead (exact even past three levels).
 *
 * @param {{id: string, text: string, heads?: Array<{id: string|null, text: string}>}} task
 * @param {ReturnType<typeof tagScope>} scope  from the page's lines
 * @param {Array<object>} lines  the same lines
 * @param {(text: string) => boolean} match  rootMatcher()
 * @param {{add?: string[], remove?: string[]}|null} correction
 */
export function taskInScope(task, scope, lines, match, correction) {
  if (!scope || !task) return false;
  if (scope.wholePage) return true;
  if (lines && lines.some((l) => l && typeof l.id === 'string')) {
    const i = lines.findIndex((l) => l && l.id === task.id);
    if (i >= 0) return scope.covered.has(i);
  }
  const add = idSet(correction && correction.add);
  const remove = idSet(correction && correction.remove);
  const isRoot = (n) => {
    const id = n && typeof n.id === 'string' ? n.id : null;
    if (id && add.has(id)) return true;
    if (!match(textOf(n))) return false;
    return !(id && remove.has(id));
  };
  return isRoot(task) || (task.heads || []).some(isRoot);
}

/**
 * The Person tags on a page whose scope contains each task: `Map<taskId,
 * string[]>`. Only people ON the page (`tags`), never by text alone.
 * @param {Array<object>} tasks  the record's `tasks` summary
 * @param {Array<object>} lines  the page's lines (scan text, or a read with ids)
 * @param {string[]} tags  the page's tags
 * @param {Record<string, object>} info
 * @param {Record<string, object>} [corrections]  this page's `blocks` entry
 */
export function peopleForTasks(tasks, lines, tags, info, corrections = {}) {
  const out = new Map();
  const people = (tags || []).filter((t) => tagTypeOf(t, info) === 'person');
  if (!people.length || !Array.isArray(tasks) || !tasks.length) return out;
  for (const tag of people) {
    const correction = (corrections || {})[tag] || null;
    const scope = tagScope(lines, tag, { info, correction });
    const match = rootMatcher(tag, info);
    for (const t of tasks) {
      if (!taskInScope(t, scope, lines, match, correction)) continue;
      if (!out.has(t.id)) out.set(t.id, []);
      out.get(t.id).push(tag);
    }
  }
  return out;
}

/* ============================================================
 *  Blocks for a tag page (D.2)
 * ============================================================ */

/**
 * One page's blocks under a tag, for the Person / Project page: each outermost
 * block's root and children as `{ index, text, depth }` (depth relative to the
 * root), or one whole-page entry when the tag is named nowhere on the page.
 *
 * @param {Array<object>} lines
 * @param {ReturnType<typeof tagScope>} scope
 * @param {number} [maxChildren]  lines kept under a root (the rest counted)
 * @returns {Array<{root: number, rootText: string, children: Array<{index: number, text: string, depth: number}>, more: number, wholePage: boolean}>}
 */
export function blocksOf(lines, scope, maxChildren = 12) {
  if (!scope) return [];
  const list = Array.isArray(lines) ? lines : [];
  if (scope.wholePage) {
    return [{ root: 0, rootText: '', children: [], more: 0, wholePage: true }];
  }
  return scope.blocks.map(({ root, end }) => {
    const base = levelOf(list[root]);
    const children = [];
    for (let i = root + 1; i < end; i++) {
      if (!textOf(list[i]).trim()) continue;
      children.push({ index: i, text: textOf(list[i]).trim(), depth: levelOf(list[i]) - base });
    }
    return {
      root,
      rootText: textOf(list[root]).trim(),
      children: children.slice(0, maxChildren),
      more: Math.max(0, children.length - maxChildren),
      wholePage: false
    };
  });
}

/**
 * Every block under one tag across the pages carrying it, newest first, for
 * the tag's page (D.2 "Blocks"). From scan records alone: each page's lines are
 * `scopeLines.get(key)` (read with ids, only for pages with hand corrections)
 * or its `transcriptionText`. Pages with no transcript are left out (the Pages
 * grid shows them).
 *
 * @param {Array<object>} records  the scan records carrying the tag
 * @param {{tag: string, info?: object, blocks?: object, scopeLines?: Map<string, Array<object>>|null,
 *   dates?: Map<string, {first: string, last: string, lastMs?: number|null}>|null}} ctx
 * @returns {Array<{key: string, record: object, root: number, rootId: string|null, rootText: string,
 *   children: Array<{index: number, text: string, depth: number}>, more: number, wholePage: boolean,
 *   first: string|null, last: string|null}>}
 */
export function tagBlockEntries(records, { tag, info = {}, blocks = {}, scopeLines = null, dates = null } = {}) {
  if (!hasBlockScope(tag, info)) return [];
  const out = [];
  for (const r of records || []) {
    if (!r) continue;
    const pageId = r.pageId != null ? String(r.pageId) : String(r.page);
    const key = `${r.book}/${pageId}`;
    const lines = (scopeLines && scopeLines.get(key)) || linesFromText(r.transcriptionText);
    if (!lines.length) continue;
    const correction = (blocks && blocks[key] && blocks[key][tag]) || null;
    const scope = tagScope(lines, tag, { info, correction });
    const when = dates ? dates.get(key) : null;
    for (const b of blocksOf(lines, scope)) {
      const id = lines[b.root] && typeof lines[b.root].id === 'string' ? lines[b.root].id : null;
      out.push({
        key, record: r, ...b, rootId: b.wholePage ? null : id,
        first: when ? when.first : null, last: when ? when.last : null,
        lastMs: when && Number.isFinite(when.lastMs) ? when.lastMs : null
      });
    }
  }
  return out.sort((a, b) => {
    if (a.lastMs !== b.lastMs) {
      if (a.lastMs == null) return 1;
      if (b.lastMs == null) return -1;
      return b.lastMs - a.lastMs;
    }
    return a.key < b.key ? -1 : a.key > b.key ? 1 : a.root - b.root;
  });
}

/**
 * Pages whose transcript names a person (display name or alias, whole word,
 * case-sensitive) but which don't carry the tag (D.2 "Mentioned, not tagged").
 * Suggestions only: nothing is tagged without a click (decision 5). From scan
 * text, no page reads.
 * @param {Array<object>} records  every scan record
 * @param {string} tag  a Person tag
 * @param {object} info
 * @param {Record<string, string[]>} pageTags
 * @returns {Array<{key: string, record: object, line: string}>}  `line`: the first line naming them
 */
export function mentionedNotTagged(records, tag, info, pageTags) {
  const names = personNames(tag, info);
  if (!names.length) return [];
  const out = [];
  for (const r of records || []) {
    if (!r || typeof r.transcriptionText !== 'string' || !textNamesAny(r.transcriptionText, names)) continue;
    const pageId = r.pageId != null ? String(r.pageId) : String(r.page);
    const key = `${r.book}/${pageId}`;
    if (((pageTags || {})[key] || []).includes(tag)) continue;
    const line = r.transcriptionText.split('\n').find((l) => textNamesAny(l, names)) || '';
    out.push({ key, record: r, line: line.trim() });
  }
  return out;
}

/**
 * What the reader's line menu offers for block scope on one line (D.4): the
 * tags on the page this line is a root of (for "Not this person"), each with
 * whether its text names the tag (`byText`) or it was added by hand.
 * @returns {Array<{tag: string, byText: boolean}>}
 */
export function rootsOnLine(lines, lineId, tags, info, corrections = {}) {
  const list = Array.isArray(lines) ? lines : [];
  const i = list.findIndex((l) => l && l.id === lineId);
  if (i < 0) return [];
  const out = [];
  for (const [tag, scope] of Object.entries(pageScopes(list, tags, info, corrections))) {
    if (scope.roots.includes(i)) out.push({ tag, byText: scope.matched.includes(i) });
  }
  return out;
}
