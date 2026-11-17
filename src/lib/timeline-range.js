/**
 * Picking the Timeline's range (reading-first package C): the Range ▾ presets
 * and the geometry of the activity strip across the top of the feed.
 *
 * Everything works in local day keys ("YYYY-MM-DD", lib/timeline.js) and
 * inclusive `[from, to]` ranges, as `setTimelineRange` takes them. Day offsets
 * are counted in calendar days, so a DST change never makes a day 23 or 25
 * hours wide here.
 */
import { addDays, dayStart, dayKey } from './timeline.js';

const DAY_MS = 86400000;

export const RANGE_PRESETS = [
  { id: 'latest', label: 'Latest day with ink' },
  { id: 'day', label: '1 day' },
  { id: 'week', label: '7 days' },
  { id: 'month', label: '30 days' }
];

/**
 * A preset range, anchored on the current range's end when it sits inside the
 * ink, else on the last day with ink ("Latest day" always uses the last day).
 * Same rule the Dates tab has always used.
 *
 * @param {'latest'|'day'|'week'|'month'} kind
 * @param {{from: string|null, to: string|null}} range
 * @param {{first: string, last: string}|null} extent  `timelineRangeExtent`
 * @returns {{from: string, to: string}|null}
 */
export function rangePreset(kind, range, extent) {
  if (!extent || !extent.last) return null;
  const to = range && range.to;
  const anchor = to && to <= extent.last ? to : extent.last;
  if (kind === 'latest') return { from: extent.last, to: extent.last };
  if (kind === 'day') return { from: anchor, to: anchor };
  if (kind === 'week') return { from: addDays(anchor, -6), to: anchor };
  if (kind === 'month') return { from: addDays(anchor, -29), to: anchor };
  return null;
}

/**
 * The day the Timeline opens on (v3.10.0): today when today has ink on disk,
 * else the last day with ink. Never an empty day the user didn't ask for: the
 * Today button is how to look at today before anything is saved.
 *
 * @param {Array<{day: string}>} days  `dayTotals()`, ascending
 * @param {string} today  local day key, `dayKey(Date.now())`
 * @returns {string|null}  null on an empty index
 */
export function defaultTimelineDay(days, today) {
  if (!Array.isArray(days) || days.length === 0) return null;
  return days.some((d) => d && d.day === today) ? today : days[days.length - 1].day;
}

/** Calendar days from `first` to `day` (negative before it), or null. */
export function dayOffset(day, first) {
  const a = dayStart(first);
  const b = dayStart(day);
  if (!a || !b) return null;
  return Math.round((b - a) / DAY_MS);
}

/*
 * The strip is a zoomable view over the ink (Nov 2026). A view is
 * `{ first, start, span }`: `start` is a (fractional) day offset from `first`,
 * the first day with ink, and `span` is how many days the strip's width shows.
 * It never reaches outside the ink, never shows fewer than STRIP_MIN_SPAN days
 * (or the whole ink, when that is shorter) and never more than all of it.
 * Columns follow the calendar (days, Monday weeks, months), so a bar always
 * means the same days whatever the zoom or the book filter.
 */

/** The fewest days the strip zooms in to. */
export const STRIP_MIN_SPAN = 14;
/** Columns are at least this wide: days while a day gets this much, then weeks, then months. */
export const STRIP_MIN_COLUMN_PX = 3;

/**
 * First and last day with ink, and the calendar days between them, counted
 * inclusively (every day, a gap is information).
 * @param {Array<{day: string}>} days  `timelineDays`, ascending
 * @returns {{first: string, last: string, totalDays: number} | null}
 */
export function stripExtent(days) {
  if (!Array.isArray(days) || days.length === 0) return null;
  const first = days[0].day;
  const last = days[days.length - 1].day;
  const n = dayOffset(last, first);
  if (n == null || n < 0) return null;
  return { first, last, totalDays: n + 1 };
}

/** A view kept inside the ink and inside the zoom limits. */
export function clampView(view, extent) {
  const total = extent.totalDays;
  const minSpan = Math.min(STRIP_MIN_SPAN, total);
  const span = Math.min(total, Math.max(minSpan, Number(view.span) || total));
  const start = Math.min(total - span, Math.max(0, Number(view.start) || 0));
  return { first: extent.first, start, span };
}

/**
 * A view saved against another first day (the book filter changed it): the
 * same calendar days, measured from the new first day, clamped.
 */
export function rebaseView(view, extent) {
  if (!view || !extent) return null;
  const shift = view.first ? dayOffset(view.first, extent.first) : 0;
  return clampView({ start: view.start + (shift || 0), span: view.span }, extent);
}

/** The view a range opens with: about six times its length, at least 90 days, centred on it. */
export function fitView(from, to, extent) {
  if (!extent) return null;
  const a = from ? dayOffset(from, extent.first) : null;
  const b = to ? dayOffset(to, extent.first) : null;
  if (a == null || b == null) return clampView({ start: extent.totalDays, span: 90 }, extent);
  const len = Math.abs(b - a) + 1;
  const span = Math.max(len * 6, 90);
  return clampView({ start: (Math.min(a, b) + Math.max(a, b) + 1) / 2 - span / 2, span }, extent);
}

/**
 * The view after the range changed elsewhere (‹ ›, Today, Range ▾, the feed
 * growing it): unchanged while the range is inside it, else slid just far
 * enough to show it, and widened when the range is longer than the view.
 */
export function keepInView(view, from, to, extent) {
  if (!view || !extent) return view;
  const a = from ? dayOffset(from, extent.first) : null;
  const b = to ? dayOffset(to, extent.first) : null;
  if (a == null || b == null) return clampView(view, extent);
  const lo = Math.max(0, Math.min(a, b));
  const hi = Math.min(extent.totalDays, Math.max(a, b) + 1);
  let { start, span } = view;
  if (hi - lo > span) span = (hi - lo) * 1.25;
  if (lo >= start && hi <= start + span) return clampView({ start, span }, extent);
  const margin = Math.min(span * 0.05, (span - (hi - lo)) / 2);
  start = lo < start ? lo - margin : hi + margin - span;
  return clampView({ start, span }, extent);
}

/**
 * Zoom by `factor` (> 1 shows more days), keeping day offset `anchor` at
 * `fraction` of the width, where it was before.
 */
export function zoomView(view, anchor, fraction, factor, extent) {
  const span = view.span * (Number(factor) || 1);
  const c = clampView({ start: 0, span }, extent);
  return clampView({ start: anchor - fraction * c.span, span: c.span }, extent);
}

/** Slide the view by `days` (negative = earlier). */
export function panView(view, days, extent) {
  return clampView({ start: view.start + (Number(days) || 0), span: view.span }, extent);
}

/** The calendar month holding `day`, as first and last day keys. */
export function monthOf(day) {
  const d = dayStart(day);
  if (!d) return null;
  const from = dayKey(new Date(d.getFullYear(), d.getMonth(), 1));
  const to = dayKey(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  return { from, to };
}

/** Column unit for a zoom: the smallest calendar unit at least STRIP_MIN_COLUMN_PX wide. */
export function columnUnit(pxPerDay) {
  if (pxPerDay >= STRIP_MIN_COLUMN_PX) return 'day';
  if (pxPerDay * 7 >= STRIP_MIN_COLUMN_PX) return 'week';
  return 'month';
}

/** Offset of the first day of the unit holding offset `off`, and of the next one. */
function unitBounds(first, off, unit) {
  if (unit === 'day') return [off, off + 1];
  const d = dayStart(addDays(first, off));
  if (unit === 'week') {
    const s = off - ((d.getDay() + 6) % 7);
    return [s, s + 7];
  }
  const s = dayOffset(dayKey(new Date(d.getFullYear(), d.getMonth(), 1)), first);
  const e = dayOffset(dayKey(new Date(d.getFullYear(), d.getMonth() + 1, 1)), first);
  return [s, e];
}

/**
 * Columns for the strip's view, one per calendar day, Monday week or month
 * (by `columnUnit`), each with its stroke total. `off` and `len` place it in
 * day offsets from `first`; the first and last may run past the view.
 *
 * @param {Array<{day: string, strokes: number}>} days  `timelineDays`, ascending
 * @param {{start: number, span: number}} view
 * @param {number} widthPx  the strip's width
 * @returns {{first: string, last: string, totalDays: number, start: number, span: number, unit: string,
 *            columns: Array<{from: string, to: string, off: number, len: number, strokes: number}>,
 *            max: number} | null}
 */
export function stripLayout(days, view, widthPx) {
  const extent = stripExtent(days);
  if (!extent) return null;
  const { start, span } = view ? rebaseView(view, extent) : clampView({ start: 0, span: extent.totalDays }, extent);
  const unit = columnUnit((Number(widthPx) || 0) / span);
  const perDay = new Float64Array(extent.totalDays);
  for (const d of days) {
    const off = dayOffset(d.day, extent.first);
    if (off != null && off >= 0 && off < extent.totalDays) perDay[off] += d.strokes || 0;
  }
  const columns = [];
  let max = 0;
  let [s, e] = unitBounds(extent.first, Math.floor(start), unit);
  while (s < start + span) {
    let strokes = 0;
    for (let i = Math.max(0, s); i < Math.min(e, extent.totalDays); i++) strokes += perDay[i];
    columns.push({ from: addDays(extent.first, s), to: addDays(extent.first, e - 1), off: s, len: e - s, strokes });
    if (strokes > max) max = strokes;
    [s, e] = unitBounds(extent.first, e, unit);
  }
  return { ...extent, start, span, unit, columns, max };
}

const TICK_STEPS = [['day', 1, 24], ['week', 7, 44], ['month', 30.4, 36], ['quarter', 91, 56], ['year', 365, 40]];

/** The label step at a zoom: the smallest of day, week, month, quarter, year whose labels have room. */
export function tickStep(pxPerDay) {
  return (TICK_STEPS.find(([, days, px]) => days * pxPerDay >= px) || TICK_STEPS[4])[0];
}

/**
 * Date labels for the strip: the smallest step (day, week, month, quarter,
 * year) whose labels have room, as `{ day, off, kind }`; `kind` says what the
 * label names ('month' on a day step means the 1st, 'year' means 1 January).
 */
export function stripTicks(layout, widthPx) {
  if (!layout) return [];
  const step = tickStep((Number(widthPx) || 0) / layout.span);
  const out = [];
  const end = Math.min(layout.totalDays, layout.start + layout.span);
  for (let off = Math.ceil(layout.start); off < end; off++) {
    const day = addDays(layout.first, off);
    const d = dayStart(day);
    const first = d.getDate() === 1;
    const jan = first && d.getMonth() === 0;
    let kind = null;
    if (step === 'day') kind = jan ? 'year' : first ? 'month' : 'day';
    else if (step === 'week') kind = d.getDay() === 1 ? 'week' : null;
    else if (step === 'month') kind = jan ? 'year' : first ? 'month' : null;
    else if (step === 'quarter') kind = jan ? 'year' : first && d.getMonth() % 3 === 0 ? 'quarter' : null;
    else kind = jan ? 'year' : null;
    if (kind) out.push({ day, off, kind });
  }
  return out;
}

/**
 * The strip's date labels, placed in pixels and thinned so none overlap
 * (`gapPx` between them, text width estimated). The first label names its
 * year; month and day names follow the system locale.
 * @returns {Array<{x: number, text: string}>}
 */
export function stripLabels(layout, widthPx, gapPx = 8) {
  if (!layout || !widthPx) return [];
  const step = tickStep(widthPx / layout.span);
  const out = [];
  let lastEnd = -Infinity;
  for (const t of stripTicks(layout, widthPx)) {
    const x = ((t.off - layout.start) / layout.span) * widthPx;
    if (x < lastEnd + gapPx) continue;
    const text = tickText(t, step, out.length === 0);
    out.push({ x, text });
    lastEnd = x + text.length * 6.2;
  }
  return out;
}

function tickText(t, step, firstLabel) {
  const d = dayStart(t.day);
  const mon = d.toLocaleDateString(undefined, { month: 'short' });
  const year = String(d.getFullYear());
  if (t.kind === 'year') return step === 'quarter' || step === 'year' ? year : `${mon} ${year}`;
  if (t.kind === 'quarter') return `Q${d.getMonth() / 3 + 1}${firstLabel ? ` ${year}` : ''}`;
  if (t.kind === 'month') return step === 'day' ? `${mon} 1` : firstLabel ? `${mon} ${year}` : mon;
  if (t.kind === 'week') return `${mon} ${d.getDate()}`;
  return String(d.getDate());
}

/**
 * The day under a horizontal position, as a fraction of the strip's width,
 * clamped to the ink.
 * @param {number} fraction  0 at the left edge, 1 at the right
 */
export function dayAtFraction(fraction, layout) {
  if (!layout) return null;
  const f = Math.min(1, Math.max(0, Number(fraction) || 0));
  const off = Math.min(layout.totalDays - 1, Math.max(0, Math.floor(Math.min(layout.start + f * layout.span, layout.start + layout.span - 1e-6))));
  return addDays(layout.first, off);
}

/**
 * Where a range sits on the strip's view, as fractions of its width, clipped
 * to it. Null when there is no range or it lies wholly outside the view.
 * @returns {{left: number, width: number} | null}
 */
export function windowFraction(from, to, layout) {
  if (!layout || !from || !to) return null;
  const a = dayOffset(from, layout.first);
  const b = dayOffset(to, layout.first);
  if (a == null || b == null) return null;
  const lo = Math.max(layout.start, Math.min(a, b));
  const hi = Math.min(layout.start + layout.span, Math.max(a, b) + 1);
  if (hi <= lo) return null;
  return { left: (lo - layout.start) / layout.span, width: (hi - lo) / layout.span };
}

/**
 * Slide a range by `delta` days, keeping its length, without leaving the ink's
 * span (a range longer than the span pins to its start).
 * @returns {{from: string, to: string}}
 */
export function moveWindow(from, to, delta, first, last) {
  const len = dayOffset(to, from);
  const span = dayOffset(last, first);
  let start = dayOffset(from, first) + Math.round(delta || 0);
  start = Math.max(0, Math.min(start, Math.max(0, span - len)));
  return { from: addDays(first, start), to: addDays(first, start + len) };
}

/**
 * Drag one end of a range to `day`; the other end stays, and the dragged end
 * cannot cross it.
 * @param {'start'|'end'} edge
 */
export function resizeWindow(edge, from, to, day) {
  if (edge === 'start') return { from: day <= to ? day : to, to };
  return { from, to: day >= from ? day : from };
}
