/**
 * lib/viewer/reading-order.js (v3.2.0): the Library reader's Book | Tag order.
 *
 * What matters: Tag order walks the grid's pages notebook-then-page (volumes
 * after their notebook, suffixed pages after their integer page), an
 * unfiltered notebook grid hands over nothing, pages gone since are skipped,
 * and the reader never shows Tag order for a page that isn't in it.
 */
import { describe, it, expect } from 'vitest';
import {
  buildSequence, sequenceRecords, readerPageList, landingInSequence, sequenceCrumb, sequenceLabel
} from '$lib/viewer/reading-order.js';

const rec = (book, pageId) => ({
  book: String(book),
  pageId: String(pageId),
  page: parseInt(pageId, 10),
  suffix: String(pageId).replace(/^\d+/, '')
});
const byKey = (records) => new Map(records.map((r) => [`${r.book}/${r.pageId}`, r]));

const a12 = rec('388', '12');
const a40 = rec('388', '40');
const a151b = rec('388', '151b');
const a151 = rec('388', '151');
const v2 = rec('388v2', '3');
const c5 = rec('3017', '5');
const all = [a12, a40, a151, a151b, v2, c5];

describe('buildSequence', () => {
  it('sorts the shown pages notebook then page, volume after its notebook', () => {
    const seq = buildSequence({ records: [c5, v2, a151b, a40, a151, a12], origin: { kind: 'tag', tag: 'beam' } });
    expect(seq.keys).toEqual(['388/12', '388/40', '388/151', '388/151b', '388v2/3', '3017/5']);
    expect(seq.origin).toEqual({ kind: 'tag', tag: 'beam' });
    expect(seq.chosen).toEqual([]);
  });

  it('an unfiltered notebook grid has no Tag order', () => {
    expect(buildSequence({ records: [a12, a40], origin: { kind: 'notebook', book: '388' } })).toBe(null);
  });

  it('a filtered notebook grid does, with its filter', () => {
    const seq = buildSequence({ records: [a40, a12], origin: { kind: 'notebook', book: '388' }, chosen: ['beam', 'slab'], mode: 'all' });
    expect(seq.keys).toEqual(['388/12', '388/40']);
    expect(seq.chosen).toEqual(['beam', 'slab']);
    expect(seq.mode).toBe('all');
  });

  it('Untagged is a sequence even with no filter', () => {
    expect(buildSequence({ records: [a12], origin: { kind: 'untagged' } }).keys).toEqual(['388/12']);
  });

  it('nothing shown or no origin: null', () => {
    expect(buildSequence({ records: [], origin: { kind: 'tag', tag: 'beam' } })).toBe(null);
    expect(buildSequence({ records: [a12], origin: null })).toBe(null);
  });

  it('does not reorder the caller’s array', () => {
    const shown = [c5, a12];
    buildSequence({ records: shown, origin: { kind: 'untagged' } });
    expect(shown).toEqual([c5, a12]);
  });
});

describe('sequenceRecords', () => {
  it('resolves keys in order and skips pages that have gone', () => {
    const seq = { keys: ['388/12', '388/99', '3017/5'], chosen: [], mode: 'any', origin: { kind: 'untagged' } };
    expect(sequenceRecords(seq, byKey(all))).toEqual([a12, c5]);
  });

  it('no sequence: empty', () => {
    expect(sequenceRecords(null, byKey(all))).toEqual([]);
  });
});

describe('readerPageList', () => {
  const sequence = [a12, v2, c5];
  const bookPages = [a12, a40, a151, a151b];

  it('Tag order when the open page is in the sequence', () => {
    expect(readerPageList({ order: 'tag', sequence, selection: { book: '388', pageId: '12' }, bookPages }))
      .toEqual({ pages: sequence, order: 'tag' });
  });

  it('falls back to the notebook when the open page is not in the sequence', () => {
    expect(readerPageList({ order: 'tag', sequence, selection: { book: '388', pageId: '40' }, bookPages }))
      .toEqual({ pages: bookPages, order: 'book' });
  });

  it('matches book and page together (same page id, another volume)', () => {
    expect(readerPageList({ order: 'tag', sequence, selection: { book: '388', pageId: '3' }, bookPages }).order).toBe('book');
  });

  it('Book order, or nothing open: the notebook', () => {
    expect(readerPageList({ order: 'book', sequence, selection: { book: '388', pageId: '12' }, bookPages }).order).toBe('book');
    expect(readerPageList({ order: 'tag', sequence, selection: null, bookPages: [] })).toEqual({ pages: [], order: 'book' });
  });
});

describe('landingInSequence', () => {
  const sequence = [a12, a151, c5];

  it('the first sequence page at or after the open page', () => {
    expect(landingInSequence(sequence, a40)).toBe(a151);
    expect(landingInSequence(sequence, v2)).toBe(c5);
    expect(landingInSequence(sequence, a12)).toBe(a12);
  });

  it('past the end: the last; nothing open: the first; empty: null', () => {
    expect(landingInSequence(sequence, rec('3017', '9'))).toBe(c5);
    expect(landingInSequence(sequence, null)).toBe(a12);
    expect(landingInSequence([], a12)).toBe(null);
  });
});

describe('sequenceCrumb', () => {
  it('single page and spread', () => {
    expect(sequenceCrumb(2, 9, false)).toBe('3 of 9');
    expect(sequenceCrumb(2, 9, true)).toBe('3–4 of 9');
  });

  it('the last page of a spread shows alone', () => {
    expect(sequenceCrumb(8, 9, true)).toBe('9 of 9');
  });

  it('out of range: empty', () => {
    expect(sequenceCrumb(-1, 9, true)).toBe('');
    expect(sequenceCrumb(0, 0, true)).toBe('');
    expect(sequenceCrumb(9, 9, false)).toBe('');
  });
});

describe('sequenceLabel', () => {
  const name = (b) => ({ 388: 'Site 3' })[b] || `B${b}`;

  it('a tag, and a tag filtered by more', () => {
    expect(sequenceLabel({ origin: { kind: 'tag', tag: 'beam' }, chosen: [], mode: 'any' })).toBe('Tag: beam');
    expect(sequenceLabel({ origin: { kind: 'tag', tag: 'beam' }, chosen: ['slab'], mode: 'any' })).toBe('Tag: beam + slab');
    expect(sequenceLabel({ origin: { kind: 'tag', tag: 'beam' }, chosen: ['slab', 'wall'], mode: 'any' })).toBe('Tag: beam + (slab / wall)');
    expect(sequenceLabel({ origin: { kind: 'tag', tag: 'beam' }, chosen: ['slab', 'wall'], mode: 'all' })).toBe('Tag: beam + slab + wall');
  });

  it('a filtered notebook names the notebook', () => {
    expect(sequenceLabel({ origin: { kind: 'notebook', book: '388' }, chosen: ['beam', 'slab'], mode: 'any' }, name)).toBe('Site 3 · beam / slab');
    expect(sequenceLabel({ origin: { kind: 'notebook', book: '388' }, chosen: ['beam', 'slab'], mode: 'all' }, name)).toBe('Site 3 · beam + slab');
  });

  it('Untagged, and nothing', () => {
    expect(sequenceLabel({ origin: { kind: 'untagged' }, chosen: [], mode: 'any' })).toBe('Untagged');
    expect(sequenceLabel(null)).toBe('');
  });
});
