/**
 * lib/timeline-range.js (reading-first package C): Range ▾ presets and the
 * activity strip's geometry.
 *
 * What matters: presets anchor the way the Dates tab always did; the strip
 * counts every calendar day (DST included) so the window lines up with the
 * bars; dragging can neither leave the ink's span nor turn a range inside out.
 */
import { describe, it, expect } from 'vitest';
import {
  RANGE_PRESETS, rangePreset, dayOffset, stripLayout, dayAtFraction,
  windowFraction, moveWindow, resizeWindow, stripExtent, clampView, rebaseView, fitView,
  keepInView, zoomView, panView, monthOf, columnUnit, stripTicks, stripLabels, STRIP_MIN_SPAN
} from '$lib/timeline-range.js';
import { addDays } from '$lib/timeline.js';

const extent = { first: '2026-01-05', last: '2026-10-15' };

describe('rangePreset', () => {
  it('offers the four presets', () => {
    expect(RANGE_PRESETS.map((p) => p.id)).toEqual(['latest', 'day', 'week', 'month']);
  });

  it('latest = the last day with ink, whatever the range', () => {
    expect(rangePreset('latest', { from: '2026-03-01', to: '2026-03-02' }, extent))
      .toEqual({ from: '2026-10-15', to: '2026-10-15' });
  });

  it('anchors on the range end when it is inside the ink', () => {
    const r = { from: '2026-03-01', to: '2026-03-10' };
    expect(rangePreset('day', r, extent)).toEqual({ from: '2026-03-10', to: '2026-03-10' });
    expect(rangePreset('week', r, extent)).toEqual({ from: '2026-03-04', to: '2026-03-10' });
    expect(rangePreset('month', r, extent)).toEqual({ from: '2026-02-09', to: '2026-03-10' });
  });

  it('anchors on the last day when the range ends past the ink, or there is none', () => {
    expect(rangePreset('day', { from: '2026-11-01', to: '2026-11-03' }, extent))
      .toEqual({ from: '2026-10-15', to: '2026-10-15' });
    expect(rangePreset('week', { from: null, to: null }, extent))
      .toEqual({ from: '2026-10-09', to: '2026-10-15' });
  });

  it('null without ink or for an unknown preset', () => {
    expect(rangePreset('day', { from: null, to: null }, null)).toBeNull();
    expect(rangePreset('year', { from: null, to: null }, extent)).toBeNull();
  });
});

describe('dayOffset', () => {
  it('counts calendar days, across a DST change', () => {
    expect(dayOffset('2026-01-05', '2026-01-05')).toBe(0);
    expect(dayOffset('2026-03-30', '2026-03-28')).toBe(2);   // EU DST
    expect(dayOffset('2026-03-09', '2026-03-07')).toBe(2);   // US DST
    expect(dayOffset('2026-11-02', '2026-10-31')).toBe(2);
    expect(dayOffset('2026-01-04', '2026-01-05')).toBe(-1);
  });

  it('null for unparseable keys', () => {
    expect(dayOffset('nope', '2026-01-05')).toBeNull();
    expect(dayOffset('2026-01-05', null)).toBeNull();
  });
});

describe('strip view (zoom, Nov 2026)', () => {
  // 2026: 365 days, 1 January a Thursday.
  const days = [
    { day: '2026-01-01', strokes: 10 },
    { day: '2026-01-02', strokes: 5 },
    { day: '2026-01-10', strokes: 40 },
    { day: '2026-12-31', strokes: 1 }
  ];
  const ext = stripExtent(days);
  const at = (off) => addDays('2026-01-01', off);

  it('the extent counts every calendar day; null without ink', () => {
    expect(ext).toEqual({ first: '2026-01-01', last: '2026-12-31', totalDays: 365 });
    expect(stripExtent([])).toBeNull();
    expect(stripExtent(null)).toBeNull();
  });

  it('clampView keeps the zoom limits and the ink', () => {
    expect(clampView({ start: 5, span: 3 }, ext)).toEqual({ first: '2026-01-01', start: 5, span: STRIP_MIN_SPAN });
    expect(clampView({ start: 5, span: 900 }, ext)).toEqual({ first: '2026-01-01', start: 0, span: 365 });
    expect(clampView({ start: 400, span: 20 }, ext).start).toBe(345);
    expect(clampView({ start: -9, span: 20 }, ext).start).toBe(0);
    // Ink shorter than the minimum: the whole ink.
    expect(clampView({ start: 0, span: 2 }, stripExtent(days.slice(0, 3))).span).toBe(10);
  });

  it('rebaseView keeps the same calendar days when the first day moves', () => {
    const later = { first: '2026-01-05', last: '2026-12-31', totalDays: 361 };
    expect(rebaseView({ first: '2026-01-01', start: 10, span: 20 }, later)).toEqual({ first: '2026-01-05', start: 6, span: 20 });
    expect(rebaseView(null, ext)).toBeNull();
  });

  it('fitView centres about six times the range, at least 90 days', () => {
    expect(fitView(at(179), at(185), ext)).toEqual({ first: '2026-01-01', start: 137.5, span: 90 });
    expect(fitView(at(100), at(129), ext).span).toBe(180);
    expect(fitView(null, null, ext)).toEqual({ first: '2026-01-01', start: 275, span: 90 });
    expect(fitView(at(1), at(2), null)).toBeNull();
  });

  it('keepInView leaves a view showing the range, else slides just far enough', () => {
    const v = { first: '2026-01-01', start: 100, span: 50 };
    expect(keepInView(v, at(120), at(126), ext)).toEqual(v);
    expect(keepInView(v, at(200), at(206), ext)).toEqual({ first: '2026-01-01', start: 159.5, span: 50 });
    expect(keepInView(v, at(80), at(82), ext)).toEqual({ first: '2026-01-01', start: 77.5, span: 50 });
  });

  it('keepInView widens the view for a range longer than it', () => {
    expect(keepInView({ start: 100, span: 50 }, at(0), at(99), ext)).toEqual({ first: '2026-01-01', start: 0, span: 125 });
  });

  it('zoomView keeps the anchor where it was on screen', () => {
    const v = zoomView({ start: 50, span: 100 }, 100, 0.5, 2, ext);
    expect(v).toEqual({ first: '2026-01-01', start: 0, span: 200 });
    const z = zoomView({ start: 150, span: 100 }, 190, 0.4, 0.5, ext);
    expect(z.span).toBe(50);
    expect((190 - z.start) / z.span).toBeCloseTo(0.4);
  });

  it('zoomView stops at the zoom limits', () => {
    expect(zoomView({ start: 150, span: 20 }, 160, 0.5, 0.1, ext).span).toBe(STRIP_MIN_SPAN);
    expect(zoomView({ start: 0, span: 300 }, 160, 0.5, 4, ext)).toEqual({ first: '2026-01-01', start: 0, span: 365 });
  });

  it('panView slides without leaving the ink', () => {
    expect(panView({ start: 100, span: 50 }, -30, ext).start).toBe(70);
    expect(panView({ start: 100, span: 50 }, 900, ext).start).toBe(315);
  });

  it('monthOf gives the calendar month', () => {
    expect(monthOf('2026-02-14')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthOf('2024-02-29')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
    expect(monthOf('nope')).toBeNull();
  });

  it('columnUnit: days, then weeks, then months', () => {
    expect(columnUnit(3)).toBe('day');
    expect(columnUnit(1)).toBe('week');
    expect(columnUnit(0.4)).toBe('month');
  });

  it('day columns over a zoomed view, empty days included', () => {
    const l = stripLayout(days, { first: '2026-01-01', start: 0, span: 20 }, 200);
    expect(l.unit).toBe('day');
    expect(l.columns).toHaveLength(20);
    expect(l.columns[0]).toEqual({ from: '2026-01-01', to: '2026-01-01', off: 0, len: 1, strokes: 10 });
    expect(l.columns[5].strokes).toBe(0);
    expect(l.columns[9].strokes).toBe(40);
    expect(l.max).toBe(40);
  });

  it('week columns run Monday to Sunday, the first one starting before the ink', () => {
    const l = stripLayout(days, null, 400);
    expect(l.unit).toBe('week');
    expect(l.columns[0]).toEqual({ from: '2025-12-29', to: '2026-01-04', off: -3, len: 7, strokes: 15 });
    expect(l.columns[1]).toMatchObject({ from: '2026-01-05', to: '2026-01-11', strokes: 40 });
    expect(l.columns.at(-1).to >= '2026-12-31').toBe(true);
  });

  it('month columns are calendar months', () => {
    const l = stripLayout(days, null, 100);
    expect(l.unit).toBe('month');
    expect(l.columns).toHaveLength(12);
    expect(l.columns[0]).toEqual({ from: '2026-01-01', to: '2026-01-31', off: 0, len: 31, strokes: 55 });
    expect(l.columns[1]).toMatchObject({ from: '2026-02-01', len: 28, strokes: 0 });
  });

  it('a view saved against another first day is rebased', () => {
    const l = stripLayout(days.slice(1), { first: '2026-01-01', start: 10, span: 20 }, 200);
    expect(l.first).toBe('2026-01-02');
    expect(l.start).toBe(9);
    expect(l.columns[0].from).toBe('2026-01-11');
  });

  it('null for no ink', () => {
    expect(stripLayout([], null, 100)).toBeNull();
    expect(stripLayout(null, null, 100)).toBeNull();
  });

  it('ticks take the smallest step that has room', () => {
    const near = stripLayout(days, { start: 0, span: 20 }, 600);
    expect(stripTicks(near, 600).slice(0, 2)).toEqual([
      { day: '2026-01-01', off: 0, kind: 'year' }, { day: '2026-01-02', off: 1, kind: 'day' }
    ]);
    const weeks = stripLayout(days, { start: 0, span: 20 }, 200);
    expect(stripTicks(weeks, 200).map((t) => t.day)).toEqual(['2026-01-05', '2026-01-12', '2026-01-19']);
    const year = stripLayout(days, null, 400);
    expect(stripTicks(year, 400)).toEqual([
      { day: '2026-01-01', off: 0, kind: 'year' }, { day: '2026-04-01', off: 90, kind: 'quarter' },
      { day: '2026-07-01', off: 181, kind: 'quarter' }, { day: '2026-10-01', off: 273, kind: 'quarter' }
    ]);
    expect(stripTicks(null, 100)).toEqual([]);
  });

  it('labels: placed in pixels, the year first, crowded ones dropped', () => {
    const year = stripLayout(days, null, 400);
    const l = stripLabels(year, 400);
    expect(l.map((x) => x.text)).toEqual(['2026', 'Q2', 'Q3', 'Q4']);
    expect(l[1].x).toBeCloseTo((90 / 365) * 400);
    // Narrower: Q2 would start inside "2026", so it is dropped.
    expect(stripLabels(year, 400, 90).map((x) => x.text)).toEqual(['2026', 'Q3']);
    expect(stripLabels(null, 400)).toEqual([]);
  });
});

describe('dayAtFraction / windowFraction', () => {
  const days = [{ day: '2026-01-01', strokes: 1 }, { day: '2026-12-31', strokes: 1 }];
  const all = stripLayout(days.slice(0, 1).concat([{ day: '2026-01-10', strokes: 1 }]), null, 100);
  const zoomed = stripLayout(days, { start: 10, span: 20 }, 200);

  it('maps a position to its day, clamped to the view', () => {
    expect(dayAtFraction(0, all)).toBe('2026-01-01');
    expect(dayAtFraction(0.55, all)).toBe('2026-01-06');
    expect(dayAtFraction(1, all)).toBe('2026-01-10');
    expect(dayAtFraction(-3, all)).toBe('2026-01-01');
    expect(dayAtFraction(0, zoomed)).toBe('2026-01-11');
    expect(dayAtFraction(0.5, zoomed)).toBe('2026-01-21');
    expect(dayAtFraction(1, zoomed)).toBe('2026-01-30');
    expect(dayAtFraction(0.5, null)).toBeNull();
  });

  it('places a range as fractions of the view', () => {
    expect(windowFraction('2026-01-01', '2026-01-10', all)).toEqual({ left: 0, width: 1 });
    expect(windowFraction('2026-01-03', '2026-01-04', all)).toEqual({ left: 0.2, width: 0.2 });
    expect(windowFraction('2026-01-13', '2026-01-14', zoomed)).toEqual({ left: 0.1, width: 0.1 });
  });

  it('clips a range that runs past the view, and drops one wholly outside', () => {
    expect(windowFraction('2025-12-25', '2026-01-02', all)).toEqual({ left: 0, width: 0.2 });
    expect(windowFraction('2026-01-06', '2026-01-16', zoomed)).toEqual({ left: 0, width: 0.3 });
    expect(windowFraction('2026-03-01', '2026-03-03', zoomed)).toBeNull();
    expect(windowFraction(null, '2026-01-02', all)).toBeNull();
  });
});

describe('moveWindow / resizeWindow', () => {
  it('slides keeping the length', () => {
    expect(moveWindow('2026-01-03', '2026-01-05', 2, '2026-01-01', '2026-01-10'))
      .toEqual({ from: '2026-01-05', to: '2026-01-07' });
  });

  it('stops at either end of the ink', () => {
    expect(moveWindow('2026-01-03', '2026-01-05', -9, '2026-01-01', '2026-01-10'))
      .toEqual({ from: '2026-01-01', to: '2026-01-03' });
    expect(moveWindow('2026-01-03', '2026-01-05', 30, '2026-01-01', '2026-01-10'))
      .toEqual({ from: '2026-01-08', to: '2026-01-10' });
  });

  it('a range longer than the span pins to its start', () => {
    expect(moveWindow('2025-12-01', '2026-02-01', 3, '2026-01-01', '2026-01-10'))
      .toEqual({ from: '2026-01-01', to: '2026-03-04' });
  });

  it('resizes one end without crossing the other', () => {
    expect(resizeWindow('start', '2026-01-03', '2026-01-05', '2026-01-01'))
      .toEqual({ from: '2026-01-01', to: '2026-01-05' });
    expect(resizeWindow('start', '2026-01-03', '2026-01-05', '2026-01-09'))
      .toEqual({ from: '2026-01-05', to: '2026-01-05' });
    expect(resizeWindow('end', '2026-01-03', '2026-01-05', '2026-01-08'))
      .toEqual({ from: '2026-01-03', to: '2026-01-08' });
    expect(resizeWindow('end', '2026-01-03', '2026-01-05', '2026-01-01'))
      .toEqual({ from: '2026-01-03', to: '2026-01-03' });
  });
});
