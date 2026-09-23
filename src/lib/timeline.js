/**
 * Timeline — reading the capture-date index (pure).
 *
 * The index itself is built in the main process and cached at
 * `<dataRoot>/pages/_timeline.json`; see `buildTimeline` in electron/main.cjs
 * for why capture date needs an index of its own rather than riding on
 * `metadata.lastUpdated`. This module only interprets it.
 *
 * Two units appear here and they are NOT interchangeable:
 *
 *   - a **day key**, "YYYY-MM-DD", a LOCAL calendar day. This is what the index
 *     stores and what the user picks. Sorting and range tests on day keys are
 *     plain string comparisons, which is the whole reason for the format.
 *   - a **timestamp**, epoch ms, which is what a stroke's `startTime` is. Only
 *     `rangeBoundsMs()` converts between them, and the loader filters strokes
 *     on the numbers rather than re-deriving a day key per stroke — 300k string
 *     builds per load is not free.
 *
 * Pure: no I/O, no stores. Tested in `src/lib/__tests__/timeline.test.js`.
 */

/** "YYYY-MM-DD" for a local calendar day. Mirrors `dayKeyLocal` in main.cjs. */
export function dayKey(ms) {
  const d = ms instanceof Date ? ms : new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.getFullYear()
    + '-' + String(d.getMonth() + 1).padStart(2, '0')
    + '-' + String(d.getDate()).padStart(2, '0');
}

/** A local Date at midnight starting the given day key, or null if unparseable. */
export function dayStart(day) {
  if (typeof day !== 'string') return null;
  const m = day.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Day key n days after `day` (n may be negative). */
export function addDays(day, n) {
  const d = dayStart(day);
  if (!d) return null;
  d.setDate(d.getDate() + n);
  return dayKey(d);
}

/**
 * Epoch-ms bounds for an inclusive day range: `[startMs, endMs)`.
 *
 * `endMs` is midnight at the START of the day after `to`, so the test is
 * `startMs <= t && t < endMs` — a half-open interval. Using "end of `to`" with
 * a `<=` test would need a last-millisecond value and gets the boundary wrong
 * for a stroke started exactly at midnight.
 *
 * Returns null when either end is unparseable; callers treat that as "no range"
 * rather than silently loading everything.
 */
export function rangeBoundsMs(from, to) {
  const a = dayStart(from);
  const b = dayStart(to);
  if (!a || !b) return null;
  const lo = a <= b ? a : b;
  const hi = a <= b ? b : a;
  const end = new Date(hi);
  end.setDate(end.getDate() + 1);
  return { startMs: lo.getTime(), endMs: end.getTime() };
}

/** Inclusive day-key range test. Day keys sort lexicographically. */
export function inRange(day, from, to) {
  if (!day || !from || !to) return false;
  return from <= to ? (day >= from && day <= to) : (day >= to && day <= from);
}

/** Every day key from `from` to `to` inclusive, including days with no capture. */
export function eachDay(from, to) {
  const out = [];
  let cur = from <= to ? from : to;
  const end = from <= to ? to : from;
  let guard = 0;
  while (cur && cur <= end && guard++ < 20000) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

/** The index's page entries as a plain array, ignoring malformed ones. */
export function timelinePages(index) {
  const pages = index && index.pages;
  if (!pages || typeof pages !== 'object') return [];
  return Object.keys(pages)
    .map(k => pages[k])
    .filter(p => p && p.days && typeof p.days === 'object');
}

/**
 * Per-day totals across the whole index, ascending by day.
 * @returns {Array<{day: string, strokes: number, pages: number}>}
 */
export function dayTotals(index) {
  const acc = new Map();
  for (const p of timelinePages(index)) {
    for (const day of Object.keys(p.days)) {
      const n = p.days[day] || 0;
      if (n <= 0) continue;
      const e = acc.get(day) || { day, strokes: 0, pages: 0 };
      e.strokes += n;
      e.pages += 1;
      acc.set(day, e);
    }
  }
  return [...acc.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/** First and last day with any captured ink, or null when the index is empty. */
export function timelineExtent(index) {
  const days = dayTotals(index);
  if (days.length === 0) return null;
  return { first: days[0].day, last: days[days.length - 1].day };
}

/**
 * The pages holding ink inside `[from, to]`, with what each contributes.
 *
 * `inRangeStrokes` is what a date-filtered load brings onto the canvas;
 * `contextStrokes` is the rest of that page — the ink that renders halftoned so
 * the day's writing can be read in the place it actually sits on the page.
 *
 * Ordered the way the canvas lays them out in date mode: earliest contributing
 * day first, then book, then page.
 *
 * @returns {Array<{book: string, page: number, pageId: string, suffix: string,
 *                  days: string[], firstDay: string, inRangeStrokes: number,
 *                  totalStrokes: number, contextStrokes: number}>}
 */
export function pagesInRange(index, from, to) {
  if (!from || !to) return [];
  const out = [];
  for (const p of timelinePages(index)) {
    let inRangeStrokes = 0;
    let totalStrokes = 0;
    const days = [];
    for (const day of Object.keys(p.days)) {
      const n = p.days[day] || 0;
      totalStrokes += n;
      if (inRange(day, from, to)) {
        inRangeStrokes += n;
        days.push(day);
      }
    }
    if (inRangeStrokes === 0) continue;
    days.sort();
    out.push({
      book: String(p.book),
      page: Number(p.page),
      pageId: p.pageId != null ? String(p.pageId) : String(p.page),
      suffix: p.suffix || '',
      days,
      firstDay: days[0],
      inRangeStrokes,
      totalStrokes,
      contextStrokes: totalStrokes - inRangeStrokes
    });
  }
  out.sort((a, b) =>
    a.firstDay.localeCompare(b.firstDay)
    || String(a.book).localeCompare(String(b.book), undefined, { numeric: true })
    || (a.page - b.page)
    || a.suffix.localeCompare(b.suffix)
  );
  return out;
}

/**
 * What loading `[from, to]` would bring in — the numbers the Dates panel shows
 * before you commit to it.
 *
 * `partialPages` counts pages that also hold ink outside the range; those are
 * the ones that would arrive with context ink, and the reason a page-level date
 * filter would be wrong (across the reference corpus, 74% of day/page pairs sit
 * on such a page).
 */
export function rangeSummary(index, from, to) {
  const pages = pagesInRange(index, from, to);
  let strokes = 0, contextStrokes = 0, partialPages = 0;
  const days = new Set();
  for (const p of pages) {
    strokes += p.inRangeStrokes;
    contextStrokes += p.contextStrokes;
    if (p.contextStrokes > 0) partialPages += 1;
    for (const d of p.days) days.add(d);
  }
  return {
    days: days.size,
    pages: pages.length,
    strokes,
    contextStrokes,
    partialPages
  };
}

/**
 * The pages contributing to one day, for the day list's chips.
 * @returns {Array<{book: string, page: number, pageId: string, strokes: number,
 *                  totalStrokes: number, spansOtherDays: boolean}>}
 */
export function pagesOnDay(index, day) {
  const out = [];
  for (const p of timelinePages(index)) {
    const n = p.days[day] || 0;
    if (n <= 0) continue;
    out.push({
      book: String(p.book),
      page: Number(p.page),
      pageId: p.pageId != null ? String(p.pageId) : String(p.page),
      strokes: n,
      totalStrokes: p.strokes || n,
      spansOtherDays: Object.keys(p.days).length > 1
    });
  }
  out.sort((a, b) =>
    String(a.book).localeCompare(String(b.book), undefined, { numeric: true }) || (a.page - b.page)
  );
  return out;
}
