/**
 * tag-suggestions — project numbers suggested as tags across the whole
 * Library (v3.1.0 page tags): the thumbnails' amber dot and the review queue.
 *
 * Where the text comes from. Every scan record already carries its page's
 * stored transcript as `transcriptionText` (the metadata-only scan reads it
 * for global search), so this pass needs NO page reads: no getPage, nothing in
 * the reader's page cache or the thumbnail cache. It is still a pass over
 * every transcribed page, so it runs in chunks, yields between them, reports
 * progress and can be cancelled, and it caches per page: a page whose text is
 * unchanged is not matched again (re-transcribing changes the text, so it is).
 *
 * Two layers, so tagging or dismissing updates every view at once without a
 * new pass:
 *   found    pageKey → every number in its transcript, with its first line
 *            (the pass's output; independent of tags)
 *   pending  pageKey → numbers still to review: found, minus the page's tags
 *            and its dismissals (cheap, re-derived on every tag change)
 *
 * Nothing about suggestions is stored on disk except dismissals.
 *
 * Tested in `src/lib/__tests__/tag-suggestions.test.js`.
 */

import { suggestProjectNumbers, recordTagKey, compareRecords } from './tags.js';

/** Longest source line kept per number (a small string, never the transcript). */
const MAX_LINE = 140;

/**
 * Numbers in one page's transcript text, first line per number, lines trimmed
 * to MAX_LINE around the match.
 * @param {string|null} text
 * @returns {Array<{tag: string, line: string, start: number, end: number}>}
 */
export function foundInText(text) {
  if (!text) return [];
  return suggestProjectNumbers(text).map((s) => {
    if (s.line.length <= MAX_LINE) return { tag: s.tag, line: s.line, start: s.start, end: s.end };
    const from = Math.max(0, Math.min(s.start - 40, s.line.length - MAX_LINE));
    const line = s.line.slice(from, from + MAX_LINE);
    return { tag: s.tag, line, start: s.start - from, end: s.end - from };
  });
}

/**
 * Found numbers minus each page's tags and dismissals.
 * @param {Map<string, Array<{tag: string}>>} found
 * @param {Record<string, string[]>} tags
 * @param {Record<string, string[]>} dismissed
 * @returns {Map<string, string[]>} only pages with something left
 */
export function pendingFrom(found, tags = {}, dismissed = {}) {
  const out = new Map();
  for (const [key, list] of found || []) {
    const skip = new Set([...(tags[key] || []), ...(dismissed[key] || [])]);
    const left = list.map((f) => f.tag).filter((t) => !skip.has(t));
    if (left.length) out.set(key, left);
  }
  return out;
}

/** How many page × number suggestions are pending. */
export function countPending(pending) {
  let n = 0;
  for (const list of (pending || new Map()).values()) n += list.length;
  return n;
}

/**
 * The review queue: pending suggestions grouped by number, most pages first,
 * each with its pages in reading order and the first source line.
 * @param {Map<string, string[]>} pending
 * @param {Map<string, Array<{tag, line, start, end}>>} found
 * @param {Map<string, object>} records  scan records by page key
 * @returns {Array<{tag: string, pages: object[], keys: string[], source: {line, start, end}|null}>}
 */
export function groupSuggestions(pending, found, records) {
  const groups = new Map();
  for (const [key, tags] of pending || []) {
    const rec = records && records.get(key);
    if (!rec) continue;
    for (const tag of tags) {
      if (!groups.has(tag)) groups.set(tag, []);
      groups.get(tag).push(rec);
    }
  }
  const out = [];
  for (const [tag, recs] of groups) {
    const pages = recs.sort(compareRecords);
    const keys = pages.map(recordTagKey);
    let source = null;
    for (const k of keys) {
      const f = (found.get(k) || []).find((x) => x.tag === tag);
      if (f) { source = { line: f.line, start: f.start, end: f.end }; break; }
    }
    out.push({ tag, pages, keys, source });
  }
  return out.sort((a, b) => b.pages.length - a.pages.length || a.tag.localeCompare(b.tag));
}

const nextTick = () => new Promise((r) => setTimeout(r, 0));

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * The background pass, with its per-page cache. Matching is cheap (about
 * 15 ms for 740 transcribed pages), so it yields by time, not by count: every
 * `chunk` pages it checks the clock and yields once `budgetMs` of work has
 * gone by, so a large library cannot hold the UI and a small one does not
 * wait behind queued thumbnail reads between needless yields.
 * @param {{chunk?: number, budgetMs?: number, pause?: () => Promise<void>}} [opts]
 */
export function createSuggestionScanner({ chunk = 25, budgetMs = 12, pause = nextTick } = {}) {
  /** pageKey → { text, found } */
  const cache = new Map();
  let token = 0;

  /**
   * Match every record with a transcript. Resolves the found map, or null if
   * cancelled (or overtaken by a newer run).
   * @param {Array<object>} records  `savedPages`
   * @param {{onProgress?: (done: number, total: number) => void}} [opts]
   * @returns {Promise<Map<string, Array>|null>}
   */
  async function run(records, { onProgress = () => {} } = {}) {
    const mine = ++token;
    const todo = (records || []).filter((r) => r && r.transcriptionText);
    const found = new Map();
    const seen = new Set();
    onProgress(0, todo.length);
    let slice = now();
    for (let i = 0; i < todo.length; i++) {
      const r = todo[i];
      const key = recordTagKey(r);
      if (!key) continue;
      seen.add(key);
      let entry = cache.get(key);
      if (!entry || entry.text !== r.transcriptionText) {
        entry = { text: r.transcriptionText, found: foundInText(r.transcriptionText) };
        cache.set(key, entry);
      }
      if (entry.found.length) found.set(key, entry.found);
      if ((i + 1) % chunk === 0 && now() - slice >= budgetMs) {
        onProgress(i + 1, todo.length);
        await pause();
        if (mine !== token) return null;
        slice = now();
      }
    }
    // Pages that left the scan (deleted, other folder) leave the cache.
    for (const k of [...cache.keys()]) if (!seen.has(k)) cache.delete(k);
    onProgress(todo.length, todo.length);
    return mine === token ? found : null;
  }

  return {
    run,
    /** Stop a run in progress (its promise resolves null). */
    cancel() { token++; },
    /** Forget every cached page (Re-check transcripts, data-folder change). */
    clear() { token++; cache.clear(); },
    size: () => cache.size
  };
}
