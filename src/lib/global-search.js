/**
 * global-search — the header search (Ctrl K) over pages, notebooks and days
 * (reading-first package E). Pure: no DOM, no stores, no I/O.
 *
 * Same matching as Transcripts → Search (`transcript-search.js`): the query's
 * words, each matched as part of any word on the page, ranked by how many
 * match. The difference is cost: `searchPages` re-tokenizes every transcript on
 * every query, so this module builds the tokens once per scan
 * (`buildSearchIndex`, rebuilt only when `savedPages` changes) and a keystroke
 * only scans prepared strings.
 *
 * Everything comes from the metadata-only scan (`transcriptionText` rides on
 * each record) and the capture-date index. Nothing here reads a page; the line
 * to highlight in the reader is picked once the page is open
 * (`matchingLineId`, against the doc the reader already loaded).
 *
 * Tested in `src/lib/__tests__/global-search.test.js`.
 */

import { tokenize, highlightMatches } from './transcript-search.js';
import { filterTranscriptionProperties } from '../utils/formatting.js';
import { isTypingTarget } from './left-panel.js';
import { matchNotebooks } from './search-query.js';
import { pageKeyOf } from './library-home.js';
import { pagesOnDay } from './timeline.js';

export const LIMITS = { pages: 30, notebooks: 6, days: 6 };

const idOf = (r) => (r.pageId != null ? String(r.pageId) : String(r.page));

/**
 * Prepare every transcribed page for searching. One entry per record with a
 * transcript; `hay` is its tokens joined by spaces (no token contains one, so a
 * query word found in `hay` is part of a single page word, as in searchPages).
 *
 * @param {Array<object>} records  `savedPages`
 * @returns {Array<{record: object, key: string, hay: string, words: Set<string>, lines: string[]}>}
 */
export function buildSearchIndex(records) {
  const out = [];
  for (const r of records || []) {
    if (!r || !r.transcriptionText) continue;
    const words = tokenize(r.transcriptionText);
    const lines = filterTranscriptionProperties(r.transcriptionText)
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    out.push({ record: r, key: pageKeyOf(r.book, idOf(r)), hay: ` ${[...words].join(' ')} `, words, lines });
  }
  return out;
}

/** How many query tokens a line contains (case-insensitive substring). */
function lineHits(line, tokens) {
  const low = line.toLowerCase();
  let n = 0;
  for (const t of tokens) if (low.includes(t)) n++;
  return n;
}

/** The line with the most query tokens (first wins), or ''. */
export function bestLine(lines, tokens) {
  let best = '';
  let bestN = 0;
  for (const l of lines || []) {
    const n = lineHits(l, tokens);
    if (n > bestN) { best = l; bestN = n; }
  }
  return best;
}

/**
 * The transcript line a search hit means, for the reader's highlight: the line
 * with the most query tokens, or null when none has any.
 *
 * @param {Array<{id: string, text: string}>} lines  the open doc's transcript lines
 * @param {string[]} tokens
 * @returns {string|null}
 */
export function matchingLineId(lines, tokens) {
  if (!Array.isArray(tokens) || !tokens.length) return null;
  let best = null;
  let bestN = 0;
  for (const l of lines || []) {
    if (!l || !l.id || !l.text) continue;
    const n = lineHits(l.text, tokens);
    if (n > bestN) { best = l.id; bestN = n; }
  }
  return best;
}

/**
 * Page hits for some query tokens, ranked: more query words matched first,
 * then more of them matched as whole words, then most recently written.
 *
 * @param {ReturnType<typeof buildSearchIndex>} index
 * @param {string[]} tokens
 * @param {{dates?: Map, only?: Set<string>|null}} [opts]  `only`: page keys to keep
 */
export function searchIndex(index, tokens, { dates = null, only = null } = {}) {
  if (!tokens || !tokens.length) return [];
  const hits = [];
  for (const e of index || []) {
    if (only && !only.has(e.key)) continue;
    let score = 0;
    let whole = 0;
    for (const t of tokens) {
      if (!e.hay.includes(t)) continue;
      score++;
      if (e.words.has(t)) whole++;
    }
    if (!score) continue;
    const d = dates && dates.get(e.key);
    hits.push({ entry: e, score, whole, lastMs: d ? d.lastMs ?? 0 : 0 });
  }
  hits.sort((a, b) => b.score - a.score || b.whole - a.whole || b.lastMs - a.lastMs);
  return hits;
}

/** Every scan record by page key ("388v2/151b"), for results found by date. */
export function recordsByKey(records) {
  const m = new Map();
  for (const r of records || []) if (r) m.set(pageKeyOf(r.book, idOf(r)), r);
  return m;
}

/**
 * Run a parsed query over everything and group the results.
 *
 * - **Days**: each day the query names that has ink (in the filtered index, so
 *   a Day result agrees with the Timeline it opens).
 * - **Pages**: transcript matches for the words; when the query also names
 *   days, only pages written on them. A query that is only a date lists the
 *   pages written that day.
 * - **Notebooks**: names or keys matching the words (`matchNotebooks`).
 *
 * `order` puts the group the query is most clearly about first: Days for a
 * date-only query, Notebooks when a notebook is named exactly, else Pages.
 *
 * @param {{text: string, tokens: string[], days: string[]}} q  from parseSearchQuery
 * @param {{index: Array, notebooks: Array<{book: string, name: string}>,
 *          timeline?: Object|null, dates?: Map|null, records?: Map|null}} ctx
 *   `timeline` is the FILTERED capture-date index; `dates` is pageDates() of it;
 *   `records` maps every page key to its scan record (`recordsByKey`)
 * @returns {{pages: Array, notebooks: Array, days: Array, order: string[], total: number}}
 */
export function runSearch(q, { index, notebooks, timeline = null, dates = null, records = null }) {
  const empty = { pages: [], notebooks: [], days: [], order: ['pages', 'notebooks', 'days'], total: 0 };
  if (!q || (!q.tokens.length && !q.days.length && q.text.length < 2)) return empty;

  // Days, and which pages they hold.
  const days = [];
  let onDays = null;
  if (q.days.length) {
    onDays = new Map();
    for (const day of q.days) {
      const entries = timeline ? pagesOnDay(timeline, day) : [];
      if (!entries.length) continue;
      let strokes = 0;
      for (const e of entries) {
        strokes += e.strokes;
        const k = pageKeyOf(e.book, e.pageId);
        onDays.set(k, Math.max(onDays.get(k) || 0, e.strokes));
      }
      days.push({ day, pages: entries.length, strokes });
    }
  }

  // Pages.
  let pages;
  if (q.tokens.length) {
    pages = searchIndex(index, q.tokens, { dates, only: onDays ? new Set(onDays.keys()) : null }).map((h) => ({
      record: h.entry.record,
      key: h.entry.key,
      score: h.score,
      snippet: bestLine(h.entry.lines, q.tokens) || h.entry.lines[0] || ''
    }));
  } else if (onDays) {
    // Untranscribed pages count too, so look records up in the whole scan.
    const entries = new Map((index || []).map((e) => [e.key, e]));
    pages = [...onDays.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([key]) => ({ key, record: (records && records.get(key)) || null, score: 0, snippet: entries.get(key)?.lines[0] || '' }))
      .filter((p) => p.record);
  } else {
    pages = [];
  }

  const nbs = matchNotebooks(q.text, notebooks);

  let order = ['pages', 'notebooks', 'days'];
  if (q.days.length && !q.tokens.length) order = ['days', 'pages', 'notebooks'];
  else if (nbs.some((n) => n.exact)) order = ['notebooks', 'pages', 'days'];

  const res = {
    pages: pages.slice(0, LIMITS.pages),
    notebooks: nbs.slice(0, LIMITS.notebooks),
    days: days.slice(0, LIMITS.days),
    order
  };
  res.total = res.pages.length + res.notebooks.length + res.days.length;
  return res;
}

/**
 * The results in keyboard order (↑/↓ walk this list), as `{group, item}`.
 * @param {ReturnType<typeof runSearch>} res
 */
export function flattenResults(res) {
  const out = [];
  for (const g of (res && res.order) || []) for (const item of res[g] || []) out.push({ group: g, item });
  return out;
}

/** Snippet HTML with the query words marked (escaped, as in Transcripts → Search). */
export function snippetHtml(text, q) {
  return highlightMatches(text || '', (q && q.tokens ? q.tokens.join(' ') : '') || '');
}

/**
 * Is this keydown the global search shortcut (Ctrl K / Cmd K)?
 * Never while typing in a field (its own keys belong to it), never with Alt or
 * Shift, never mid-IME or already handled, and never while a transcript is
 * being edited.
 *
 * @param {KeyboardEvent} e
 * @param {{editing?: boolean}} [state]
 */
export function isSearchShortcut(e, { editing = false } = {}) {
  if (!e || typeof e.key !== 'string' || e.key.toLowerCase() !== 'k') return false;
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return false;
  if (e.isComposing || e.defaultPrevented || editing) return false;
  return !isTypingTarget(e.target);
}
