/**
 * Library home + global search stores (reading-first package E):
 *   stores/viewer.js   openNotebookInLibrary, readerFocus
 *   stores/library.js  sort persistence, cards and search index derived from the scan
 *
 * What matters: opening a notebook asks before dropping transcript edits like
 * every other route; the sort is a per-viewer convenience that survives
 * missing or corrupt storage; nothing derived here needs a page read.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
  viewerSelection, destination, libraryNotebook, readerFocus,
  setViewerSelection, setViewerMode, setBookViewMode, markViewerDirtyPage, clearAllViewerDirty,
  openNotebookInLibrary, focusReaderLine, clearReaderFocus
} from '../../stores/viewer.js';
import { librarySort, setLibrarySort, notebookCardList, globalSearchIndex, notebookNames } from '../../stores/library.js';
import { savedPages } from '../../stores/saved-pages.js';
import { timelineIndex } from '../../stores/timeline.js';
import { LIBRARY_SORT_KEY } from '$lib/library-home.js';

describe('openNotebookInLibrary', () => {
  beforeEach(() => {
    clearAllViewerDirty();
    setViewerSelection('388', '10');
    setBookViewMode('timeline');
    setViewerMode('book');
    libraryNotebook.set(null);
  });

  it('closes the open page and shows the notebook grid in the Library', () => {
    expect(openNotebookInLibrary('390v2')).toBe('opened');
    expect(get(viewerSelection)).toBe(null);
    expect(get(libraryNotebook)).toBe('390v2');
    expect(get(destination)).toBe('library');
  });

  it('asks before dropping transcript edits; Cancel changes nothing', () => {
    setBookViewMode('books');
    markViewerDirtyPage('388:10');
    const confirm = vi.fn(() => false);
    expect(openNotebookInLibrary('390', { confirm })).toBe('cancelled');
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(get(viewerSelection)).toEqual({ book: '388', pageId: '10' });
    expect(get(libraryNotebook)).toBe(null);
  });

  it('OK clears the edits and asks only once', () => {
    setBookViewMode('timeline');
    markViewerDirtyPage('388:10');
    const confirm = vi.fn(() => true);
    expect(openNotebookInLibrary(388, { confirm })).toBe('opened');
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(get(libraryNotebook)).toBe('388');
  });
});

describe('readerFocus', () => {
  it('each request is new, so re-opening the same hit shows it again', () => {
    clearReaderFocus();
    focusReaderLine('388', 170, ['rich']);
    const a = get(readerFocus);
    focusReaderLine('388', '170', ['rich']);
    const b = get(readerFocus);
    expect(a).toMatchObject({ book: '388', pageId: '170', tokens: ['rich'] });
    expect(b.n).toBe(a.n + 1);
    clearReaderFocus();
    expect(get(readerFocus)).toBe(null);
  });
});

describe('librarySort', () => {
  it('persists a known order and ignores unknown ones', () => {
    setLibrarySort('pages');
    expect(get(librarySort)).toBe('pages');
    expect(localStorage.getItem(LIBRARY_SORT_KEY)).toBe('pages');
    setLibrarySort('nonsense');
    expect(get(librarySort)).toBe('recent');
  });

  it('a throwing localStorage does not break setting the order', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => setLibrarySort('name')).not.toThrow();
    expect(get(librarySort)).toBe('name');
    spy.mockRestore();
  });
});

describe('derived from the scan and the index', () => {
  it('cards, names and search index from metadata-only records', () => {
    savedPages.set([
      { book: '388', pageId: '1', page: 1, strokeCount: 3, transcribed: true, transcriptionText: 'beam' },
      { book: '388v2', pageId: '2', page: 2, strokeCount: 4, transcribed: false, transcriptionText: null }
    ]);
    timelineIndex.set({ pages: { a: { book: '388', page: 1, pageId: '1', days: { '2026-10-14': 3 }, lastStroke: 1 } } });
    const cards = get(notebookCardList);
    expect(cards.map((c) => [c.book, c.pageCount, c.first])).toEqual([['388', 1, '2026-10-14'], ['388v2', 1, null]]);
    expect(get(notebookNames).map((n) => n.book)).toEqual(['388', '388v2']);
    expect(get(globalSearchIndex).map((e) => e.key)).toEqual(['388/1']);
    savedPages.set([]);
    timelineIndex.set(null);
  });
});

describe('page tags on the Library home (v3.1.0)', () => {
  it('derives tag cards and the Untagged card from the sidecar and the scan', async () => {
    const { tagCardList, untaggedSummary } = await import('../../stores/library.js');
    const { pageTags } = await import('../../stores/tags.js');
    timelineIndex.set(null);
    savedPages.set([
      { book: '388', page: 1, pageId: '1' },
      { book: '388v2', page: 151, pageId: '151b', suffix: 'b' },
      { book: '3017', page: 42, pageId: '42' }
    ]);
    pageTags.set({ '388/1': ['beam'], '388v2/151b': ['beam', 'P2026-141'], '9/9': ['ghost'] });
    const cards = get(tagCardList);
    expect(cards.map((c) => [c.tag, c.pageCount, c.notebookCount]).sort()).toEqual([
      ['P2026-141', 1, 1],
      ['beam', 2, 2]
    ]);
    expect(get(untaggedSummary)).toMatchObject({ pageCount: 1, notebookCount: 1 });
    pageTags.set({});
    savedPages.set([]);
  });

  it('remembers the grouping and the tag sort, falling back on junk', async () => {
    const { libraryGroupBy, setLibraryGroupBy, libraryTagSort, setLibraryTagSort } = await import('../../stores/library.js');
    const { LIBRARY_GROUP_KEY, TAG_SORT_KEY } = await import('$lib/tags.js');
    setLibraryGroupBy('tag');
    expect(get(libraryGroupBy)).toBe('tag');
    expect(localStorage.getItem(LIBRARY_GROUP_KEY)).toBe('tag');
    setLibraryGroupBy('nonsense');
    expect(get(libraryGroupBy)).toBe('book');
    setLibraryTagSort('name');
    expect(localStorage.getItem(TAG_SORT_KEY)).toBe('name');
    setLibraryTagSort('???');
    expect(get(libraryTagSort)).toBe('pages');
  });
});
