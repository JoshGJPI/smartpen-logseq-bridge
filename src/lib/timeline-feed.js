/**
 * Timeline feed — Book View's date-ordered stream of ink (pure).
 *
 * The Dates tab picks a span of days; Book View's Timeline mode shows that span
 * as one scrolling column of cards, newest first by default. Two stages, because
 * they need different data:
 *
 *   1. The **skeleton** — which days have ink, which pages each touches, how many
 *      strokes. Built from the capture-date index alone (`_timeline.json`), so the
 *      whole feed can be laid out without reading a single page file.
 *   2. The **sessions** of one day — the cards. A session is one sitting: the
 *      day's strokes from every page it touched, in `startTime` order, chained
 *      for as long as each stroke starts within `SESSION_GAP_MS` of the END of
 *      the one before. So strokes at 5, 10, 12, 17, 26 and 37 minutes are one
 *      session however long it runs, and one at 80 starts the next. This needs
 *      the strokes, so it runs only when a day scrolls near.
 *
 * A session is NOT cut on a change of page. It was at first, and on the corpus
 * that turned every page turn in a meeting into a new card — half of all cards
 * existed only because of it. A session instead carries `parts`, one per page
 * it touched, in the order they were first written on; the card shows a strip
 * per part.
 *
 * Measured on the reference corpus (293 pages, 310k strokes) with the 20-minute
 * gap: median 2 sessions a day (95th percentile 4), a median sitting of 21
 * minutes (95th percentile 83 — the meetings), and 160 of 367 sessions span more
 * than one page. A part's ink spans a median 25 Ncode units of page height —
 * about a quarter of a page, which is why a part shows a strip, not the page.
 *
 * Pure: no I/O, no stores. Tested in `src/lib/__tests__/timeline-feed.test.js`.
 */

import { addDays, rangeBoundsMs, pagesOnDay } from './timeline.js';
import { ORIGIN_TOLERANCE } from './point-edit.js';

/** A pause longer than this — end of one stroke to start of the next — starts a new card. */
export const SESSION_GAP_MS = 20 * 60 * 1000;

/**
 * The smallest paper a card is laid out on, in Ncode units. Page content on the
 * corpus runs to x ≈ 63 and y ≈ 90 on the common notebook, so fixing the frame
 * to at least this keeps handwriting one size from card to card — a page with a
 * two-word note in its corner is not blown up to fill the column. Wider
 * notebooks (content to x ≈ 91) get a wider frame and slightly smaller ink.
 */
export const PAGE_MIN_WIDTH = 66;
export const PAGE_MIN_HEIGHT = 92;

/** Space kept round a session's ink in its strip, and the least a strip shows. */
export const BAND_PAD = 2.5;
export const BAND_MIN_HEIGHT = 10;

/**
 * Blank page between two parts of one sitting's ink that is cut out of the
 * strip rather than shown — about three lines. Ticking off a TODO at the top of
 * a page and another at the bottom is one sitting (seconds apart) but should
 * not be one page-tall strip of empty paper.
 */
export const BAND_MERGE_GAP = 12;

/**
 * True for a point that can't be real ink: non-finite, or the stray Ncode-origin
 * dot the pen sometimes emits mid-stroke (see point-edit.js). Left in, one such
 * dot stretches a strip to the top of the page.
 */
function isBogusPoint(p) {
  const x = p && p[0], y = p && p[1];
  if (!Number.isFinite(x) || !Number.isFinite(y)) return true;
  return Math.abs(x) <= ORIGIN_TOLERANCE && Math.abs(y) <= ORIGIN_TOLERANCE;
}

/**
 * Per-stroke vertical extent plus the page's frame, computed once per PageDoc.
 * Cards filter strokes to their band by these numbers rather than walking every
 * point of every stroke again on each render.
 *
 * @param {{strokes?: Array}} doc
 * @returns {{width: number, height: number,
 *            items: Array<{stroke: Object, minY: number, maxY: number}>}}
 */
export function indexPageStrokes(doc) {
  const strokes = (doc && Array.isArray(doc.strokes)) ? doc.strokes : [];
  let maxX = 0, maxY = 0;
  const items = [];
  for (const stroke of strokes) {
    let lo = Infinity, hi = -Infinity;
    for (const p of stroke.points || []) {
      if (isBogusPoint(p)) continue;
      if (p[1] < lo) lo = p[1];
      if (p[1] > hi) hi = p[1];
      if (p[0] > maxX) maxX = p[0];
    }
    if (!Number.isFinite(lo)) continue;
    if (hi > maxY) maxY = hi;
    items.push({ stroke, minY: lo, maxY: hi });
  }
  return {
    width: Math.max(PAGE_MIN_WIDTH, maxX + BAND_PAD),
    height: Math.max(PAGE_MIN_HEIGHT, maxY + BAND_PAD),
    items
  };
}

/**
 * One strip's vertical slice of the page, in Ncode units, around a stretch of
 * ink. Padded, at least `BAND_MIN_HEIGHT` tall (a lone tick mark still gets a
 * strip you can see), and kept inside the page frame.
 *
 * @param {{minY: number, maxY: number}} extent
 * @param {number} pageHeight
 * @returns {{y0: number, y1: number}}
 */
export function sessionBand(extent, pageHeight) {
  let y0 = extent.minY - BAND_PAD;
  let y1 = extent.maxY + BAND_PAD;
  if (y1 - y0 < BAND_MIN_HEIGHT) {
    const mid = (y0 + y1) / 2;
    y0 = mid - BAND_MIN_HEIGHT / 2;
    y1 = mid + BAND_MIN_HEIGHT / 2;
  }
  if (y0 < 0) { y1 -= y0; y0 = 0; }
  if (y1 > pageHeight) { y0 = Math.max(0, y0 - (y1 - pageHeight)); y1 = pageHeight; }
  return { y0, y1 };
}

/**
 * The strips a collapsed part shows: its ink grouped into vertical
 * clusters, with any blank stretch taller than `BAND_MERGE_GAP` cut out.
 * Each cluster gets `sessionBand()`'s padding and minimum height; clusters whose
 * padded bands then touch are merged, so strips never overlap. Top to bottom.
 *
 * @param {Array<{minY: number, maxY: number}>} extents  the part's strokes
 * @param {number} pageHeight
 * @param {{mergeGap?: number}} [options]
 * @returns {Array<{y0: number, y1: number}>}
 */
export function sessionBands(extents, pageHeight, { mergeGap = BAND_MERGE_GAP } = {}) {
  const list = (extents || [])
    .filter(e => e && Number.isFinite(e.minY) && Number.isFinite(e.maxY))
    .sort((a, b) => a.minY - b.minY);
  if (list.length === 0) return [sessionBand({ minY: 0, maxY: 0 }, pageHeight)];

  const clusters = [];
  for (const e of list) {
    const last = clusters[clusters.length - 1];
    if (last && e.minY - last.maxY <= mergeGap) {
      if (e.maxY > last.maxY) last.maxY = e.maxY;
    } else {
      clusters.push({ minY: e.minY, maxY: e.maxY });
    }
  }

  const bands = [];
  for (const c of clusters) {
    const band = sessionBand(c, pageHeight);
    const last = bands[bands.length - 1];
    if (last && band.y0 <= last.y1) last.y1 = Math.max(last.y1, band.y1);
    else bands.push(band);
  }
  return bands;
}

/**
 * Split one day's ink into sessions (sittings), in the order it was written.
 *
 * Only strokes whose `startTime` falls on `day` count — the pages were chosen
 * because they hold ink on that day, but most also hold ink from other days
 * (that becomes the grey context on the card).
 *
 * `strokes` (on the session and on each part) holds the doc's own stroke
 * OBJECTS rather than ids, so a card can tell its ink from the rest of the page
 * without trusting every stored stroke to carry an id.
 *
 * @param {Array<{book: string, pageId: string, doc: Object}>} pages
 * @param {string} day  local day key
 * @param {{gapMs?: number}} [options]
 * @returns {Array<{id: string, startTime: number, endTime: number,
 *                  lastStart: number, count: number, strokes: Set<Object>,
 *                  parts: Array<{book: string, pageId: string, count: number,
 *                                strokes: Set<Object>, firstStart: number,
 *                                lastStart: number}>}>}
 *          ascending by startTime; parts in the order first written on
 */
export function daySessions(pages, day, { gapMs = SESSION_GAP_MS } = {}) {
  const bounds = rangeBoundsMs(day, day);
  if (!bounds || !Array.isArray(pages)) return [];

  const timed = [];
  pages.forEach((page, pageIndex) => {
    const strokes = (page && page.doc && Array.isArray(page.doc.strokes)) ? page.doc.strokes : [];
    for (const stroke of strokes) {
      const st = Number(stroke.startTime);
      if (Number.isFinite(st) && st >= bounds.startMs && st < bounds.endMs) {
        timed.push({ stroke, st, pageIndex });
      }
    }
  });
  // Stable on ties, so strokes sharing a millisecond keep file order.
  timed.sort((a, b) => a.st - b.st || a.pageIndex - b.pageIndex);

  const sessions = [];
  let cur = null;
  let partsByPage = null;
  for (const { stroke, st, pageIndex } of timed) {
    const end = Number(stroke.endTime);
    const et = Number.isFinite(end) ? Math.max(st, end) : st;
    if (!cur || st - cur.endTime > gapMs) {
      cur = {
        id: `${day}@${st}`,
        startTime: st,
        endTime: et,
        lastStart: st,
        count: 0,
        strokes: new Set(),
        parts: []
      };
      partsByPage = new Map();
      sessions.push(cur);
    }
    let part = partsByPage.get(pageIndex);
    if (!part) {
      const page = pages[pageIndex];
      part = {
        book: String(page.book),
        pageId: String(page.pageId),
        count: 0,
        strokes: new Set(),
        firstStart: st,
        lastStart: st
      };
      partsByPage.set(pageIndex, part);
      cur.parts.push(part);
    }
    part.count += 1;
    part.lastStart = st;
    part.strokes.add(stroke);
    cur.count += 1;
    cur.lastStart = st;
    if (et > cur.endTime) cur.endTime = et;
    cur.strokes.add(stroke);
  }
  return sessions;
}

/**
 * The feed's outline for a range: one entry per day with ink, plus one entry per
 * run of empty days between them (a gap is information — the same reason the
 * activity grid draws empty cells rather than squeezing them out).
 *
 * @param {Object} index  the capture-date index
 * @param {Array<{day: string, strokes: number, pages: number}>} days  `dayTotals(index)`
 * @param {string} from
 * @param {string} to
 * @param {'newest'|'oldest'} [order]
 * @returns {Array<{kind: 'day', day: string, strokes: number, pages: number,
 *                  entries: Array} | {kind: 'empty', from: string, to: string, count: number}>}
 */
export function feedSkeleton(index, days, from, to, order = 'newest') {
  if (!index || !from || !to || !Array.isArray(days)) return [];
  const lo = from <= to ? from : to;
  const hi = from <= to ? to : from;
  const inRange = days.filter(d => d.day >= lo && d.day <= hi && d.strokes > 0);

  const out = [];
  let prev = null;
  for (const d of inRange) {
    if (prev) {
      const gapFrom = addDays(prev, 1);
      const gapTo = addDays(d.day, -1);
      if (gapFrom && gapTo && gapFrom <= gapTo) {
        out.push({ kind: 'empty', from: gapFrom, to: gapTo, count: daysBetween(gapFrom, gapTo) });
      }
    }
    out.push({ kind: 'day', day: d.day, strokes: d.strokes, pages: d.pages, entries: pagesOnDay(index, d.day) });
    prev = d.day;
  }
  return order === 'oldest' ? out : out.reverse();
}

function daysBetween(from, to) {
  let n = 0;
  for (let d = from; d && d <= to && n < 20000; d = addDays(d, 1)) n++;
  return n;
}

/**
 * The range to continue into once the feed runs out: the same length, directly
 * beyond the end you scrolled to. Newest-first ends on the oldest day, so it
 * continues earlier; oldest-first continues later.
 *
 * @returns {{from: string, to: string} | null}
 */
export function nextFeedRange(from, to, order = 'newest') {
  if (!from || !to) return null;
  const lo = from <= to ? from : to;
  const hi = from <= to ? to : from;
  const len = daysBetween(lo, hi);
  return order === 'oldest'
    ? { from: addDays(hi, 1), to: addDays(hi, len) }
    : { from: addDays(lo, -len), to: addDays(lo, -1) };
}

/**
 * The range grown by the next `count` days with ink beyond the end the feed
 * scrolls toward — earlier when newest is on top, later when oldest is. This is
 * what scrolling off the bottom of the feed does: the range itself grows, so
 * the Dates tab's grid and tallies keep describing exactly what the feed shows.
 * Empty days are stepped over (they draw as a divider anyway). Null when there
 * is no more ink that way.
 *
 * @param {Array<{day: string, strokes: number}>} days  `dayTotals()`, ascending
 */
export function extendFeedRange(days, from, to, order = 'newest', count = 3) {
  if (!from || !to || !Array.isArray(days) || count < 1) return null;
  const lo = from <= to ? from : to;
  const hi = from <= to ? to : from;
  if (order === 'oldest') {
    const later = days.filter(d => d.day > hi && d.strokes > 0);
    if (later.length === 0) return null;
    return { from: lo, to: later[Math.min(count, later.length) - 1].day };
  }
  const earlier = days.filter(d => d.day < lo && d.strokes > 0);
  if (earlier.length === 0) return null;
  return { from: earlier[Math.max(0, earlier.length - count)].day, to: hi };
}

/**
 * A rough height for a day nobody has scrolled to yet, so the scrollbar means
 * something before the pages are read. Only a placeholder: once a day loads its
 * real height replaces this, and scroll anchoring keeps the view steady.
 *
 * Stroke count stands in for band height — about 11 strokes per Ncode unit of
 * page height on the corpus, clamped to a strip's plausible size.
 *
 * @param {Array<{strokes: number}>} entries  the day's pages
 * @param {number} pxPerUnit  the feed's render scale
 */
export function estimateDayHeight(entries, pxPerUnit) {
  const HEADER = 62, CARD_CHROME = 58, GAP = 34;
  let h = HEADER;
  for (const e of entries || []) {
    const units = Math.min(PAGE_MIN_HEIGHT, Math.max(BAND_MIN_HEIGHT, (e.strokes || 0) / 11));
    h += CARD_CHROME + units * pxPerUnit + GAP;
  }
  return Math.round(h);
}

/** "9 min", "1 h 35 min", "2 h", "under a minute" — for durations and gaps. */
export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 60000) return 'under a minute';
  const mins = Math.round(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
