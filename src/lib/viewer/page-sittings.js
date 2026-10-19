/**
 * page-sittings — Book View's hover-to-reveal capture time (pure).
 *
 * Hovering ink on a page in Book View finds the day it was written and draws
 * that day's ink on the page black, the rest grey, with the date and the day's
 * first-to-last time beside it; clicking opens that day in the Timeline. Groups
 * are local calendar days of stroke `startTime` (`dayKey`, the same day the
 * Timeline files a stroke under), cut to this page.
 *
 * Days, not the Timeline's 20-minute sittings: Josh tried sittings first and
 * asked for days (Oct 2026). Reading a page you want "which day was this", and
 * the click lands on a Timeline day, which is a day.
 *
 * Everything is computed once per page load: the groups, each group's ink box,
 * and a uniform grid of stroke segments so a hover looks at a handful of
 * segments rather than the 100k+ points of a dense page.
 *
 * Pure: no DOM, no stores. Tested in `src/lib/__tests__/page-sittings.test.js`.
 */

import { strokeSpan, isBogusPoint } from '../timeline-feed.js';
import { dayKey } from '../timeline.js';

/** Hover reach round a stroke, in screen pixels (converted to Ncode per zoom). */
export const HOVER_TOLERANCE_PX = 6;

/** The most a hover reaches in Ncode units (~7 mm), however far out you zoom. */
export const MAX_TOLERANCE_NCODE = 3;

/** Side of one hit-test grid cell, in Ncode units (~10 mm). */
export const HIT_CELL = 4;

/**
 * Split one page's strokes into the local days they were written on.
 *
 * @param {Array<{startTime?: number, endTime?: number, points?: Array}>} strokes  the PageDoc's
 * @returns {{groups: Array<{index: number, day: string, startTime: number, endTime: number,
 *                           strokes: Array<Object>, bounds: {minX: number, minY: number,
 *                           maxX: number, maxY: number} | null}>,
 *            groupOf: Int32Array}}
 *          groups ascending by day; `groupOf[i]` is stroke i's group, -1
 *          when it has no usable startTime
 */
export function pageDayGroups(strokes) {
  const list = Array.isArray(strokes) ? strokes : [];
  const groupOf = new Int32Array(list.length).fill(-1);

  const timed = [];
  list.forEach((stroke, i) => {
    const span = strokeSpan(stroke);
    if (span) timed.push({ i, ...span });
  });
  // Stable on ties, so strokes sharing a millisecond keep file order.
  timed.sort((a, b) => a.st - b.st || a.i - b.i);

  const groups = [];
  let cur = null;
  for (const { i, st, et } of timed) {
    const day = dayKey(st);
    if (!cur || day !== cur.day) {
      cur = { index: groups.length, day, startTime: st, endTime: et, strokes: [], bounds: null };
      groups.push(cur);
    }
    if (et > cur.endTime) cur.endTime = et;
    cur.strokes.push(list[i]);
    groupOf[i] = cur.index;
    cur.bounds = growBounds(cur.bounds, list[i]);
  }
  return { groups, groupOf };
}

function growBounds(b, stroke) {
  for (const p of (stroke && stroke.points) || []) {
    if (isBogusPoint(p)) continue;
    if (!b) b = { minX: p[0], minY: p[1], maxX: p[0], maxY: p[1] };
    else {
      if (p[0] < b.minX) b.minX = p[0];
      if (p[1] < b.minY) b.minY = p[1];
      if (p[0] > b.maxX) b.maxX = p[0];
      if (p[1] > b.maxY) b.maxY = p[1];
    }
  }
  return b;
}

/**
 * A spatial index of the page's stroke segments for hover hit-testing. Only
 * strokes in a group are indexed (ink with no time has nothing to reveal).
 * A one-point stroke (a dot) is indexed as a zero-length segment.
 *
 * @param {Array<{points?: Array}>} strokes
 * @param {Int32Array|number[]} groupOf  from pageDayGroups()
 * @param {number} [cell]
 */
export function buildHitIndex(strokes, groupOf, cell = HIT_CELL) {
  const segs = [];      // x1, y1, x2, y2 per segment
  const owner = [];     // stroke index per segment
  const cells = new Map();
  const list = Array.isArray(strokes) ? strokes : [];

  list.forEach((stroke, si) => {
    if (!groupOf || groupOf[si] == null || groupOf[si] < 0) return;
    const pts = ((stroke && stroke.points) || []).filter((p) => !isBogusPoint(p));
    const n = pts.length;
    for (let k = 0; k < Math.max(1, n - 1) && n > 0; k++) {
      const a = pts[k], b = pts[Math.min(k + 1, n - 1)];
      const id = owner.length;
      segs.push(a[0], a[1], b[0], b[1]);
      owner.push(si);
      const cx0 = Math.floor(Math.min(a[0], b[0]) / cell), cx1 = Math.floor(Math.max(a[0], b[0]) / cell);
      const cy0 = Math.floor(Math.min(a[1], b[1]) / cell), cy1 = Math.floor(Math.max(a[1], b[1]) / cell);
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let cy = cy0; cy <= cy1; cy++) {
          const key = `${cx},${cy}`;
          const bucket = cells.get(key);
          if (bucket) bucket.push(id);
          else cells.set(key, [id]);
        }
      }
    }
  });
  return { cell, cells, segs: Float64Array.from(segs), owner: Int32Array.from(owner) };
}

/**
 * The stroke nearest (x, y) within `tol`, all in Ncode units, or -1 for blank
 * paper. Where groups overlap, the nearest stroke wins; an exact tie keeps the
 * stroke indexed first (earlier in the file).
 */
export function hitTest(index, x, y, tol) {
  if (!index || !Number.isFinite(x) || !Number.isFinite(y) || !(tol >= 0)) return -1;
  const { cell, cells, segs, owner } = index;
  let best = -1;
  let bestD2 = tol * tol;
  let bestSeg = Infinity;
  const cx0 = Math.floor((x - tol) / cell), cx1 = Math.floor((x + tol) / cell);
  const cy0 = Math.floor((y - tol) / cell), cy1 = Math.floor((y + tol) / cell);
  for (let cx = cx0; cx <= cx1; cx++) {
    for (let cy = cy0; cy <= cy1; cy++) {
      const bucket = cells.get(`${cx},${cy}`);
      if (!bucket) continue;
      for (const id of bucket) {
        const d2 = segmentDist2(x, y, segs[id * 4], segs[id * 4 + 1], segs[id * 4 + 2], segs[id * 4 + 3]);
        if (d2 < bestD2 || (d2 === bestD2 && id < bestSeg)) {
          bestD2 = d2;
          bestSeg = id;
          best = owner[id];
        }
      }
    }
  }
  return best;
}

function segmentDist2(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - x1) * dx + (py - y1) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = x1 + t * dx - px, ey = y1 + t * dy - py;
  return ex * ex + ey * ey;
}

/**
 * Hover reach in Ncode units for a view drawing `pxPerUnit` screen pixels per
 * Ncode unit: a fixed few pixels on screen, capped so a far-out zoom doesn't
 * pick ink from across the page.
 */
export function hoverTolerance(pxPerUnit, px = HOVER_TOLERANCE_PX) {
  if (!(pxPerUnit > 0)) return 0;
  return Math.min(MAX_TOLERANCE_NCODE, px / pxPerUnit);
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function dateText(d) {
  return `${WEEKDAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function clockParts(d) {
  const h = d.getHours();
  return { hm: `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}`, ampm: h < 12 ? 'AM' : 'PM' };
}

/**
 * The hover label, in local time: "Tue Oct 14, 2026 · 9:05–9:42 AM";
 * "… · 11:50 AM–12:20 PM" across noon; "… · 9:05 AM" when it all fell in one
 * minute; "Tue Oct 14, 2026 · 11:40 PM – Wed Oct 15, 2026 · 12:20 AM" across
 * midnight. Empty for a missing start.
 */
export function formatSittingLabel(startTime, endTime) {
  if (!Number.isFinite(startTime)) return '';
  const a = new Date(startTime);
  const b = new Date(Number.isFinite(endTime) && endTime > startTime ? endTime : startTime);
  const ca = clockParts(a), cb = clockParts(b);
  if (dayKey(a) !== dayKey(b)) {
    return `${dateText(a)} · ${ca.hm} ${ca.ampm} – ${dateText(b)} · ${cb.hm} ${cb.ampm}`;
  }
  let time;
  if (ca.hm === cb.hm && ca.ampm === cb.ampm) time = `${ca.hm} ${ca.ampm}`;
  else if (ca.ampm === cb.ampm) time = `${ca.hm}–${cb.hm} ${cb.ampm}`;
  else time = `${ca.hm} ${ca.ampm}–${cb.hm} ${cb.ampm}`;
  return `${dateText(a)} · ${time}`;
}
