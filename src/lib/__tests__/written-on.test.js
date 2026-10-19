/**
 * lib/viewer/written-on.js (reading-first package D): the header's written
 * date and the ribbon's day chips, built from pageDayGroups so a chip, its
 * highlighted ink and the Timeline day it opens agree.
 */
import { describe, it, expect } from 'vitest';
import { writtenLabel, writtenChips } from '$lib/viewer/written-on.js';
import { pageDayGroups } from '$lib/viewer/page-sittings.js';

const g = (index, day, n = 1) => ({ index, day, strokes: Array.from({ length: n }, () => ({})) });

describe('writtenLabel', () => {
  it('empty for no groups', () => {
    expect(writtenLabel([])).toBe('');
    expect(writtenLabel(null)).toBe('');
  });

  it('one day', () => {
    expect(writtenLabel([g(0, '2026-09-30')])).toBe('Sep 30, 2026');
  });

  it('a range within a year', () => {
    expect(writtenLabel([g(0, '2026-09-30'), g(1, '2026-10-02'), g(2, '2026-10-05')])).toBe('Sep 30 – Oct 5, 2026');
  });

  it('a range across years', () => {
    expect(writtenLabel([g(0, '2025-12-30'), g(1, '2026-01-02')])).toBe('Dec 30, 2025 – Jan 2, 2026');
  });

  it('skips unparseable days', () => {
    expect(writtenLabel([g(0, 'junk'), g(1, '2026-10-05')])).toBe('Oct 5, 2026');
  });
});

describe('writtenChips', () => {
  it('one chip per day, in order, with stroke counts in the title', () => {
    const chips = writtenChips([g(0, '2026-09-30', 1), g(1, '2026-10-02', 12)]);
    expect(chips.map((c) => c.label)).toEqual(['Sep 30', 'Oct 2']);
    expect(chips.map((c) => c.index)).toEqual([0, 1]);
    expect(chips[0].title).toMatch(/^Sep 30, 2026 · 1 stroke · /);
    expect(chips[1].title).toMatch(/12 strokes/);
  });

  it('shows the year on every chip when the days span years', () => {
    expect(writtenChips([g(0, '2025-12-30'), g(1, '2026-01-02')]).map((c) => c.label))
      .toEqual(['Dec 30, 2025', 'Jan 2, 2026']);
  });

  it('empty for nothing', () => {
    expect(writtenChips([])).toEqual([]);
    expect(writtenChips(undefined)).toEqual([]);
  });

  it('agrees with pageDayGroups on local days', () => {
    const t = (d, h) => new Date(2026, 9, d, h).getTime();
    const s = (ms) => ({ id: `s${ms}`, startTime: ms, endTime: ms + 100, points: [[1, 1, ms], [2, 2, ms + 100]] });
    // 23:30 on the 4th and 00:30 on the 5th are two local days
    const { groups } = pageDayGroups([s(t(5, 0) + 30 * 60e3), s(t(4, 23) + 30 * 60e3)]);
    expect(writtenChips(groups).map((c) => c.day)).toEqual(['2026-10-04', '2026-10-05']);
    expect(writtenLabel(groups)).toBe('Oct 4 – Oct 5, 2026');
  });
});
