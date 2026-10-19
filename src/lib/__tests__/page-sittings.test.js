import { describe, it, expect } from 'vitest';
import {
  HOVER_TOLERANCE_PX, MAX_TOLERANCE_NCODE,
  pageSittings, buildHitIndex, hitTest, hoverTolerance, formatSittingLabel
} from '../viewer/page-sittings.js';
import { SESSION_GAP_MS } from '../timeline-feed.js';

/** Local time, so the fixtures don't depend on the machine's zone. */
function at(d, h, m = 0, s = 0) {
  return new Date(2026, 9, d, h, m, s).getTime();
}

const MIN = 60 * 1000;

/** A stored stroke at time t: a horizontal line from x to x + 8 at height y. */
function stroke(t, x = 10, y = 20, extra = {}) {
  return {
    id: `s${t}`,
    startTime: t,
    endTime: t + 500,
    points: [[x, y, t], [x + 4, y, t + 250], [x + 8, y, t + 500]],
    ...extra
  };
}

describe('pageSittings', () => {
  it('returns nothing for an empty or missing page', () => {
    expect(pageSittings([]).groups).toEqual([]);
    expect(pageSittings(null).groups).toEqual([]);
    expect(pageSittings(undefined).groupOf.length).toBe(0);
  });

  it('makes one group of a single stroke, with its ink box', () => {
    const s = stroke(at(14, 9, 5), 10, 20);
    const { groups, groupOf } = pageSittings([s]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ index: 0, startTime: s.startTime, endTime: s.endTime });
    expect(groups[0].strokes).toEqual([s]);
    expect(groups[0].bounds).toEqual({ minX: 10, minY: 20, maxX: 18, maxY: 20 });
    expect([...groupOf]).toEqual([0]);
  });

  it('joins at exactly the gap and splits just past it (end of one to start of next)', () => {
    const a = stroke(at(14, 9, 0));
    const b = stroke(a.endTime + SESSION_GAP_MS);          // exactly 20 min after a ENDS
    const c = stroke(b.endTime + SESSION_GAP_MS + 1);      // 1 ms too late
    const { groups, groupOf } = pageSittings([a, b, c]);
    expect(groups.map((g) => g.strokes.length)).toEqual([2, 1]);
    expect([...groupOf]).toEqual([0, 0, 1]);
  });

  it('chains a long sitting however long it runs', () => {
    const list = [5, 10, 12, 17, 26, 37].map((m) => stroke(at(14, 9, m)));
    list.push(stroke(at(14, 10, 20)));
    expect(pageSittings(list).groups.map((g) => g.strokes.length)).toEqual([6, 1]);
  });

  it('groups by time, not file order, and maps groupOf back to file positions', () => {
    const late = stroke(at(14, 15, 0), 40, 60);
    const early = stroke(at(14, 9, 0), 10, 20);
    const { groups, groupOf } = pageSittings([late, early]);
    expect(groups[0].strokes).toEqual([early]);
    expect([...groupOf]).toEqual([1, 0]);
  });

  it('keeps a sitting that crosses midnight together', () => {
    const a = stroke(at(14, 23, 50));
    const b = stroke(at(15, 0, 5));
    const { groups } = pageSittings([a, b]);
    expect(groups).toHaveLength(1);
    expect(groups[0].endTime).toBe(b.endTime);
  });

  it('leaves strokes without a startTime out of every group', () => {
    const { groups, groupOf } = pageSittings([{ points: [[1, 1], [2, 2]] }, stroke(at(14, 9))]);
    expect(groups).toHaveLength(1);
    expect([...groupOf]).toEqual([-1, 0]);
  });

  it('ignores the stray origin dot when sizing a group', () => {
    const s = stroke(at(14, 9), 10, 20);
    s.points.splice(1, 0, [0, 0, null]);
    expect(pageSittings([s]).groups[0].bounds).toEqual({ minX: 10, minY: 20, maxX: 18, maxY: 20 });
  });

  it('uses a missing endTime as the start', () => {
    const s = { ...stroke(at(14, 9)), endTime: undefined };
    expect(pageSittings([s]).groups[0].endTime).toBe(s.startTime);
  });
});

describe('buildHitIndex / hitTest', () => {
  const a = stroke(at(14, 9), 10, 20);     // 09:00 line at y=20
  const b = stroke(at(14, 15), 10, 23);    // 15:00 line at y=23, overlapping in x
  const strokes = [a, b];
  const { groupOf } = pageSittings(strokes);
  const index = buildHitIndex(strokes, groupOf);

  it('picks the stroke under the pointer', () => {
    expect(hitTest(index, 14, 20, 0.5)).toBe(0);
    expect(hitTest(index, 14, 23, 0.5)).toBe(1);
  });

  it('reaches a stroke within the tolerance and nothing beyond it', () => {
    expect(hitTest(index, 14, 20.4, 0.5)).toBe(0);
    expect(hitTest(index, 14, 20.6, 0.5)).toBe(-1);
    expect(hitTest(index, 19, 20, 0.5)).toBe(-1);   // past the end cap
  });

  it('picks nothing on blank paper', () => {
    expect(hitTest(index, 50, 70, 1)).toBe(-1);
  });

  it('lets the nearest stroke win where sittings overlap', () => {
    // Both lines inside a 2-unit reach; the pointer is nearer b.
    expect(hitTest(index, 14, 22, 2)).toBe(1);
    expect(hitTest(index, 14, 21, 2)).toBe(0);
  });

  it('keeps the earlier stroke on an exact tie', () => {
    expect(hitTest(index, 14, 21.5, 2)).toBe(0);
  });

  it('finds a stroke spanning several grid cells from any of them', () => {
    const long = { ...stroke(at(14, 9)), points: [[1, 1], [41, 1]] };
    const idx = buildHitIndex([long], pageSittings([long]).groupOf);
    expect(hitTest(idx, 30, 1.2, 0.5)).toBe(0);
  });

  it('hits a single-point dot and skips untimed ink', () => {
    const dot = { ...stroke(at(14, 9)), points: [[30, 30]] };
    const untimed = { points: [[60, 60], [62, 60]] };
    const list = [dot, untimed];
    const idx = buildHitIndex(list, pageSittings(list).groupOf);
    expect(hitTest(idx, 30.2, 30, 0.5)).toBe(0);
    expect(hitTest(idx, 61, 60, 0.5)).toBe(-1);
  });

  it('handles an empty page and bad input', () => {
    const idx = buildHitIndex([], new Int32Array(0));
    expect(hitTest(idx, 1, 1, 1)).toBe(-1);
    expect(hitTest(null, 1, 1, 1)).toBe(-1);
    expect(hitTest(index, NaN, 1, 1)).toBe(-1);
  });
});

describe('hoverTolerance', () => {
  it('converts a fixed screen reach into Ncode units for the zoom', () => {
    expect(hoverTolerance(10)).toBeCloseTo(HOVER_TOLERANCE_PX / 10);
    expect(hoverTolerance(20)).toBeCloseTo(HOVER_TOLERANCE_PX / 20);
  });

  it('caps the reach when zoomed far out', () => {
    expect(hoverTolerance(0.1)).toBe(MAX_TOLERANCE_NCODE);
  });

  it('is zero for a view with no size', () => {
    expect(hoverTolerance(0)).toBe(0);
    expect(hoverTolerance(NaN)).toBe(0);
  });
});

describe('formatSittingLabel', () => {
  it('shows the day and a range sharing AM/PM', () => {
    expect(formatSittingLabel(at(14, 9, 5), at(14, 9, 42))).toBe('Wed Oct 14, 2026 · 9:05–9:42 AM');
  });

  it('shows one time for a single moment', () => {
    expect(formatSittingLabel(at(14, 9, 5), at(14, 9, 5, 30))).toBe('Wed Oct 14, 2026 · 9:05 AM');
    expect(formatSittingLabel(at(14, 9, 5), undefined)).toBe('Wed Oct 14, 2026 · 9:05 AM');
  });

  it('names both halves of a range across noon', () => {
    expect(formatSittingLabel(at(14, 11, 50), at(14, 12, 20))).toBe('Wed Oct 14, 2026 · 11:50 AM–12:20 PM');
  });

  it('names both dates across midnight', () => {
    expect(formatSittingLabel(at(14, 23, 40), at(15, 0, 20)))
      .toBe('Wed Oct 14, 2026 · 11:40 PM – Thu Oct 15, 2026 · 12:20 AM');
  });

  it('is empty without a start', () => {
    expect(formatSittingLabel(NaN, at(14, 9))).toBe('');
  });
});
