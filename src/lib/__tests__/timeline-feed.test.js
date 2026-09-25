import { describe, it, expect, vi } from 'vitest';
import {
  SESSION_GAP_MS, PAGE_MIN_WIDTH, PAGE_MIN_HEIGHT, BAND_PAD, BAND_MIN_HEIGHT, BAND_MERGE_GAP,
  indexPageStrokes, sessionBand, sessionBands, daySessions, feedSkeleton, nextFeedRange, extendFeedRange,
  estimateDayHeight, formatDuration
} from '../timeline-feed.js';
import { dayTotals } from '../timeline.js';

vi.mock('../storage/local-store.js', () => ({ getPage: vi.fn() }));
import { createFeedPageLoader } from '../viewer/feed-pages.js';

/** Local time, so the fixtures don't depend on the machine's zone. */
function at(d, h, m = 0, s = 0) {
  return new Date(2026, 8, d, h, m, s).getTime();
}

const MIN = 60 * 1000;

/** A stored stroke at time t, drawn as a short horizontal line at height y. */
function stroke(t, y = 20, extra = {}) {
  return {
    id: `s${t}`,
    startTime: t,
    endTime: t + 500,
    points: [[10, y, t], [14, y + 1, t + 250], [18, y, t + 500]],
    ...extra
  };
}

function pageOf(book, pageId, strokes) {
  return { book, pageId, doc: { strokes } };
}

function timelinePage(book, pageId, days) {
  const strokes = Object.values(days).reduce((a, b) => a + b, 0);
  return { book, page: parseInt(pageId, 10), pageId, suffix: '', strokes, days };
}

function index(...pages) {
  const map = {};
  for (const p of pages) map[`${p.book}/${p.pageId}`] = p;
  return { version: 1, pages: map };
}

describe('daySessions', () => {
  it('keeps only strokes started on that local day', () => {
    const p = pageOf('388', '12', [
      stroke(at(13, 23, 59)),
      stroke(at(14, 0, 0)),     // midnight belongs to the 14th
      stroke(at(14, 23, 59)),
      stroke(at(15, 0, 0))      // …and this midnight to the 15th
    ]);
    const sessions = daySessions([p], '2026-09-14');
    const all = sessions.flatMap(s => [...s.strokes]);
    expect(all.map(s => s.startTime)).toEqual([at(14, 0, 0), at(14, 23, 59)]);
  });

  it('chains strokes that each start within the gap of the previous one', () => {
    // The worked example: writing at 5, 10, 12, 17, 26 and 37 minutes is one
    // sitting however long it runs — each is within 20 min of the one before —
    // and 80 minutes starts the next.
    const t0 = at(14, 9);
    const p = pageOf('388', '12', [5, 10, 12, 17, 26, 37, 80].map(m => stroke(t0 + m * MIN)));
    const sessions = daySessions([p], '2026-09-14');
    expect(sessions.map(s => s.count)).toEqual([6, 1]);
    expect(sessions[0].startTime).toBe(t0 + 5 * MIN);
    expect(sessions[0].lastStart).toBe(t0 + 37 * MIN);
    expect(sessions[1].startTime).toBe(t0 + 80 * MIN);
  });

  it('is one session for continuous writing on one page', () => {
    const p = pageOf('388', '12', [stroke(at(14, 9)), stroke(at(14, 9, 5)), stroke(at(14, 9, 12))]);
    const [s, ...rest] = daySessions([p], '2026-09-14');
    expect(rest).toHaveLength(0);
    expect(s.count).toBe(3);
    expect(s.parts).toHaveLength(1);
    expect(s.parts[0]).toMatchObject({ book: '388', pageId: '12', count: 3 });
    expect(s.startTime).toBe(at(14, 9));
    expect(s.lastStart).toBe(at(14, 9, 12));
    expect(s.endTime).toBe(at(14, 9, 12) + 500);
  });

  it('keeps a sitting together across a page turn, with a part per page', () => {
    // A meeting that runs onto the next page is one card, not two.
    const first = pageOf('388', '12', [stroke(at(14, 9)), stroke(at(14, 9, 10))]);
    const next = pageOf('388', '13', [stroke(at(14, 9, 15)), stroke(at(14, 9, 25))]);
    const sessions = daySessions([first, next], '2026-09-14');
    expect(sessions).toHaveLength(1);
    expect(sessions[0].parts.map(p => `${p.pageId}:${p.count}`)).toEqual(['12:2', '13:2']);
  });

  it('gives a page one part however often the sitting returns to it', () => {
    const a = pageOf('388', '12', [stroke(at(14, 9)), stroke(at(14, 9, 20))]);
    const b = pageOf('390', '4', [stroke(at(14, 9, 10))]);
    const [s] = daySessions([a, b], '2026-09-14');
    // In the order first written on: page 12, then 4.
    expect(s.parts.map(p => `${p.book}/${p.pageId}`)).toEqual(['388/12', '390/4']);
    expect(s.parts[0].count).toBe(2);
    expect(s.parts[0].firstStart).toBe(at(14, 9));
    expect(s.parts[0].lastStart).toBe(at(14, 9, 20));
  });

  it('cuts on a pause longer than the gap, measured from the previous stroke\'s END', () => {
    const t0 = at(14, 9);
    const long = { ...stroke(t0), endTime: t0 + 10 * MIN };  // a 10-minute stroke
    const p = pageOf('388', '12', [
      long,
      // 25 min after the first START but only 15 after its END — same sitting.
      stroke(t0 + 25 * MIN),
      // More than the gap after the previous end — new sitting.
      stroke(t0 + 25 * MIN + 500 + SESSION_GAP_MS + 1)
    ]);
    const sessions = daySessions([p], '2026-09-14');
    expect(sessions.map(s => s.count)).toEqual([2, 1]);
  });

  it('cuts on a pause even when the next stroke is on another page', () => {
    const a = pageOf('388', '12', [stroke(at(14, 9))]);
    const b = pageOf('388', '13', [stroke(at(14, 10))]);
    expect(daySessions([a, b], '2026-09-14').map(s => s.parts[0].pageId)).toEqual(['12', '13']);
  });

  it('does not cut at exactly the gap', () => {
    const t0 = at(14, 9);
    const p = pageOf('388', '12', [stroke(t0), stroke(t0 + 500 + SESSION_GAP_MS)]);
    expect(daySessions([p], '2026-09-14')).toHaveLength(1);
  });

  it('honours a custom gap', () => {
    const p = pageOf('388', '12', [stroke(at(14, 9)), stroke(at(14, 9, 3))]);
    expect(daySessions([p], '2026-09-14', { gapMs: MIN })).toHaveLength(2);
  });

  it('orders by startTime across pages regardless of file order', () => {
    const late = pageOf('388', '12', [stroke(at(14, 15))]);
    const early = pageOf('390', '4', [stroke(at(14, 8))]);
    const sessions = daySessions([late, early], '2026-09-14');
    expect(sessions.map(s => s.parts[0].pageId)).toEqual(['4', '12']);
  });

  it('gives each sitting on a day a distinct id', () => {
    const p = pageOf('388', '12', [stroke(at(14, 9)), stroke(at(14, 15))]);
    const ids = daySessions([p], '2026-09-14').map(s => s.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('holds the doc\'s own stroke objects, so identity tells a card its ink', () => {
    const mine = stroke(at(14, 9));
    const other = stroke(at(12, 9)); // another day, same page
    const p = pageOf('388', '12', [other, mine]);
    const [s] = daySessions([p], '2026-09-14');
    expect(s.strokes.has(mine)).toBe(true);
    expect(s.strokes.has(other)).toBe(false);
    expect(s.parts[0].strokes.has(mine)).toBe(true);
  });

  it('counts a stroke without an id', () => {
    const { id, ...anonymous } = stroke(at(14, 9));
    const [s] = daySessions([pageOf('388', '12', [anonymous])], '2026-09-14');
    expect(s.count).toBe(1);
    expect(s.strokes.has(anonymous)).toBe(true);
  });

  it('falls back to startTime when endTime is missing', () => {
    const t = at(14, 9);
    const p = pageOf('388', '12', [{ id: 'x', startTime: t, points: [[1, 1], [2, 2]] }]);
    expect(daySessions([p], '2026-09-14')[0].endTime).toBe(t);
  });

  it('returns nothing for bad input', () => {
    expect(daySessions(null, '2026-09-14')).toEqual([]);
    expect(daySessions([], 'not-a-day')).toEqual([]);
    expect(daySessions([{ book: '1', pageId: '1', doc: null }], '2026-09-14')).toEqual([]);
  });
});

describe('indexPageStrokes', () => {
  it('lays a sparse page on at least the standard paper frame', () => {
    const idx = indexPageStrokes({ strokes: [stroke(1, 10)] });
    expect(idx.width).toBe(PAGE_MIN_WIDTH);
    expect(idx.height).toBe(PAGE_MIN_HEIGHT);
  });

  it('widens the frame for a wider notebook', () => {
    const wide = { id: 'w', startTime: 1, points: [[5, 10], [90, 110]] };
    const idx = indexPageStrokes({ strokes: [wide] });
    expect(idx.width).toBe(90 + BAND_PAD);
    expect(idx.height).toBe(110 + BAND_PAD);
  });

  it('records each stroke\'s vertical extent and skips strokes with no real points', () => {
    const good = stroke(1, 30);
    const bogus = { id: 'b', startTime: 2, points: [[0, 0], [0.1, 0.1]] };
    const idx = indexPageStrokes({ strokes: [good, bogus] });
    expect(idx.items).toHaveLength(1);
    expect(idx.items[0].stroke).toBe(good);
    expect(idx.items[0].minY).toBe(30);
    expect(idx.items[0].maxY).toBe(31);
  });

  it('does not let the origin dot stretch anything', () => {
    const s = { id: 's', startTime: 1, points: [[0, 0], [20, 50], [22, 52]] };
    expect(indexPageStrokes({ strokes: [s] }).items[0].minY).toBe(50);
  });

  it('copes with an empty doc', () => {
    expect(indexPageStrokes(null)).toEqual({ width: PAGE_MIN_WIDTH, height: PAGE_MIN_HEIGHT, items: [] });
  });
});

describe('sessionBand', () => {
  it('pads the ink on both sides', () => {
    expect(sessionBand({ minY: 30, maxY: 50 }, 92)).toEqual({ y0: 30 - BAND_PAD, y1: 50 + BAND_PAD });
  });

  it('gives a lone mark a minimum-height strip, centred on it', () => {
    const b = sessionBand({ minY: 40, maxY: 40.5 }, 92);
    expect(b.y1 - b.y0).toBeCloseTo(BAND_MIN_HEIGHT);
    expect((b.y0 + b.y1) / 2).toBeCloseTo(40.25);
  });

  it('slides down rather than starting above the page', () => {
    const b = sessionBand({ minY: 0.5, maxY: 1 }, 92);
    expect(b.y0).toBe(0);
    expect(b.y1).toBeCloseTo(BAND_MIN_HEIGHT);
  });

  it('slides up rather than running off the bottom', () => {
    const b = sessionBand({ minY: 91, maxY: 91.5 }, 92);
    expect(b.y1).toBe(92);
    expect(b.y1 - b.y0).toBeCloseTo(BAND_MIN_HEIGHT);
  });
});

describe('sessionBands', () => {
  const ext = (minY, maxY) => ({ minY, maxY });

  it('is one strip for writing that runs down the page', () => {
    const bands = sessionBands([ext(20, 23), ext(25, 28), ext(30, 33)], 92);
    expect(bands).toEqual([{ y0: 20 - BAND_PAD, y1: 33 + BAND_PAD }]);
  });

  it('cuts out blank page between parts of one sitting', () => {
    // Two TODOs ticked seconds apart, one near the top and one near the bottom
    // — the case that made a two-stroke card a page tall.
    const bands = sessionBands([ext(14, 15.5), ext(84.8, 86.6)], 92);
    expect(bands).toHaveLength(2);
    expect(bands[0].y1).toBeLessThan(bands[1].y0);
  });

  it('keeps a gap of up to the merge threshold inside one strip', () => {
    expect(sessionBands([ext(10, 12), ext(12 + BAND_MERGE_GAP, 30)], 92)).toHaveLength(1);
    expect(sessionBands([ext(10, 12), ext(12 + BAND_MERGE_GAP + 0.1, 30)], 92)).toHaveLength(2);
  });

  it('merges clusters whose padded strips would overlap', () => {
    // Far enough apart to be two clusters, but minimum-height padding makes
    // the strips touch — they must not be drawn overlapping.
    const bands = sessionBands([ext(10, 10), ext(10 + BAND_MERGE_GAP + 0.5, 10 + BAND_MERGE_GAP + 0.5)], 92, { mergeGap: 1 });
    for (let i = 1; i < bands.length; i++) expect(bands[i].y0).toBeGreaterThan(bands[i - 1].y1);
  });

  it('sorts input and ignores unusable extents', () => {
    const bands = sessionBands([ext(80, 82), ext(NaN, 5), ext(10, 12)], 92);
    // Each cluster gets exactly sessionBand()'s padding and minimum height.
    expect(bands).toEqual([sessionBand(ext(10, 12), 92), sessionBand(ext(80, 82), 92)]);
  });

  it('still returns one (minimal) strip for a session with no usable ink', () => {
    expect(sessionBands([], 92)).toHaveLength(1);
  });
});

describe('feedSkeleton', () => {
  const idx = index(
    timelinePage('388', '31', { '2026-09-12': 40, '2026-09-14': 311 }),
    timelinePage('388', '7', { '2026-09-14': 486 }),
    timelinePage('390', '12', { '2026-09-15': 355 }),
    timelinePage('390', '13', { '2026-09-18': 345 }),
    timelinePage('390', '14', { '2026-09-22': 10 })
  );
  const days = dayTotals(idx);

  it('lists days with ink inside the range, newest first by default', () => {
    const items = feedSkeleton(idx, days, '2026-09-14', '2026-09-18').filter(i => i.kind === 'day');
    expect(items.map(i => i.day)).toEqual(['2026-09-18', '2026-09-15', '2026-09-14']);
  });

  it('can run oldest first', () => {
    const items = feedSkeleton(idx, days, '2026-09-14', '2026-09-18', 'oldest').filter(i => i.kind === 'day');
    expect(items.map(i => i.day)).toEqual(['2026-09-14', '2026-09-15', '2026-09-18']);
  });

  it('collapses each run of empty days between ink into one entry', () => {
    const items = feedSkeleton(idx, days, '2026-09-14', '2026-09-18', 'oldest');
    expect(items.map(i => i.kind)).toEqual(['day', 'day', 'empty', 'day']);
    expect(items[2]).toEqual({ kind: 'empty', from: '2026-09-16', to: '2026-09-17', count: 2 });
  });

  it('does not pad the range edges with empty entries', () => {
    const items = feedSkeleton(idx, days, '2026-09-10', '2026-09-20', 'oldest');
    expect(items[0].kind).toBe('day');
    expect(items[items.length - 1].kind).toBe('day');
  });

  it('carries each day\'s totals and page chips from the index', () => {
    const day = feedSkeleton(idx, days, '2026-09-14', '2026-09-14')[0];
    expect(day.strokes).toBe(797);
    expect(day.pages).toBe(2);
    expect(day.entries.map(e => e.pageId).sort()).toEqual(['31', '7']);
  });

  it('accepts a reversed range', () => {
    expect(feedSkeleton(idx, days, '2026-09-18', '2026-09-14')).toHaveLength(4);
  });

  it('is empty without an index or a range', () => {
    expect(feedSkeleton(null, days, '2026-09-14', '2026-09-18')).toEqual([]);
    expect(feedSkeleton(idx, days, null, '2026-09-18')).toEqual([]);
  });
});

describe('nextFeedRange', () => {
  it('continues earlier when newest is on top (the feed ends on the oldest day)', () => {
    expect(nextFeedRange('2026-09-14', '2026-09-20', 'newest')).toEqual({ from: '2026-09-07', to: '2026-09-13' });
  });

  it('continues later when oldest is on top', () => {
    expect(nextFeedRange('2026-09-14', '2026-09-20', 'oldest')).toEqual({ from: '2026-09-21', to: '2026-09-27' });
  });

  it('steps one day for a one-day range, across a month boundary', () => {
    expect(nextFeedRange('2026-10-01', '2026-10-01')).toEqual({ from: '2026-09-30', to: '2026-09-30' });
  });

  it('is null without a range', () => {
    expect(nextFeedRange(null, '2026-09-20')).toBeNull();
  });
});

describe('extendFeedRange', () => {
  const days = ['2026-09-01', '2026-09-03', '2026-09-08', '2026-09-10', '2026-09-14', '2026-09-20', '2026-09-22']
    .map(day => ({ day, strokes: 100, pages: 1 }));

  it('reaches back over the next days WITH INK when newest is on top', () => {
    // Range 14–20 Sep; the three earlier ink days are the 10th, 8th and 3rd.
    expect(extendFeedRange(days, '2026-09-14', '2026-09-20', 'newest', 3))
      .toEqual({ from: '2026-09-03', to: '2026-09-20' });
  });

  it('reaches forward when oldest is on top', () => {
    expect(extendFeedRange(days, '2026-09-01', '2026-09-08', 'oldest', 2))
      .toEqual({ from: '2026-09-01', to: '2026-09-14' });
  });

  it('takes what is left when fewer days remain', () => {
    expect(extendFeedRange(days, '2026-09-03', '2026-09-10', 'newest', 3))
      .toEqual({ from: '2026-09-01', to: '2026-09-10' });
  });

  it('is null at the end of the ink', () => {
    expect(extendFeedRange(days, '2026-09-01', '2026-09-22', 'newest')).toBeNull();
    expect(extendFeedRange(days, '2026-09-01', '2026-09-22', 'oldest')).toBeNull();
  });

  it('ignores days with no strokes', () => {
    const withEmpty = [{ day: '2026-09-05', strokes: 0, pages: 0 }, ...days];
    expect(extendFeedRange(withEmpty, '2026-09-08', '2026-09-08', 'newest', 1))
      .toEqual({ from: '2026-09-03', to: '2026-09-08' });
  });

  it('is null without a range', () => {
    expect(extendFeedRange(days, null, '2026-09-08')).toBeNull();
  });
});

describe('estimateDayHeight', () => {
  it('grows with ink and with pages', () => {
    const one = estimateDayHeight([{ strokes: 100 }], 10);
    expect(estimateDayHeight([{ strokes: 500 }], 10)).toBeGreaterThan(one);
    expect(estimateDayHeight([{ strokes: 100 }, { strokes: 100 }], 10)).toBeGreaterThan(one);
  });

  it('never estimates more than a whole page per page', () => {
    const huge = estimateDayHeight([{ strokes: 1e6 }], 10);
    const page = estimateDayHeight([{ strokes: PAGE_MIN_HEIGHT * 11 }], 10);
    expect(huge).toBe(page);
  });
});

describe('formatDuration', () => {
  it.each([
    [0, 'under a minute'],
    [59 * 1000, 'under a minute'],
    [9 * MIN, '9 min'],
    [60 * MIN, '1 h'],
    [95 * MIN, '1 h 35 min'],
    [NaN, 'under a minute']
  ])('%s ms → %s', (ms, text) => {
    expect(formatDuration(ms)).toBe(text);
  });
});

describe('createFeedPageLoader', () => {
  it('reads a page once however many days hold it', async () => {
    const load = vi.fn(async (book, pageId) => ({ book, pageId }));
    const loader = createFeedPageLoader(load);
    const [a, b] = await Promise.all([loader.acquire('388', '12'), loader.acquire('388', '12')]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(loader.size()).toBe(1);
  });

  it('keeps a page until the last holder releases it', async () => {
    const load = vi.fn(async () => ({}));
    const loader = createFeedPageLoader(load);
    await loader.acquire('388', '12');
    await loader.acquire('388', '12');
    loader.release('388', '12');
    expect(loader.size()).toBe(1);
    loader.release('388', '12');
    expect(loader.size()).toBe(0);
    await loader.acquire('388', '12');
    expect(load).toHaveBeenCalledTimes(2); // re-read after it was let go
  });

  it('forgets a failed read so the next acquire retries', async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(new Error('disk'))
      .mockResolvedValueOnce({ ok: true });
    const loader = createFeedPageLoader(load);
    await expect(loader.acquire('388', '12')).rejects.toThrow('disk');
    expect(loader.size()).toBe(0);
    await expect(loader.acquire('388', '12')).resolves.toEqual({ ok: true });
  });

  it('keys by book and page id, so volumes and suffixes stay apart', async () => {
    const load = vi.fn(async (book, pageId) => `${book}/${pageId}`);
    const loader = createFeedPageLoader(load);
    await Promise.all([
      loader.acquire('388', '12'), loader.acquire('388v2', '12'), loader.acquire('388', '12b')
    ]);
    expect(loader.size()).toBe(3);
  });

  it('ignores a release it never handed out, and clears', async () => {
    const loader = createFeedPageLoader(vi.fn(async () => ({})));
    loader.release('1', '1');
    await loader.acquire('388', '12');
    loader.clear();
    expect(loader.size()).toBe(0);
  });
});
