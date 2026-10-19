/**
 * Picking the Timeline's range (reading-first package C): the Range ▾ presets
 * and the geometry of the activity strip across the top of the feed.
 *
 * Everything works in local day keys ("YYYY-MM-DD", lib/timeline.js) and
 * inclusive `[from, to]` ranges, as `setTimelineRange` takes them. Day offsets
 * are counted in calendar days, so a DST change never makes a day 23 or 25
 * hours wide here.
 */
import { addDays, dayStart } from './timeline.js';

const DAY_MS = 86400000;

export const RANGE_PRESETS = [
  { id: 'latest', label: 'Latest day' },
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

/** Calendar days from `first` to `day` (negative before it), or null. */
export function dayOffset(day, first) {
  const a = dayStart(first);
  const b = dayStart(day);
  if (!a || !b) return null;
  return Math.round((b - a) / DAY_MS);
}

/**
 * Columns for the strip: the span from the first to the last day with ink,
 * every calendar day counted (a gap is information), grouped `bucket` days a
 * column so the strip fits `maxColumns`.
 *
 * @param {Array<{day: string, strokes: number}>} days  `timelineDays`, ascending
 * @param {number} maxColumns
 * @returns {{first: string, last: string, totalDays: number, bucket: number,
 *            columns: Array<{from: string, to: string, strokes: number}>, max: number} | null}
 */
export function stripLayout(days, maxColumns) {
  if (!Array.isArray(days) || days.length === 0) return null;
  const first = days[0].day;
  const last = days[days.length - 1].day;
  const totalDays = dayOffset(last, first) + 1;
  if (!(totalDays > 0)) return null;
  const cols = Math.max(1, Math.floor(maxColumns) || 1);
  const bucket = Math.max(1, Math.ceil(totalDays / cols));
  const count = Math.ceil(totalDays / bucket);

  const columns = [];
  for (let i = 0; i < count; i++) {
    const from = addDays(first, i * bucket);
    const to = addDays(first, Math.min(totalDays - 1, (i + 1) * bucket - 1));
    columns.push({ from, to, strokes: 0 });
  }
  let max = 0;
  for (const d of days) {
    const off = dayOffset(d.day, first);
    if (off == null || off < 0 || off >= totalDays) continue;
    const col = columns[Math.floor(off / bucket)];
    col.strokes += d.strokes || 0;
    if (col.strokes > max) max = col.strokes;
  }
  return { first, last, totalDays, bucket, columns, max };
}

/**
 * The day under a horizontal position, as a fraction of the strip's width,
 * clamped to the strip.
 * @param {number} fraction  0 at the left edge, 1 at the right
 */
export function dayAtFraction(fraction, layout) {
  if (!layout) return null;
  const f = Math.min(1, Math.max(0, Number(fraction) || 0));
  const off = Math.min(layout.totalDays - 1, Math.floor(f * layout.totalDays));
  return addDays(layout.first, off);
}

/**
 * Where a range sits on the strip, as fractions of its width, clipped to it.
 * Null when there is no range or it lies wholly outside the ink.
 * @returns {{left: number, width: number} | null}
 */
export function windowFraction(from, to, layout) {
  if (!layout || !from || !to) return null;
  const a = dayOffset(from, layout.first);
  const b = dayOffset(to, layout.first);
  if (a == null || b == null) return null;
  const lo = Math.max(0, Math.min(a, b));
  const hi = Math.min(layout.totalDays - 1, Math.max(a, b));
  if (hi < lo) return null;
  return { left: lo / layout.totalDays, width: (hi - lo + 1) / layout.totalDays };
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
