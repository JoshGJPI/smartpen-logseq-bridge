/**
 * library-home — the Library home's notebook cards and a notebook's page grid
 * (reading-first package E). Pure: no DOM, no stores, no I/O.
 *
 * Every number comes from two things already in memory, never from a page
 * read:
 *   - the metadata-only scan records (`pagesByBook`): page count, the
 *     `transcribed` flag, stroke counts;
 *   - the capture-date index (`timelineIndex`, built in main from stroke
 *     `startTime`): first / last written day and how recently each page was
 *     written. Never `metadata.lastUpdated`, which is a file-write time.
 *
 * Cards read the UNFILTERED index: the Timeline's book filter says which
 * notebooks the date features show, and leaving a notebook out of the
 * Timeline should not blank its Library card.
 *
 * Tested in `src/lib/__tests__/library-home.test.js`.
 */

import { compareBookKeys, parseBookKey } from './volumes.js';
import { timelinePages, dayStart, dayKey } from './timeline.js';
import { writtenLabel } from './viewer/written-on.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const idOf = (r) => (r && r.pageId != null ? String(r.pageId) : String(r && r.page));

/** The index / page-dates key of a page: "388v2/151b". */
export const pageKeyOf = (book, pageId) => `${book}/${pageId}`;

/**
 * When each page was written, from the capture-date index.
 * Pages with no timed ink (every `startTime` 0) are absent.
 *
 * @param {Object|null} index  the timeline index
 * @returns {Map<string, {first: string, last: string, days: number, lastMs: number|null}>}
 *          keyed by `pageKeyOf(book, pageId)`
 */
export function pageDates(index) {
  const out = new Map();
  for (const p of timelinePages(index)) {
    const days = Object.keys(p.days).filter((d) => (p.days[d] || 0) > 0).sort();
    if (!days.length) continue;
    const pageId = p.pageId != null ? String(p.pageId) : String(p.page);
    const lastMs = Number.isFinite(p.lastStroke) ? p.lastStroke : (dayStart(days[days.length - 1])?.getTime() ?? null);
    out.set(pageKeyOf(String(p.book), pageId), {
      first: days[0],
      last: days[days.length - 1],
      days: days.length,
      lastMs
    });
  }
  return out;
}

/**
 * One card per notebook (book key: a volume is its own notebook).
 *
 * `fan` is the three most recently written pages, newest first; a notebook
 * with fewer timed pages is topped up from the end of the book, so a card
 * always shows ink when it has pages.
 *
 * @param {Record<string, Array<object>>} pagesByBook  sorted scan records per book key
 * @param {string[]} bookIds
 * @param {Map} dates  from pageDates()
 * @param {(book: string) => string} nameOf
 */
export function notebookCards(pagesByBook, bookIds, dates, nameOf = (b) => `B${b}`) {
  if (!pagesByBook || !Array.isArray(bookIds)) return [];
  const out = [];
  for (const book of bookIds) {
    const records = pagesByBook[book];
    if (!records || !records.length) continue;
    let transcribed = 0;
    let strokes = 0;
    let first = null;
    let last = null;
    let lastMs = null;
    const timed = [];
    records.forEach((r, i) => {
      if (r.transcribed) transcribed++;
      strokes += r.strokeCount || 0;
      const d = dates && dates.get(pageKeyOf(book, idOf(r)));
      if (!d) return;
      if (first === null || d.first < first) first = d.first;
      if (last === null || d.last > last) last = d.last;
      if (d.lastMs != null && (lastMs === null || d.lastMs > lastMs)) lastMs = d.lastMs;
      timed.push({ r, i, ms: d.lastMs ?? 0 });
    });
    timed.sort((a, b) => b.ms - a.ms || b.i - a.i);
    const fan = timed.slice(0, 3).map((t) => t.r);
    for (let i = records.length - 1; fan.length < 3 && i >= 0; i--) {
      if (!fan.includes(records[i])) fan.push(records[i]);
    }
    const parsed = parseBookKey(book);
    out.push({
      book,
      name: nameOf(book),
      volume: parsed ? parsed.volume : 1,
      pageCount: records.length,
      transcribed,
      transcribedPct: Math.round((transcribed / records.length) * 100),
      strokes,
      first,
      last,
      lastMs,
      fan
    });
  }
  return out;
}

/** Sort chips, in display order. */
export const SORT_ORDERS = [
  { id: 'recent', label: 'Recently written' },
  { id: 'name', label: 'Name' },
  { id: 'pages', label: 'Most pages' }
];

/** localStorage key for the chosen sort (a per-viewer convenience). */
export const LIBRARY_SORT_KEY = 'smartpen-library-sort';

/** A stored sort id, or 'recent' for anything missing or unknown. */
export function parseSortOrder(raw) {
  return SORT_ORDERS.some((o) => o.id === raw) ? raw : 'recent';
}

const byName = (a, b) =>
  a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) || compareBookKeys(a.book, b.book);

/**
 * Cards in the chosen order. Ties fall back to name then book key, so the
 * order is stable; a notebook with no timed ink sorts last under "recent".
 * @returns {Array} a new array
 */
export function sortNotebooks(cards, order) {
  const list = [...(cards || [])];
  if (order === 'name') return list.sort(byName);
  if (order === 'pages') return list.sort((a, b) => b.pageCount - a.pageCount || byName(a, b));
  return list.sort((a, b) => {
    if (a.lastMs == null || b.lastMs == null) {
      if (a.lastMs != null) return -1;
      if (b.lastMs != null) return 1;
      return byName(a, b);
    }
    return b.lastMs - a.lastMs || byName(a, b);
  });
}

/**
 * The Recent pages row: recently viewed pages that still exist, newest first.
 * @param {Array<{book: string|number, pageId: string}>} recent  `recentViews`
 */
export function recentRecords(recent, pagesByBook, limit = 8) {
  const out = [];
  for (const rv of recent || []) {
    const list = (pagesByBook && pagesByBook[String(rv.book)]) || [];
    const rec = list.find((p) => idOf(p) === String(rv.pageId));
    if (rec) out.push(rec);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * "Oct 14" this year, "Oct 14, 2025" otherwise; '' for a bad key.
 * @param {string} day  local day key
 * @param {Date} [now]
 */
export function shortDay(day, now = new Date()) {
  const d = dayStart(day);
  if (!d) return '';
  const md = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return d.getFullYear() === now.getFullYear() ? md : `${md}, ${d.getFullYear()}`;
}

/** "Feb 5 – Jun 25, 2026", "Oct 14, 2026" or '' (no timed ink). */
export function writtenRange(first, last) {
  if (!first) return '';
  return writtenLabel(first === last || !last ? [{ day: first }] : [{ day: first }, { day: last }]);
}

/**
 * "today", "yesterday", "3 days ago", or the short date for anything older
 * than a week. '' for a bad key.
 */
export function relativeDay(day, now = new Date()) {
  const d = dayStart(day);
  const today = dayStart(dayKey(now));
  if (!d || !today) return '';
  const n = Math.round((today - d) / 86400000);
  if (n === 0) return 'today';
  if (n === 1) return 'yesterday';
  if (n > 1 && n < 7) return `${n} days ago`;
  return shortDay(day, now);
}

/**
 * A notebook's page grid: each page with its first written day (the badge)
 * and how many days it was written on. Order is the scan's (P151b after P151).
 * With `book` null each record's own book is used (a tag's pages, across
 * notebooks).
 */
export function pageTiles(records, book, dates) {
  return (records || []).map((r) => {
    const d = dates && dates.get(pageKeyOf(book ?? r.book, idOf(r)));
    return {
      record: r,
      pageId: idOf(r),
      transcribed: !!r.transcribed,
      first: d ? d.first : null,
      last: d ? d.last : null,
      days: d ? d.days : 0
    };
  });
}
