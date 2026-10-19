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
  windowFraction, moveWindow, resizeWindow
} from '$lib/timeline-range.js';

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

describe('stripLayout', () => {
  const days = [
    { day: '2026-01-01', strokes: 10 },
    { day: '2026-01-02', strokes: 5 },
    { day: '2026-01-10', strokes: 40 }
  ];

  it('one column per day when it fits, empty days included', () => {
    const l = stripLayout(days, 100);
    expect(l.totalDays).toBe(10);
    expect(l.bucket).toBe(1);
    expect(l.columns).toHaveLength(10);
    expect(l.columns[0]).toEqual({ from: '2026-01-01', to: '2026-01-01', strokes: 10 });
    expect(l.columns[5].strokes).toBe(0);
    expect(l.max).toBe(40);
  });

  it('buckets days when the span is wider than the strip', () => {
    const l = stripLayout(days, 4);
    expect(l.bucket).toBe(3);
    expect(l.columns.map((c) => c.strokes)).toEqual([15, 0, 0, 40]);
    // The last column is short: it ends on the last day, not past it.
    expect(l.columns[3]).toEqual({ from: '2026-01-10', to: '2026-01-10', strokes: 40 });
  });

  it('a single day', () => {
    const l = stripLayout([{ day: '2026-05-05', strokes: 3 }], 50);
    expect(l.totalDays).toBe(1);
    expect(l.columns).toHaveLength(1);
  });

  it('null for no ink; tolerates a bad column count', () => {
    expect(stripLayout([], 50)).toBeNull();
    expect(stripLayout(null, 50)).toBeNull();
    expect(stripLayout(days, 0).bucket).toBe(10);
  });
});

describe('dayAtFraction / windowFraction', () => {
  const l = stripLayout([{ day: '2026-01-01', strokes: 1 }, { day: '2026-01-10', strokes: 1 }], 100);

  it('maps a position to its day, clamped to the strip', () => {
    expect(dayAtFraction(0, l)).toBe('2026-01-01');
    expect(dayAtFraction(0.55, l)).toBe('2026-01-06');
    expect(dayAtFraction(1, l)).toBe('2026-01-10');
    expect(dayAtFraction(-3, l)).toBe('2026-01-01');
    expect(dayAtFraction(7, l)).toBe('2026-01-10');
    expect(dayAtFraction(0.5, null)).toBeNull();
  });

  it('places a range as fractions of the width', () => {
    expect(windowFraction('2026-01-01', '2026-01-10', l)).toEqual({ left: 0, width: 1 });
    expect(windowFraction('2026-01-03', '2026-01-04', l)).toEqual({ left: 0.2, width: 0.2 });
  });

  it('clips a range that runs past the ink, and drops one wholly outside', () => {
    expect(windowFraction('2025-12-25', '2026-01-02', l)).toEqual({ left: 0, width: 0.2 });
    expect(windowFraction('2026-02-01', '2026-02-03', l)).toBeNull();
    expect(windowFraction(null, '2026-01-02', l)).toBeNull();
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
