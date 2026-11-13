import { describe, it, expect } from 'vitest';
import { pageKeyMatches, findPageKey, collectVisibleTranscriptions } from '../canvas-text-view.js';

const pt = (book, page, extra = {}) => ({
  pageKey: `S3/O1012/B${book}/P${page}`,
  pageInfo: { section: 3, owner: 1012, book, page },
  text: `run ${book}/${page}`,
  strokeCount: 4,
  ...extra
});
const rec = (book, page, extra = {}) => ({ book, page, pageId: String(page), transcriptionText: `saved ${book}/${page}`, strokeCount: 9, ...extra });

describe('pageKeyMatches', () => {
  it('matches book key and page', () => {
    expect(pageKeyMatches('S3/O1012/B388/P41', '388', 41)).toBe(true);
    expect(pageKeyMatches('S3/O1012/B388v2/P41', '388v2', 41)).toBe(true);
  });
  it('never lets volume 1 match volume 2', () => {
    expect(pageKeyMatches('S3/O1012/B388v2/P41', '388', 41)).toBe(false);
    expect(pageKeyMatches('S3/O1012/B388/P41', '388v2', 41)).toBe(false);
  });
  it('does not match a longer page number', () => {
    expect(pageKeyMatches('S3/O1012/B388/P410', '388', 41)).toBe(false);
  });
  it('rejects garbage', () => {
    expect(pageKeyMatches('B388/P41', '388', 41)).toBe(false);
    expect(pageKeyMatches('', '388', 41)).toBe(false);
  });
});

describe('findPageKey', () => {
  it('finds by book and page, ignoring section / owner', () => {
    const keys = new Map([['S3/O1012/B388/P40', {}], ['S3/O1012/B388/P41', {}]]).keys();
    expect(findPageKey(keys, '388', 41)).toBe('S3/O1012/B388/P41');
  });
  it('returns null when absent or empty', () => {
    expect(findPageKey([], '388', 41)).toBeNull();
    expect(findPageKey(['S3/O1012/B12/P1'], '388', 41)).toBeNull();
  });
});

describe('collectVisibleTranscriptions', () => {
  it('returns nothing for no shown pages', () => {
    expect(collectVisibleTranscriptions({ selectedPages: new Set(), pageTranscriptions: [pt('388', 1)] })).toEqual([]);
  });

  it('prefers the unsaved run over the saved text for one page', () => {
    const out = collectVisibleTranscriptions({
      selectedPages: new Set(['S3/O1012/B388/P1']),
      pageTranscriptions: [pt('388', 1)],
      savedPages: [rec('388', 1)]
    });
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe('myscript');
  });

  it('matches a saved record (no section / owner) to the canvas page', () => {
    const out = collectVisibleTranscriptions({
      selectedPages: new Set(['S3/O1012/B388/P2']),
      savedPages: [rec('388', 2), rec('388', 3), rec('388', 4, { transcriptionText: null })]
    });
    expect(out.map(t => t.pageId)).toEqual(['2']);
    expect(out[0]).toMatchObject({ source: 'saved', lines: null, strokeCount: 9 });
  });

  it('keeps a suffixed page id', () => {
    const out = collectVisibleTranscriptions({
      selectedPages: new Set(['S3/O1012/B388/P151']),
      savedPages: [rec('388', 151, { pageId: '151b' })]
    });
    expect(out[0].pageId).toBe('151b');
  });

  it('orders volume keys by book key, then page (no NaN sort)', () => {
    const shown = new Set(['S3/O1012/B388v2/P1', 'S3/O1012/B388/P5', 'S3/O1012/B388/P2', 'S3/O1012/B12/P9']);
    const out = collectVisibleTranscriptions({
      selectedPages: shown,
      pageTranscriptions: [pt('388v2', 1), pt('388', 5)],
      savedPages: [rec('388', 2), rec('12', 9)]
    });
    expect(out.map(t => `${t.pageInfo.book}/${t.pageInfo.page}`)).toEqual(['12/9', '388/2', '388/5', '388v2/1']);
  });

  it('tolerates missing inputs', () => {
    expect(collectVisibleTranscriptions({ selectedPages: new Set(['x']), pageTranscriptions: null, savedPages: null })).toEqual([]);
  });
});
