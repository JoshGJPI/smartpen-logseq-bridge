/**
 * lib/global-search.js (reading-first package E): the prebuilt index, ranking,
 * grouping into Pages / Notebooks / Days, the reader's line match and the
 * Ctrl K key rule.
 *
 * What matters: same matches as Transcripts → Search, Day results agree with
 * the (filtered) Timeline index, results by date include untranscribed pages,
 * and Ctrl K never takes a keystroke from a field or a transcript edit.
 */
import { describe, it, expect } from 'vitest';
import {
  buildSearchIndex, searchIndex, runSearch, flattenResults, matchingLineId, bestLine,
  isSearchShortcut, recordsByKey, snippetHtml
} from '$lib/global-search.js';
import { searchPages } from '$lib/transcript-search.js';
import { parseSearchQuery } from '$lib/search-query.js';
import { pageDates } from '$lib/library-home.js';

const now = new Date(2026, 9, 19, 15);
const q = (s) => parseSearchQuery(s, { now });
const ms = (y, m, d) => new Date(y, m - 1, d, 10).getTime();

const records = [
  { book: '388', pageId: '170', page: 170, transcriptionText: '10/19/26\n10:00 5444-006 Rich update\n  beam check at grid B\nstatus:: done' },
  { book: '388', pageId: '101', page: 101, transcriptionText: 'Beam sizes\nfooting F1' },
  { book: '390v2', pageId: '3', page: 3, transcriptionText: 'Study: steel beams and columns' },
  { book: '387', pageId: '31', page: 31, transcriptionText: null },
  { book: '390', pageId: '151b', page: 151, transcriptionText: 'notes' }
];
const timeline = {
  pages: {
    a: { book: '388', page: 170, pageId: '170', days: { '2026-10-14': 40 }, lastStroke: ms(2026, 10, 14) },
    b: { book: '388', page: 101, pageId: '101', days: { '2026-06-01': 9 }, lastStroke: ms(2026, 6, 1) },
    c: { book: '387', page: 31, pageId: '31', days: { '2026-10-14': 70 }, lastStroke: ms(2026, 10, 14) },
    d: { book: '390v2', page: 3, pageId: '3', days: { '2026-09-01': 3 }, lastStroke: ms(2026, 9, 1) }
  }
};
const notebooks = [
  { book: '387', name: 'JPI Ruled' }, { book: '388', name: 'JPI Dotted' },
  { book: '390', name: 'Study Notes 1' }, { book: '390v2', name: 'Study Notes 3' }
];
const index = buildSearchIndex(records);
const ctx = { index, notebooks, timeline, dates: pageDates(timeline), records: recordsByKey(records) };
const keys = (list) => list.map((p) => p.key);

describe('buildSearchIndex', () => {
  it('one entry per transcribed page; properties dropped from lines', () => {
    expect(index.map((e) => e.key)).toEqual(['388/170', '388/101', '390v2/3', '390/151b']);
    expect(index[0].lines).toEqual(['10/19/26', '10:00 5444-006 Rich update', 'beam check at grid B']);
    expect(buildSearchIndex(null)).toEqual([]);
  });
});

describe('searchIndex', () => {
  it('matches the same pages as searchPages', () => {
    for (const s of ['beam', 'beam footing', 'ric', '5444-006', 'steel col', 'zzz']) {
      const want = searchPages(records, s).map((r) => `${r.book}/${r.pageId}`).sort();
      const got = searchIndex(index, q(s).tokens).map((h) => h.entry.key).sort();
      expect(got).toEqual(want);
    }
  });

  it('ranks more words, then whole words, then most recent', () => {
    // "beam": whole word on 170 and 101 (recent 170 first), partial on 390v2/3 ("beams").
    expect(searchIndex(index, ['beam'], { dates: ctx.dates }).map((h) => h.entry.key)).toEqual(['388/170', '388/101', '390v2/3']);
    expect(searchIndex(index, ['beam', 'footing']).map((h) => h.entry.key)[0]).toBe('388/101');
  });

  it('no tokens, no hits', () => {
    expect(searchIndex(index, [])).toEqual([]);
  });
});

describe('runSearch', () => {
  it('words: pages with a snippet of the best line', () => {
    const r = runSearch(q('rich update'), ctx);
    expect(keys(r.pages)).toEqual(['388/170']);
    expect(r.pages[0].snippet).toBe('10:00 5444-006 Rich update');
    expect(r.order[0]).toBe('pages');
  });

  it('a date alone: Days first, and every page written that day, transcribed or not', () => {
    const r = runSearch(q('Oct 14'), ctx);
    expect(r.days).toEqual([{ day: '2026-10-14', pages: 2, strokes: 110 }]);
    expect(keys(r.pages)).toEqual(['387/31', '388/170']); // most ink that day first
    expect(r.order).toEqual(['days', 'pages', 'notebooks']);
  });

  it('date + words: only pages written on that day', () => {
    expect(keys(runSearch(q('beam Oct 14'), ctx).pages)).toEqual(['388/170']);
    expect(keys(runSearch(q('footing Oct 14'), ctx).pages)).toEqual([]);
  });

  it('a day with no ink gives no Day result', () => {
    const r = runSearch(q('Oct 13'), ctx);
    expect(r.days).toEqual([]);
    expect(r.total).toBe(0);
  });

  it('Day results read the index they are given (the filtered one)', () => {
    const filtered = { pages: { a: timeline.pages.a } };
    expect(runSearch(q('2026-10-14'), { ...ctx, timeline: filtered }).days[0].pages).toBe(1);
    expect(runSearch(q('2026-10-14'), { ...ctx, timeline: null }).days).toEqual([]);
  });

  it('a notebook name: Notebooks first when exact, pages still searched', () => {
    const r = runSearch(q('Study Notes 3'), ctx);
    expect(r.notebooks.map((n) => n.book)).toEqual(['390v2']);
    expect(r.order[0]).toBe('notebooks');
    expect(runSearch(q('study'), ctx).order[0]).toBe('pages');
  });

  it('empty or one-letter query gives nothing', () => {
    expect(runSearch(q(''), ctx).total).toBe(0);
    expect(runSearch(q('a'), ctx).total).toBe(0);
    expect(runSearch(null, ctx).total).toBe(0);
  });

  it('flattenResults follows the group order', () => {
    const r = runSearch(q('Oct 14'), ctx);
    expect(flattenResults(r).map((x) => x.group)).toEqual(['days', 'pages', 'pages']);
    expect(flattenResults(null)).toEqual([]);
  });
});

describe('line match and snippet', () => {
  const lines = [
    { id: 'a', text: '10/19/26' },
    { id: 'b', text: '10:00 5444-006 Rich update' },
    { id: 'c', text: 'Rich: beam update' },
    { id: 'd', text: '' }
  ];

  it('matchingLineId: most query words, first wins; null without a match', () => {
    expect(matchingLineId(lines, ['rich', 'update'])).toBe('b');
    expect(matchingLineId(lines, ['beam'])).toBe('c');
    expect(matchingLineId(lines, ['zzz'])).toBe(null);
    expect(matchingLineId(lines, [])).toBe(null);
    expect(matchingLineId(null, ['x'])).toBe(null);
  });

  it('bestLine and escaped snippet HTML', () => {
    expect(bestLine(['a', 'beam <b>'], ['beam'])).toBe('beam <b>');
    expect(snippetHtml('beam <b>', q('beam'))).toBe('<mark>beam</mark> &lt;b&gt;');
  });
});

describe('isSearchShortcut', () => {
  const ev = (o) => ({ key: 'k', ctrlKey: true, target: { tagName: 'DIV', getAttribute: () => null }, ...o });

  it('Ctrl K and Cmd K, either case', () => {
    expect(isSearchShortcut(ev())).toBe(true);
    expect(isSearchShortcut(ev({ ctrlKey: false, metaKey: true }))).toBe(true);
    expect(isSearchShortcut(ev({ key: 'K' }))).toBe(true);
  });

  it('not bare K, not with Alt or Shift, not other keys', () => {
    expect(isSearchShortcut(ev({ ctrlKey: false }))).toBe(false);
    expect(isSearchShortcut(ev({ altKey: true }))).toBe(false);
    expect(isSearchShortcut(ev({ shiftKey: true }))).toBe(false);
    expect(isSearchShortcut(ev({ key: 'f' }))).toBe(false);
    expect(isSearchShortcut(null)).toBe(false);
  });

  it('not while typing, mid-IME, already handled, or editing a transcript', () => {
    expect(isSearchShortcut(ev({ target: { tagName: 'INPUT' } }))).toBe(false);
    expect(isSearchShortcut(ev({ target: { tagName: 'TEXTAREA' } }))).toBe(false);
    expect(isSearchShortcut(ev({ target: { tagName: 'DIV', isContentEditable: true } }))).toBe(false);
    expect(isSearchShortcut(ev({ isComposing: true }))).toBe(false);
    expect(isSearchShortcut(ev({ defaultPrevented: true }))).toBe(false);
    expect(isSearchShortcut(ev(), { editing: true })).toBe(false);
  });
});
