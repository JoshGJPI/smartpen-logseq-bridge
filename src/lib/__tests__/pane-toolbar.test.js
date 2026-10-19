/**
 * lib/pane-toolbar.js (reading-first package C): which View ▾ options are
 * offered where, and the Library breadcrumb's page label.
 *
 * What matters: the menu never offers a switch that does nothing (Paper without
 * any paper, Times on a transcript, anything in the Editor), and the crumb
 * pairs pages exactly as BookViewer's spread does, including suffixed pages.
 */
import { describe, it, expect } from 'vitest';
import { viewOptionsFor, pageCrumb } from '$lib/pane-toolbar.js';

describe('viewOptionsFor', () => {
  it('Editor: nothing', () => {
    expect(viewOptionsFor({ destination: 'editor', hasSelection: true, backgroundsAvailable: true })).toEqual([]);
  });

  it('Library home grid: nothing', () => {
    expect(viewOptionsFor({ destination: 'library', hasSelection: false, backgroundsAvailable: true })).toEqual([]);
  });

  it('Library page showing strokes: content, layout, times, and paper when available', () => {
    expect(viewOptionsFor({ destination: 'library', hasSelection: true, contentMode: 'strokes', backgroundsAvailable: true }))
      .toEqual(['content', 'layout', 'times', 'paper']);
    expect(viewOptionsFor({ destination: 'library', hasSelection: true, contentMode: 'strokes' }))
      .toEqual(['content', 'layout', 'times']);
  });

  it('Library page in Ink + text: Times applies (ink is shown)', () => {
    expect(viewOptionsFor({ destination: 'library', hasSelection: true, contentMode: 'inktext', backgroundsAvailable: true }))
      .toEqual(['content', 'layout', 'times', 'paper']);
  });

  it('Library page showing the transcript: no Times', () => {
    expect(viewOptionsFor({ destination: 'library', hasSelection: true, contentMode: 'transcript' }))
      .toEqual(['content', 'layout']);
  });

  it('Timeline: order, plus paper when available', () => {
    expect(viewOptionsFor({ destination: 'timeline' })).toEqual(['order']);
    expect(viewOptionsFor({ destination: 'timeline', backgroundsAvailable: true })).toEqual(['paper', 'order']);
  });

  it('unknown destination: nothing', () => {
    expect(viewOptionsFor({ destination: 'book' })).toEqual([]);
  });
});

describe('pageCrumb', () => {
  const pages = {
    '388': [{ pageId: '12', page: 12 }, { pageId: '13', page: 13 }, { pageId: '13b', page: 13 }],
    '388v2': [{ page: 4 }]
  };

  it('single page', () => {
    expect(pageCrumb({ book: '388', pageId: '12' }, pages, false)).toBe('P12 of 3');
  });

  it('spread pairs with the next record, suffix included', () => {
    expect(pageCrumb({ book: '388', pageId: '12' }, pages, true)).toBe('P12–P13 of 3');
    expect(pageCrumb({ book: '388', pageId: '13' }, pages, true)).toBe('P13–P13b of 3');
  });

  it('last page of a book in a spread shows alone', () => {
    expect(pageCrumb({ book: '388', pageId: '13b' }, pages, true)).toBe('P13b of 3');
  });

  it('falls back to page number when a record has no pageId', () => {
    expect(pageCrumb({ book: '388v2', pageId: '4' }, pages, true)).toBe('P4 of 1');
  });

  it('empty for no selection, unknown book or page', () => {
    expect(pageCrumb(null, pages, true)).toBe('');
    expect(pageCrumb({ book: '999', pageId: '1' }, pages, true)).toBe('');
    expect(pageCrumb({ book: '388', pageId: '99' }, pages, true)).toBe('');
    expect(pageCrumb({ book: '388', pageId: '12' }, null, true)).toBe('');
  });
});
