import { describe, it, expect } from 'vitest';
import {
  dayKey, dayStart, addDays, rangeBoundsMs, inRange, eachDay,
  timelinePages, dayTotals, timelineExtent, pagesInRange, rangeSummary, pagesOnDay,
  filterIndexByBooks, indexBooks
} from '../timeline.js';

/** A timeline index entry. `days` is the histogram the main process builds. */
function page(book, pageId, days, extra = {}) {
  const strokes = Object.values(days).reduce((a, b) => a + b, 0);
  return {
    book: String(book),
    page: parseInt(pageId, 10),
    pageId: String(pageId),
    suffix: String(pageId).replace(/^\d+/, ''),
    strokes,
    days,
    ...extra
  };
}

function index(...pages) {
  const map = {};
  for (const p of pages) map[`${p.book}/${p.pageId}`] = p;
  return { version: 1, builtAt: '2026-09-22T00:00:00.000Z', pages: map };
}

/** Local midnight, so the fixtures don't depend on the machine's zone. */
function at(y, m, d, h = 12) {
  return new Date(y, m - 1, d, h).getTime();
}

describe('dayKey', () => {
  it('formats a local calendar day', () => {
    expect(dayKey(at(2026, 8, 17))).toBe('2026-08-17');
  });

  it('zero-pads month and day', () => {
    expect(dayKey(at(2026, 1, 5))).toBe('2026-01-05');
  });

  it('uses the LOCAL day, not UTC — a late-evening stroke stays on its own day', () => {
    // 23:30 local on the 17th is the 18th in UTC east of Greenwich. The user
    // picked "the 17th" meaning the evening they were writing.
    expect(dayKey(at(2026, 8, 17, 23))).toBe('2026-08-17');
    expect(dayKey(at(2026, 8, 17, 0))).toBe('2026-08-17');
  });

  it('returns null for an unusable timestamp', () => {
    expect(dayKey(NaN)).toBeNull();
  });
});

describe('dayStart / addDays', () => {
  it('parses a day key to local midnight', () => {
    const d = dayStart('2026-08-17');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(7);
    expect(d.getDate()).toBe(17);
    expect(d.getHours()).toBe(0);
  });

  it('rejects anything that is not a day key', () => {
    expect(dayStart('2026-8-17')).toBeNull();
    expect(dayStart('not a date')).toBeNull();
    expect(dayStart(null)).toBeNull();
  });

  it('adds and subtracts days across a month boundary', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDays('2026-09-01', -1)).toBe('2026-08-31');
  });

  it('crosses a year boundary', () => {
    expect(addDays('2025-12-31', 1)).toBe('2026-01-01');
  });
});

describe('rangeBoundsMs', () => {
  it('is half-open: end is midnight STARTING the day after `to`', () => {
    const b = rangeBoundsMs('2026-08-17', '2026-08-19');
    expect(b.startMs).toBe(at(2026, 8, 17, 0));
    expect(b.endMs).toBe(at(2026, 8, 20, 0));
  });

  it('includes a stroke started exactly at midnight on the first day', () => {
    const b = rangeBoundsMs('2026-08-17', '2026-08-17');
    const midnight = at(2026, 8, 17, 0);
    expect(midnight >= b.startMs && midnight < b.endMs).toBe(true);
  });

  it('excludes a stroke started exactly at midnight after the last day', () => {
    const b = rangeBoundsMs('2026-08-17', '2026-08-17');
    const nextMidnight = at(2026, 8, 18, 0);
    expect(nextMidnight < b.endMs).toBe(false);
  });

  it('covers the last millisecond of the final day', () => {
    const b = rangeBoundsMs('2026-08-17', '2026-08-17');
    expect(at(2026, 8, 18, 0) - 1 < b.endMs).toBe(true);
  });

  it('normalises a reversed range', () => {
    expect(rangeBoundsMs('2026-08-19', '2026-08-17'))
      .toEqual(rangeBoundsMs('2026-08-17', '2026-08-19'));
  });

  it('returns null rather than an open range when an end is unparseable', () => {
    expect(rangeBoundsMs('nonsense', '2026-08-19')).toBeNull();
    expect(rangeBoundsMs('2026-08-17', null)).toBeNull();
  });
});

describe('inRange', () => {
  it('is inclusive at both ends', () => {
    expect(inRange('2026-08-17', '2026-08-17', '2026-08-19')).toBe(true);
    expect(inRange('2026-08-19', '2026-08-17', '2026-08-19')).toBe(true);
  });

  it('excludes days outside', () => {
    expect(inRange('2026-08-16', '2026-08-17', '2026-08-19')).toBe(false);
    expect(inRange('2026-08-20', '2026-08-17', '2026-08-19')).toBe(false);
  });

  it('tolerates a reversed range', () => {
    expect(inRange('2026-08-18', '2026-08-19', '2026-08-17')).toBe(true);
  });

  it('is false for missing input rather than matching everything', () => {
    expect(inRange(null, '2026-08-17', '2026-08-19')).toBe(false);
    expect(inRange('2026-08-18', null, '2026-08-19')).toBe(false);
  });
});

describe('eachDay', () => {
  it('includes both ends and the days between', () => {
    expect(eachDay('2026-08-17', '2026-08-19'))
      .toEqual(['2026-08-17', '2026-08-18', '2026-08-19']);
  });

  it('returns one day for a single-day range', () => {
    expect(eachDay('2026-08-17', '2026-08-17')).toEqual(['2026-08-17']);
  });

  it('includes days with no capture — a gap is information', () => {
    expect(eachDay('2026-08-30', '2026-09-02')).toHaveLength(4);
  });
});

describe('timelinePages', () => {
  it('drops entries with no day histogram rather than throwing on them', () => {
    const idx = { pages: { a: page('388', '42', { '2026-08-17': 3 }), b: { book: '388' }, c: null } };
    expect(timelinePages(idx)).toHaveLength(1);
  });

  it('returns nothing for a missing or malformed index', () => {
    expect(timelinePages(null)).toEqual([]);
    expect(timelinePages({})).toEqual([]);
    expect(timelinePages({ pages: 'nope' })).toEqual([]);
  });
});

describe('dayTotals', () => {
  it('sums strokes and counts pages per day, ascending', () => {
    const idx = index(
      page('388', '42', { '2026-08-17': 652, '2026-08-13': 1128 }),
      page('388', '43', { '2026-08-17': 2364 })
    );
    expect(dayTotals(idx)).toEqual([
      { day: '2026-08-13', strokes: 1128, pages: 1 },
      { day: '2026-08-17', strokes: 3016, pages: 2 }
    ]);
  });

  it('ignores zero-count days so an empty bucket never shows as a capture day', () => {
    const idx = index(page('388', '42', { '2026-08-17': 0, '2026-08-18': 5 }));
    expect(dayTotals(idx).map(d => d.day)).toEqual(['2026-08-18']);
  });

  it('is empty for an empty index', () => {
    expect(dayTotals(index())).toEqual([]);
  });
});

describe('timelineExtent', () => {
  it('reports the first and last day with ink', () => {
    const idx = index(
      page('388', '42', { '2026-08-17': 1 }),
      page('3017', '154', { '2025-12-09': 1, '2026-09-21': 1 })
    );
    expect(timelineExtent(idx)).toEqual({ first: '2025-12-09', last: '2026-09-21' });
  });

  it('is null when nothing has been captured', () => {
    expect(timelineExtent(index())).toBeNull();
  });
});

describe('pagesInRange', () => {
  const idx = index(
    // Spans the range boundary — the case the whole feature exists for.
    page('388', '42', { '2026-08-13': 1128, '2026-08-17': 652 }),
    page('388', '43', { '2026-08-17': 2364 }),
    page('388', '44', { '2026-08-17': 444, '2026-08-18': 1454 }),
    // Entirely outside.
    page('388', '50', { '2026-08-27': 597 })
  );

  it('includes only pages with ink inside the range', () => {
    const got = pagesInRange(idx, '2026-08-17', '2026-08-19').map(p => p.pageId);
    expect(got).toEqual(['42', '43', '44']);
  });

  it('splits each page into in-range and context strokes', () => {
    const p42 = pagesInRange(idx, '2026-08-17', '2026-08-19').find(p => p.pageId === '42');
    expect(p42.inRangeStrokes).toBe(652);
    expect(p42.totalStrokes).toBe(1780);
    expect(p42.contextStrokes).toBe(1128);
  });

  it('reports no context for a page written entirely inside the range', () => {
    const p43 = pagesInRange(idx, '2026-08-17', '2026-08-19').find(p => p.pageId === '43');
    expect(p43.contextStrokes).toBe(0);
    expect(p43.days).toEqual(['2026-08-17']);
  });

  it('counts a page whose in-range days are split across the range', () => {
    const p44 = pagesInRange(idx, '2026-08-17', '2026-08-19').find(p => p.pageId === '44');
    expect(p44.inRangeStrokes).toBe(1898);
    expect(p44.contextStrokes).toBe(0);
    expect(p44.days).toEqual(['2026-08-17', '2026-08-18']);
  });

  it('firstDay is the earliest day INSIDE the range, not the page\'s own first day', () => {
    // B388/P42's first day is 13 Aug, which is outside — filing it under that
    // would put it in a row for a day the user did not select.
    const p42 = pagesInRange(idx, '2026-08-17', '2026-08-19').find(p => p.pageId === '42');
    expect(p42.firstDay).toBe('2026-08-17');
  });

  it('orders by first in-range day, then book, then page', () => {
    const wide = index(
      page('3017', '154', { '2026-08-18': 10 }),
      page('388', '43', { '2026-08-17': 10 }),
      page('388', '42', { '2026-08-17': 10 })
    );
    expect(pagesInRange(wide, '2026-08-17', '2026-08-19').map(p => `${p.book}/${p.pageId}`))
      .toEqual(['388/42', '388/43', '3017/154']);
  });

  it('keeps a volume page distinct from its parent book', () => {
    const vol = index(
      page('388', '12', { '2026-08-17': 5 }),
      page('388v2', '12', { '2026-08-17': 7 })
    );
    const got = pagesInRange(vol, '2026-08-17', '2026-08-17');
    expect(got).toHaveLength(2);
    expect(got.map(p => p.book).sort()).toEqual(['388', '388v2']);
  });

  it('keeps letter-suffixed pages separate from the integer page', () => {
    const suffixed = index(
      page('3017', '127', { '2026-08-17': 5 }),
      page('3017', '127b', { '2026-08-17': 7 })
    );
    const got = pagesInRange(suffixed, '2026-08-17', '2026-08-17');
    expect(got.map(p => p.pageId).sort()).toEqual(['127', '127b']);
  });

  it('returns nothing without a range rather than every page', () => {
    expect(pagesInRange(idx, null, '2026-08-19')).toEqual([]);
    expect(pagesInRange(idx, '2026-08-17', null)).toEqual([]);
  });
});

describe('rangeSummary', () => {
  const idx = index(
    page('388', '42', { '2026-08-13': 1128, '2026-08-17': 652 }),
    page('388', '43', { '2026-08-17': 2364 }),
    page('388', '44', { '2026-08-17': 444, '2026-08-18': 1454 }),
    page('388', '45', { '2026-08-18': 820, '2026-08-19': 1387 })
  );

  it('counts days that actually hold ink, not calendar days in the span', () => {
    // 17th–19th is three calendar days and all three have ink here.
    expect(rangeSummary(idx, '2026-08-17', '2026-08-19').days).toBe(3);
    // 20th has none, so widening the span does not add a day.
    expect(rangeSummary(idx, '2026-08-17', '2026-08-20').days).toBe(3);
  });

  it('separates strokes that load from strokes that come as context', () => {
    const s = rangeSummary(idx, '2026-08-17', '2026-08-19');
    expect(s.strokes).toBe(652 + 2364 + 444 + 1454 + 820 + 1387);
    expect(s.contextStrokes).toBe(1128);
  });

  it('counts only the pages that would arrive partially loaded', () => {
    expect(rangeSummary(idx, '2026-08-17', '2026-08-19').partialPages).toBe(1);
  });

  it('reports no partial pages when the range covers every touched page whole', () => {
    const s = rangeSummary(idx, '2026-08-13', '2026-08-19');
    expect(s.partialPages).toBe(0);
    expect(s.contextStrokes).toBe(0);
  });

  it('is all zeroes for an empty range or a missing index', () => {
    expect(rangeSummary(idx, '2026-01-01', '2026-01-02'))
      .toEqual({ days: 0, pages: 0, strokes: 0, contextStrokes: 0, partialPages: 0 });
    expect(rangeSummary(null, '2026-08-17', '2026-08-19').pages).toBe(0);
  });
});

describe('pagesOnDay', () => {
  const idx = index(
    page('388', '42', { '2026-08-13': 1128, '2026-08-17': 652 }),
    page('388', '43', { '2026-08-17': 2364 }),
    page('3017', '154', { '2026-08-17': 342 })
  );

  it('reports each page\'s contribution to that day, not its total', () => {
    const got = pagesOnDay(idx, '2026-08-17');
    expect(got.find(p => p.pageId === '42')).toMatchObject({ strokes: 652, totalStrokes: 1780 });
  });

  it('flags pages that also hold ink on other days', () => {
    const got = pagesOnDay(idx, '2026-08-17');
    expect(got.find(p => p.pageId === '42').spansOtherDays).toBe(true);
    expect(got.find(p => p.pageId === '43').spansOtherDays).toBe(false);
  });

  it('orders by book then page', () => {
    expect(pagesOnDay(idx, '2026-08-17').map(p => `${p.book}/${p.pageId}`))
      .toEqual(['388/42', '388/43', '3017/154']);
  });

  it('is empty for a day with no capture', () => {
    expect(pagesOnDay(idx, '2026-08-16')).toEqual([]);
  });
});

describe('filterIndexByBooks', () => {
  const idx = index(
    page('388', '12', { '2026-09-14': 10 }),
    page('388v2', '12', { '2026-09-14': 20 }),
    page('390', '4', { '2026-09-15': 30 })
  );

  it('returns the same index when nothing is excluded', () => {
    expect(filterIndexByBooks(idx, new Set())).toBe(idx);
    expect(filterIndexByBooks(idx, null)).toBe(idx);
  });

  it('drops the excluded books from every downstream answer', () => {
    const f = filterIndexByBooks(idx, new Set(['390']));
    expect(Object.keys(f.pages).sort()).toEqual(['388/12', '388v2/12']);
    expect(dayTotals(f).map(d => d.day)).toEqual(['2026-09-14']);
    expect(idx.pages['390/4']).toBeDefined(); // the original is untouched
  });

  it('filters volumes of one notebook separately', () => {
    const f = filterIndexByBooks(idx, new Set(['388v2']));
    expect(Object.keys(f.pages).sort()).toEqual(['388/12', '390/4']);
  });

  it('copes with no index', () => {
    expect(filterIndexByBooks(null, new Set(['1']))).toBeNull();
  });
});

describe('indexBooks', () => {
  const idx = index(
    page('3880', '1', { '2026-09-01': 5 }),
    page('388v2', '12', { '2026-09-14': 20, '2026-09-01': 1 }),
    page('388', '12', { '2026-09-14': 10 }),
    page('388', '13', { '2026-09-20': 7 })
  );

  it('lists each book once with its total and in-range strokes', () => {
    const books = indexBooks(idx, '2026-09-10', '2026-09-15');
    expect(books.find(b => b.book === '388')).toEqual({ book: '388', strokes: 17, inRange: 10 });
    expect(books.find(b => b.book === '388v2')).toEqual({ book: '388v2', strokes: 21, inRange: 20 });
    expect(books.find(b => b.book === '3880')).toEqual({ book: '3880', strokes: 5, inRange: 0 });
  });

  it('sorts by book key, so a volume follows its notebook rather than string order', () => {
    expect(indexBooks(idx).map(b => b.book)).toEqual(['388', '388v2', '3880']);
  });

  it('counts nothing in range without a range', () => {
    expect(indexBooks(idx).every(b => b.inRange === 0)).toBe(true);
  });
});
