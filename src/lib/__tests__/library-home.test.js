/**
 * lib/library-home.js (reading-first package E): notebook card numbers from
 * scan records + the capture-date index, sort orders, the Recent row and a
 * notebook's page tiles.
 *
 * What matters: no number needs a page read; volumes are their own notebooks;
 * untimed pages and empty books don't break anything; dates come from the
 * index (stroke startTime), never metadata.lastUpdated.
 */
import { describe, it, expect } from 'vitest';
import {
  pageDates, notebookCards, sortNotebooks, parseSortOrder, recentRecords,
  shortDay, writtenRange, relativeDay, pageTiles, pageKeyOf, SORT_ORDERS
} from '$lib/library-home.js';

const ms = (y, m, d, h = 10) => new Date(y, m - 1, d, h).getTime();
const rec = (book, pageId, extra = {}) => ({
  book, pageId: String(pageId), page: parseInt(pageId, 10), strokeCount: 10, transcribed: false,
  lastUpdated: '2030-01-01T00:00:00Z', ...extra
});

function entry(book, pageId, days, lastStroke) {
  return { book, page: parseInt(pageId, 10), pageId: String(pageId), days, firstStroke: null, lastStroke };
}

const index = {
  pages: {
    '388/1': entry('388', '1', { '2026-02-05': 30 }, ms(2026, 2, 5)),
    '388/2': entry('388', '2', { '2026-02-06': 5, '2026-06-25': 7 }, ms(2026, 6, 25)),
    '388/3': entry('388', '3', { '2026-03-01': 4 }, ms(2026, 3, 1)),
    '388/4': entry('388', '4', {}, null), // untimed
    '388v2/1': entry('388v2', '1', { '2026-10-14': 9 }, ms(2026, 10, 14)),
    '390/151b': entry('390', '151b', { '2026-09-01': 2 }, ms(2026, 9, 1))
  }
};

const pagesByBook = {
  '388': [rec('388', 1, { transcribed: true }), rec('388', 2), rec('388', 3, { transcribed: true }), rec('388', 4)],
  '388v2': [rec('388v2', 1)],
  '390': [rec('390', 151), rec('390', '151b', { suffix: 'b' })],
  '400': []
};
const bookIds = ['388', '388v2', '390', '400'];

describe('pageDates', () => {
  it('first/last day, day count and last time per page; untimed pages absent', () => {
    const d = pageDates(index);
    expect(d.get('388/2')).toEqual({ first: '2026-02-06', last: '2026-06-25', days: 2, lastMs: ms(2026, 6, 25) });
    expect(d.has('388/4')).toBe(false);
    expect(d.get('390/151b').first).toBe('2026-09-01');
  });

  it('empty and malformed indexes give an empty map', () => {
    expect(pageDates(null).size).toBe(0);
    expect(pageDates({ pages: { x: { book: '1' } } }).size).toBe(0);
  });

  it('falls back to the last day when lastStroke is missing', () => {
    const d = pageDates({ pages: { a: entry('5', '1', { '2026-01-02': 1 }, undefined) } });
    expect(d.get('5/1').lastMs).toBe(new Date(2026, 0, 2).getTime());
  });
});

describe('notebookCards', () => {
  const cards = notebookCards(pagesByBook, bookIds, pageDates(index), (b) => `Book ${b}`);
  const by = (b) => cards.find((c) => c.book === b);

  it('one card per book key with pages; empty books skipped', () => {
    expect(cards.map((c) => c.book)).toEqual(['388', '388v2', '390']);
  });

  it('counts pages, transcribed %, strokes from the scan records', () => {
    expect(by('388')).toMatchObject({ pageCount: 4, transcribed: 2, transcribedPct: 50, strokes: 40, name: 'Book 388' });
  });

  it('first–last written from the index, ignoring metadata.lastUpdated and untimed pages', () => {
    expect(by('388')).toMatchObject({ first: '2026-02-05', last: '2026-06-25', lastMs: ms(2026, 6, 25) });
  });

  it('a volume is its own notebook with its badge number', () => {
    expect(by('388v2')).toMatchObject({ volume: 2, pageCount: 1, first: '2026-10-14' });
    expect(by('388').volume).toBe(1);
  });

  it('fan: most recently written first, topped up from the end of the book', () => {
    expect(by('388').fan.map((r) => r.pageId)).toEqual(['2', '3', '1']);
    // 390: only P151b is timed; P151 tops it up.
    expect(by('390').fan.map((r) => r.pageId)).toEqual(['151b', '151']);
  });

  it('a notebook with no timed ink has null dates and a fan from its last pages', () => {
    const c = notebookCards({ '7': [rec('7', 1), rec('7', 2), rec('7', 3), rec('7', 4)] }, ['7'], new Map())[0];
    expect(c).toMatchObject({ first: null, last: null, lastMs: null });
    expect(c.fan.map((r) => r.pageId)).toEqual(['4', '3', '2']);
  });

  it('bad input gives no cards', () => {
    expect(notebookCards(null, bookIds, new Map())).toEqual([]);
    expect(notebookCards(pagesByBook, null, new Map())).toEqual([]);
  });
});

describe('sortNotebooks', () => {
  const cards = [
    { book: '3880', name: 'Zeta', pageCount: 5, lastMs: 10 },
    { book: '388v2', name: 'alpha', pageCount: 9, lastMs: null },
    { book: '388', name: 'Beta', pageCount: 9, lastMs: 30 },
    { book: '12', name: 'Notes 10', pageCount: 1, lastMs: 20 },
    { book: '13', name: 'Notes 9', pageCount: 1, lastMs: null }
  ];
  const ids = (list) => list.map((c) => c.book);

  it('recent: newest first, untimed last (by name)', () => {
    expect(ids(sortNotebooks(cards, 'recent'))).toEqual(['388', '12', '3880', '388v2', '13']);
  });

  it('name: case-insensitive and numeric-aware', () => {
    expect(ids(sortNotebooks(cards, 'name'))).toEqual(['388v2', '388', '13', '12', '3880']);
  });

  it('pages: most first, ties by name', () => {
    expect(ids(sortNotebooks(cards, 'pages'))).toEqual(['388v2', '388', '3880', '13', '12']);
  });

  it('does not mutate; unknown order is recent', () => {
    const copy = [...cards];
    sortNotebooks(cards, 'name');
    expect(cards).toEqual(copy);
    expect(ids(sortNotebooks(cards, 'bogus'))).toEqual(ids(sortNotebooks(cards, 'recent')));
    expect(sortNotebooks(null, 'name')).toEqual([]);
  });
});

describe('parseSortOrder', () => {
  it('accepts known ids, anything else is recent', () => {
    for (const o of SORT_ORDERS) expect(parseSortOrder(o.id)).toBe(o.id);
    expect(parseSortOrder(null)).toBe('recent');
    expect(parseSortOrder('{"x":1}')).toBe('recent');
  });
});

describe('recentRecords', () => {
  it('keeps pages that still exist, in recent order, with numeric or string books', () => {
    const recent = [
      { book: '390', pageId: '151b' },
      { book: 388, pageId: '2' },
      { book: '388', pageId: '99' },
      { book: '999', pageId: '1' }
    ];
    expect(recentRecords(recent, pagesByBook).map((r) => `${r.book}/${r.pageId}`)).toEqual(['390/151b', '388/2']);
    expect(recentRecords(recent, pagesByBook, 1)).toHaveLength(1);
    expect(recentRecords(null, pagesByBook)).toEqual([]);
  });
});

describe('date labels', () => {
  const now = new Date(2026, 9, 19, 12);

  it('shortDay drops the current year', () => {
    expect(shortDay('2026-10-14', now)).toBe('Oct 14');
    expect(shortDay('2025-12-03', now)).toBe('Dec 3, 2025');
    expect(shortDay('nope', now)).toBe('');
  });

  it('writtenRange: one day, a range, nothing', () => {
    expect(writtenRange('2026-10-14', '2026-10-14')).toBe('Oct 14, 2026');
    expect(writtenRange('2026-02-05', '2026-06-25')).toBe('Feb 5 – Jun 25, 2026');
    expect(writtenRange(null, null)).toBe('');
  });

  it('relativeDay', () => {
    expect(relativeDay('2026-10-19', now)).toBe('today');
    expect(relativeDay('2026-10-18', now)).toBe('yesterday');
    expect(relativeDay('2026-10-15', now)).toBe('4 days ago');
    expect(relativeDay('2026-10-01', now)).toBe('Oct 1');
    expect(relativeDay('', now)).toBe('');
  });
});

describe('pageTiles', () => {
  it('suffixed pages keep scan order; untimed pages have no badge', () => {
    const t = pageTiles(pagesByBook['390'], '390', pageDates(index));
    expect(t.map((x) => x.pageId)).toEqual(['151', '151b']);
    expect(t[0]).toMatchObject({ first: null, days: 0 });
    expect(t[1]).toMatchObject({ first: '2026-09-01', days: 1 });
  });

  it('carries the transcribed flag and handles empty input', () => {
    expect(pageTiles(pagesByBook['388'], '388', new Map())[0].transcribed).toBe(true);
    expect(pageTiles(null, '1', null)).toEqual([]);
    expect(pageKeyOf('388v2', '151b')).toBe('388v2/151b');
  });
});
