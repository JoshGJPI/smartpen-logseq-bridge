import { describe, it, expect } from 'vitest';
import {
  pageIdFromCanvasKey,
  selectionPageIds,
  shownPageIds,
  singlePageTarget,
  comparePageIds,
  tagTargetPages,
  suggestionLinesFor,
  MAX_TAG_TARGETS
} from '../canvas-page-targets.js';

const stroke = (book, page) => ({ pageInfo: { section: 3, owner: 1012, book, page } });

describe('pageIdFromCanvasKey', () => {
  it('reads book keys with volumes', () => {
    expect(pageIdFromCanvasKey('S3/O1012/B388/P42')).toBe('388/42');
    expect(pageIdFromCanvasKey('S3/O1012/B388v2/P7')).toBe('388v2/7');
  });
  it('rejects anything else', () => {
    expect(pageIdFromCanvasKey('B388/P42')).toBeNull();
    expect(pageIdFromCanvasKey('S3/O1012/B388/P42/x')).toBeNull();
    expect(pageIdFromCanvasKey(null)).toBeNull();
    expect(pageIdFromCanvasKey('')).toBeNull();
  });
});

describe('selectionPageIds', () => {
  it('lists each page once, in first-seen order', () => {
    const strokes = [stroke('388', 2), stroke('388', 1), stroke('388', 2), stroke('388v2', 1)];
    expect(selectionPageIds(strokes, new Set([0, 1, 2, 3]))).toEqual(['388/2', '388/1', '388v2/1']);
  });
  it('skips missing strokes and strokes without a page', () => {
    const strokes = [stroke('388', 2), { pageInfo: null }, { pageInfo: { book: '388' } }];
    expect(selectionPageIds(strokes, [0, 1, 2, 9])).toEqual(['388/2']);
  });
  it('is empty for no selection', () => {
    expect(selectionPageIds([stroke('388', 1)], new Set())).toEqual([]);
    expect(selectionPageIds(null, null)).toEqual([]);
  });
  it('keeps page 0', () => {
    expect(selectionPageIds([stroke('388', 0)], [0])).toEqual(['388/0']);
  });
});

describe('shownPageIds', () => {
  it('keeps ticked pages that are still loaded', () => {
    const loaded = new Map([['S3/O1012/B388/P1', {}], ['S3/O1012/B388/P2', {}]]);
    expect(shownPageIds(new Set(['S3/O1012/B388/P1', 'S3/O1012/B388/P3']), loaded)).toEqual(['388/1']);
  });
  it('is empty with nothing ticked', () => {
    expect(shownPageIds(new Set(), new Map())).toEqual([]);
  });
});

describe('singlePageTarget (rotate)', () => {
  it('uses the selection when there is one', () => {
    expect(singlePageTarget(['388/1'], ['388/1', '388/2'], true)).toBe('388/1');
    expect(singlePageTarget(['388/1', '388/2'], ['388/1'], true)).toBeNull();
  });
  it('falls back to the only page shown', () => {
    expect(singlePageTarget([], ['388/2'], false)).toBe('388/2');
    expect(singlePageTarget([], ['388/1', '388/2'], false)).toBeNull();
    expect(singlePageTarget([], [], false)).toBeNull();
  });
});

describe('comparePageIds', () => {
  it('sorts pages numerically and book keys with compareBookKeys', () => {
    const ids = ['388v2/1', '388/10', '3880/1', '388/9'];
    expect([...ids].sort(comparePageIds)).toEqual(['388/9', '388/10', '388v2/1', '3880/1']);
  });
});

describe('tagTargetPages (Tags popover)', () => {
  it('lists every shown page with no selection, sorted', () => {
    const r = tagTargetPages([], ['388/10', '388/2'], false);
    expect(r.pages).toEqual([{ book: '388', pageId: '2' }, { book: '388', pageId: '10' }]);
    expect(r.more).toBe(0);
    expect(r.fromSelection).toBe(false);
  });
  it('lists only the selection pages when strokes are selected', () => {
    const r = tagTargetPages(['388/5', '388/3'], ['388/1', '388/3', '388/5'], true);
    expect(r.pages.map((p) => p.pageId)).toEqual(['3', '5']);
    expect(r.fromSelection).toBe(true);
  });
  it('falls back to shown pages when the selection has no page', () => {
    const r = tagTargetPages([], ['388/1'], true);
    expect(r.pages).toEqual([{ book: '388', pageId: '1' }]);
    expect(r.fromSelection).toBe(false);
  });
  it('caps the list and counts the rest', () => {
    const shown = Array.from({ length: MAX_TAG_TARGETS + 3 }, (_, i) => `388/${i + 1}`);
    const r = tagTargetPages([], shown, false);
    expect(r.pages).toHaveLength(MAX_TAG_TARGETS);
    expect(r.more).toBe(3);
  });
  it('is empty with nothing shown', () => {
    expect(tagTargetPages([], [], false)).toEqual({ pages: [], more: 0, fromSelection: false });
  });
  it('keeps volume book keys', () => {
    expect(tagTargetPages([], ['388v2/4'], false).pages).toEqual([{ book: '388v2', pageId: '4' }]);
  });
});

describe('suggestionLinesFor', () => {
  const records = [
    { book: '388', page: 4, pageId: '4', transcriptionText: 'Call re P2026-141\n  check 2327-018' },
    { book: '388v2', page: 4, pageId: '4', transcriptionText: 'other volume 2206-017' },
    { book: '388', page: 5, pageId: '5', transcriptionText: null }
  ];
  it('reads the saved transcript of the right book key', () => {
    const lines = suggestionLinesFor({ book: '388', pageId: '4' }, records);
    expect(lines.map((l) => l.text)).toEqual(['Call re P2026-141', 'check 2327-018']);
  });
  it('adds unsaved MyScript lines after the saved ones', () => {
    const lines = suggestionLinesFor({ book: '388', pageId: '5' }, records, [{ id: 'a', text: 'new 5656-006' }]);
    expect(lines).toEqual([{ id: 'a', text: 'new 5656-006' }]);
  });
  it('is empty for a page never saved and never transcribed', () => {
    expect(suggestionLinesFor({ book: '999', pageId: '1' }, records, null)).toEqual([]);
    expect(suggestionLinesFor({ book: '999', pageId: '1' }, null, [])).toEqual([]);
  });
  it('matches a record without pageId by its page number', () => {
    const lines = suggestionLinesFor({ book: '1', pageId: '2' }, [{ book: '1', page: 2, transcriptionText: 'x' }]);
    expect(lines).toEqual([{ id: null, text: 'x' }]);
  });
});
