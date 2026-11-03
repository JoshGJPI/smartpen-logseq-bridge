/**
 * The Timeline's opening day and Today button (v3.10.0):
 *   lib/timeline-range.js  defaultTimelineDay
 *   stores/timeline.js     loadTimeline's default range, timelineRangeIsDefault,
 *                          setTimelineRange, showTimelineToday
 *
 * What matters: the Timeline opens on today only when today has ink on disk
 * (never on an empty day nobody asked for); an app-picked range follows a
 * refresh (a save today, a new day), a range the user picked never moves; the
 * Today button shows today with or without ink.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let index = { pages: {} };
vi.mock('$lib/storage/local-store.js', () => ({ getTimelineIndex: vi.fn(async () => index) }));

import { get } from 'svelte/store';
import { defaultTimelineDay } from '$lib/timeline-range.js';
import { dayKey } from '$lib/timeline.js';
import {
  timelineRange, timelineRangeIsDefault, loadTimeline, setTimelineRange, showTimelineToday
} from '../../stores/timeline.js';
import { dataRoot, dataFolderReady } from '../../stores/settings.js';

const at = (y, m, d, h = 10) => new Date(y, m - 1, d, h).getTime();
const entry = (book, page, days) => ({ book, page, pageId: String(page), days, firstStroke: null, lastStroke: null });

describe('defaultTimelineDay', () => {
  const days = [{ day: '2026-10-30' }, { day: '2026-11-02' }, { day: '2026-11-03' }];

  it('today when today has ink', () => {
    expect(defaultTimelineDay(days, '2026-11-03')).toBe('2026-11-03');
  });

  it('else the last day with ink', () => {
    expect(defaultTimelineDay(days.slice(0, 2), '2026-11-03')).toBe('2026-11-02');
    // A clock behind the ink still lands on today when today has some.
    expect(defaultTimelineDay(days, '2026-11-02')).toBe('2026-11-02');
  });

  it('null on no ink or bad input', () => {
    expect(defaultTimelineDay([], '2026-11-03')).toBeNull();
    expect(defaultTimelineDay(null, '2026-11-03')).toBeNull();
  });
});

describe('the default range in the store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(at(2026, 11, 3));
    dataRoot.set('C:/data');
    dataFolderReady.set(true);
    timelineRange.set({ from: null, to: null });
    timelineRangeIsDefault.set(true);
    index = { pages: { '388/1': entry('388', 1, { '2026-11-01': 12 }) } };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens on the last day with ink when today has none', async () => {
    await loadTimeline({ silent: true });
    expect(get(timelineRange)).toEqual({ from: '2026-11-01', to: '2026-11-01' });
  });

  it('moves to today once today has ink (a save, a refresh)', async () => {
    await loadTimeline({ silent: true });
    index = { pages: { ...index.pages, '388/2': entry('388', 2, { '2026-11-03': 4 }) } };
    await loadTimeline({ silent: true });
    expect(get(timelineRange)).toEqual({ from: '2026-11-03', to: '2026-11-03' });
  });

  it('follows a new day while the app is left open', async () => {
    index = { pages: { '388/1': entry('388', 1, { '2026-11-03': 12 }) } };
    await loadTimeline({ silent: true });
    vi.setSystemTime(at(2026, 11, 4));
    index = { pages: { ...index.pages, '388/2': entry('388', 2, { '2026-11-04': 3 }) } };
    await loadTimeline({ silent: true });
    expect(get(timelineRange)).toEqual({ from: '2026-11-04', to: '2026-11-04' });
  });

  it('never moves a range the user picked', async () => {
    await loadTimeline({ silent: true });
    setTimelineRange('2026-10-01', '2026-10-07');
    expect(get(timelineRangeIsDefault)).toBe(false);
    index = { pages: { ...index.pages, '388/2': entry('388', 2, { '2026-11-03': 4 }) } };
    await loadTimeline({ silent: true });
    expect(get(timelineRange)).toEqual({ from: '2026-10-01', to: '2026-10-07' });
  });

  it('Today shows today with no ink, and a refresh leaves it there', async () => {
    await loadTimeline({ silent: true });
    showTimelineToday();
    expect(get(timelineRange)).toEqual({ from: dayKey(Date.now()), to: '2026-11-03' });
    await loadTimeline({ silent: true });
    expect(get(timelineRange)).toEqual({ from: '2026-11-03', to: '2026-11-03' });
  });

  it('an empty folder leaves the range unset', async () => {
    index = { pages: {} };
    await loadTimeline({ silent: true });
    expect(get(timelineRange)).toEqual({ from: null, to: null });
  });
});
