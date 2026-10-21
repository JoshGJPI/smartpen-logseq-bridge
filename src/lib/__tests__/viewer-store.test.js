/**
 * viewer.js pane-mode behaviour: the app opens on Book View → Timeline, and
 * live pen ink brings up the Editor unless transcript edits are unsaved.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import {
  viewerMode,
  bookViewMode,
  setViewerMode,
  markViewerDirtyPage,
  clearAllViewerDirty,
  showEditorForLiveInk,
} from '../../stores/viewer.js';

describe('startup view', () => {
  it('opens on Book View, Timeline mode', () => {
    expect(get(viewerMode)).toBe('book');
    expect(get(bookViewMode)).toBe('timeline');
  });
});

describe('showEditorForLiveInk', () => {
  beforeEach(() => {
    clearAllViewerDirty();
    setViewerMode('book');
  });

  it('switches Book View to the Editor', () => {
    expect(showEditorForLiveInk()).toBe('switched');
    expect(get(viewerMode)).toBe('editor');
  });

  it('does nothing when the Editor is already showing', () => {
    setViewerMode('editor');
    expect(showEditorForLiveInk()).toBe('already');
    expect(get(viewerMode)).toBe('editor');
  });

  it('stays in Book View while transcript edits are unsaved', () => {
    markViewerDirtyPage('388:12');
    expect(showEditorForLiveInk()).toBe('blocked');
    expect(get(viewerMode)).toBe('book');
  });

  it('switches once the unsaved edits are cleared', () => {
    markViewerDirtyPage('388:12');
    showEditorForLiveInk();
    clearAllViewerDirty();
    expect(showEditorForLiveInk()).toBe('switched');
    expect(get(viewerMode)).toBe('editor');
  });
});

describe('Library views (v3.1.0 page tags)', () => {
  it('openLibraryView shows a tag grid in the Library and leaves any notebook', async () => {
    const { openLibraryView, libraryView, libraryNotebook, showLibraryGrid, viewerSelection, setViewerSelection, destination } =
      await import('$stores/viewer.js');
    const { get } = await import('svelte/store');
    libraryNotebook.set('388');
    setViewerSelection('388', '1');
    expect(openLibraryView({ kind: 'tag', tag: 'beam' }, { confirm: () => true })).toBe('opened');
    expect(get(libraryView)).toEqual({ kind: 'tag', tag: 'beam' });
    expect(get(libraryNotebook)).toBe(null);
    expect(get(viewerSelection)).toBe(null);
    expect(get(destination)).toBe('library');
    showLibraryGrid('390v2');
    expect(get(libraryView)).toBe(null);
    expect(get(libraryNotebook)).toBe('390v2');
    showLibraryGrid(null);
    expect(get(libraryNotebook)).toBe(null);
  });

  it('asks before dropping unsaved transcript edits', async () => {
    const { openLibraryView, libraryView, setViewerSelection, markViewerDirtyPage, clearAllViewerDirty } =
      await import('$stores/viewer.js');
    const { get } = await import('svelte/store');
    libraryView.set(null);
    setViewerSelection('388', '1');
    markViewerDirtyPage('388:1');
    expect(openLibraryView({ kind: 'untagged' }, { confirm: () => false })).toBe('cancelled');
    expect(get(libraryView)).toBe(null);
    clearAllViewerDirty();
  });
});

describe('Library place (v3.2.0)', () => {
  it('each launch starts with no page open, and the old persisted page is dropped', async () => {
    localStorage.setItem('smartpen-viewer-selection', JSON.stringify({ book: '388', pageId: '12' }));
    const { vi } = await import('vitest');
    vi.resetModules();
    const { viewerSelection, setViewerSelection } = await import('$stores/viewer.js');
    const { get } = await import('svelte/store');
    expect(get(viewerSelection)).toBe(null);
    expect(localStorage.getItem('smartpen-viewer-selection')).toBe(null);
    setViewerSelection('388', 12);
    expect(get(viewerSelection)).toEqual({ book: '388', pageId: '12' });
    expect(localStorage.getItem('smartpen-viewer-selection')).toBe(null);
  });

  it('a grid sequence turns Tag order on; none turns it off; Tag needs a sequence', async () => {
    const { readerSequence, readerOrder, setReaderSequence, setReaderOrder } = await import('$stores/viewer.js');
    const { get } = await import('svelte/store');
    const seq = { keys: ['388/12'], chosen: [], mode: 'any', origin: { kind: 'tag', tag: 'beam' } };
    setReaderSequence(seq);
    expect(get(readerSequence)).toBe(seq);
    expect(get(readerOrder)).toBe('tag');
    setReaderOrder('book');
    expect(get(readerOrder)).toBe('book');
    setReaderOrder('tag');
    expect(get(readerOrder)).toBe('tag');
    setReaderSequence(null);
    expect(get(readerOrder)).toBe('book');
    setReaderOrder('tag');
    expect(get(readerOrder)).toBe('book');
  });

  it('a page opened from outside a grid reads in Book order', async () => {
    const { readerSequence, setReaderSequence, openPageInLibrary, clearAllViewerDirty } = await import('$stores/viewer.js');
    const { get } = await import('svelte/store');
    clearAllViewerDirty();
    setReaderSequence({ keys: ['388/12'], chosen: [], mode: 'any', origin: { kind: 'untagged' } });
    openPageInLibrary('3017', '5', { confirm: () => true });
    expect(get(readerSequence)).toBe(null);
  });

  it('grid filters are kept per grid; an empty filter is forgotten', async () => {
    const { gridFilters, setGridFilter } = await import('$stores/viewer.js');
    const { get } = await import('svelte/store');
    gridFilters.set({});
    setGridFilter('nb:388', { chosen: ['beam'], mode: 'all' });
    setGridFilter('tag:beam', { chosen: ['slab'] });
    expect(get(gridFilters)).toEqual({ 'nb:388': { chosen: ['beam'], mode: 'all' }, 'tag:beam': { chosen: ['slab'], mode: 'any' } });
    setGridFilter('nb:388', { chosen: [] });
    expect(get(gridFilters)).toEqual({ 'tag:beam': { chosen: ['slab'], mode: 'any' } });
  });
});
