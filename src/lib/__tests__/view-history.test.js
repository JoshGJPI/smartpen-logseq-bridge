/**
 * Back / Forward (v3.13.0): lib/view-history.js rules and stores/view-history.js
 * over the real navigation stores.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
  emptyHistory, recordView, viewKey, stepTarget, stepped, canStep, viewLabel, historyGesture, HISTORY_MAX
} from '$lib/view-history.js';
import {
  viewerMode, bookViewMode, libraryNotebook, libraryView, viewerSelection, readerSequence, readerOrder,
  destination, openLibraryView, openPageInLibrary, navigateTo, setViewerSelection, setReaderSequence,
  markViewerDirtyPage, clearAllViewerDirty, viewerDirty
} from '$stores/viewer.js';
import {
  viewHistory, startViewHistory, stopViewHistory, clearViewHistory, goBack, goForward, canGoBack, canGoForward,
  replaceNextView, currentView
} from '$stores/view-history.js';

const lib = (extra = {}) => ({ dest: 'library', notebook: null, view: null, selection: null, ...extra });
const page = (book, pageId, extra = {}) => lib({ selection: { book, pageId }, ...extra });
const tick = () => new Promise((r) => queueMicrotask(r));

describe('viewKey', () => {
  it('names each view', () => {
    expect(viewKey({ dest: 'editor', selection: { book: '1', pageId: '2' } })).toBe('editor');
    expect(viewKey({ dest: 'timeline' })).toBe('timeline');
    expect(viewKey(lib())).toBe('library');
    expect(viewKey(lib({ notebook: '388v2' }))).toBe('notebook:388v2');
    expect(viewKey(lib({ view: { kind: 'tag', tag: '2237-011' } }))).toBe('view:tag:2237-011');
    expect(viewKey(lib({ view: { kind: 'tasks' } }))).toBe('view:tasks');
    expect(viewKey(page('388', '151b', { view: { kind: 'tag', tag: 'x' } }))).toBe('page:388/151b');
    expect(viewKey(null)).toBe('');
  });
});

describe('recordView', () => {
  it('pushes, refreshes the same view, and drops forward on a new view', () => {
    let h = emptyHistory();
    h = recordView(h, { dest: 'timeline' });
    h = recordView(h, lib({ view: { kind: 'tasks' } }));
    h = recordView(h, lib({ view: { kind: 'tag', tag: 'A' } }));
    expect(h.entries.map(viewKey)).toEqual(['timeline', 'view:tasks', 'view:tag:A']);
    h = stepped(stepped(h, 'back'), 'back');
    expect(viewKey(h.entries[h.index])).toBe('timeline');
    const same = recordView(h, { dest: 'timeline', extra: 1 });
    expect(same.entries).toHaveLength(3);
    expect(same.entries[0].extra).toBe(1);
    h = recordView(h, { dest: 'editor' });
    expect(h.entries.map(viewKey)).toEqual(['timeline', 'editor']);
    expect(h.index).toBe(1);
  });

  it('replace swaps the current entry (a page turn)', () => {
    let h = recordView(recordView(emptyHistory(), lib({ view: { kind: 'tag', tag: 'A' } })), page('388', '1'));
    h = recordView(h, page('388', '2'), { replace: true });
    expect(h.entries.map(viewKey)).toEqual(['view:tag:A', 'page:388/2']);
    expect(recordView(emptyHistory(), page('1', '1'), { replace: true }).entries).toHaveLength(1);
  });

  it('keeps the last HISTORY_MAX entries', () => {
    let h = emptyHistory();
    for (let i = 0; i < HISTORY_MAX + 5; i++) h = recordView(h, page('1', String(i)));
    expect(h.entries).toHaveLength(HISTORY_MAX);
    expect(h.index).toBe(HISTORY_MAX - 1);
    expect(viewKey(h.entries[0])).toBe('page:1/5');
    expect(recordView(emptyHistory(), page('1', '1'), { max: 0 }).entries).toHaveLength(1);
  });

  it('ignores nothing', () => {
    const h = emptyHistory();
    expect(recordView(h, null)).toBe(h);
    expect(canStep(h, 'back')).toBe(false);
    expect(stepTarget(h, 'forward')).toBeNull();
    expect(stepped(h, 'back')).toBe(h);
  });
});

describe('viewLabel and historyGesture', () => {
  it('labels', () => {
    expect(viewLabel(page('388', '12'))).toBe('B388 p.12');
    expect(viewLabel(lib({ view: { kind: 'tag', tag: 'A' } }))).toBe('Tag: A');
    expect(viewLabel({ dest: 'editor' })).toBe('Editor');
    expect(viewLabel(lib({ notebook: '3' }), (b) => `Book ${b}`)).toBe('Book 3');
    expect(viewLabel(null)).toBe('');
  });

  it('gestures', () => {
    expect(historyGesture({ type: 'keydown', key: 'ArrowLeft', altKey: true })).toBe('back');
    expect(historyGesture({ type: 'keydown', key: 'ArrowRight', altKey: true })).toBe('forward');
    expect(historyGesture({ type: 'keydown', key: 'ArrowLeft' })).toBeNull();
    expect(historyGesture({ type: 'keydown', key: 'ArrowLeft', altKey: true, shiftKey: true })).toBeNull();
    expect(historyGesture({ type: 'mouseup', button: 3 })).toBe('back');
    expect(historyGesture({ type: 'mouseup', button: 4 })).toBe('forward');
    expect(historyGesture({ type: 'mouseup', button: 0 })).toBeNull();
    expect(historyGesture(null)).toBeNull();
  });
});

describe('the view history store', () => {
  beforeEach(async () => {
    stopViewHistory();
    clearAllViewerDirty();
    viewerMode.set('book');
    bookViewMode.set('timeline');
    libraryNotebook.set(null);
    libraryView.set(null);
    viewerSelection.set(null);
    setReaderSequence(null);
    clearViewHistory();
    startViewHistory();
    await tick();
  });
  afterEach(() => stopViewHistory());

  it('records one entry per route, however many stores it sets', async () => {
    expect(get(viewHistory).entries.map(viewKey)).toEqual(['timeline']);
    openLibraryView({ kind: 'tag', tag: '2237-011' });
    await tick();
    expect(get(viewHistory).entries.map(viewKey)).toEqual(['timeline', 'view:tag:2237-011']);
    expect(get(canGoBack)).toBe(true);
    expect(get(canGoForward)).toBe(false);
  });

  it('tag page → page → Editor, then Back twice returns to the tag page with its reading order', async () => {
    openLibraryView({ kind: 'tag', tag: '2237-011' });
    await tick();
    const seq = { origin: { kind: 'tag', tag: '2237-011' }, pages: [] };
    setReaderSequence(seq);
    setViewerSelection('388', '178');
    await tick();
    replaceNextView();
    setViewerSelection('388', '179'); // a page turn
    await tick();
    navigateTo('editor');
    await tick();
    expect(get(viewHistory).entries.map(viewKey)).toEqual(['timeline', 'view:tag:2237-011', 'page:388/179', 'editor']);

    expect(goBack()).toBe('moved');
    await tick();
    expect(get(destination)).toBe('library');
    expect(get(viewerSelection)).toEqual({ book: '388', pageId: '179' });
    expect(get(readerSequence)).toBe(seq);
    expect(get(readerOrder)).toBe('tag');

    expect(goBack()).toBe('moved');
    await tick();
    expect(get(viewerSelection)).toBeNull();
    expect(get(libraryView)).toEqual({ kind: 'tag', tag: '2237-011' });
    expect(get(viewHistory).index).toBe(1);
    expect(get(canGoForward)).toBe(true);

    expect(goForward()).toBe('moved');
    await tick();
    expect(get(viewerSelection)).toEqual({ book: '388', pageId: '179' });
    // Restoring records nothing new.
    expect(get(viewHistory).entries).toHaveLength(4);
  });

  it('asks before leaving a page with an unsaved draft, and stays put on No', async () => {
    openPageInLibrary('388', '1');
    await tick();
    markViewerDirtyPage('388:1');
    const no = vi.fn(() => false);
    expect(goBack({ confirm: no })).toBe('cancelled');
    expect(no).toHaveBeenCalledOnce();
    expect(get(viewHistory).index).toBe(1);
    expect(get(viewerSelection)).toEqual({ book: '388', pageId: '1' });
    expect(get(viewerDirty)).toBe(true);
    expect(goBack({ confirm: () => true })).toBe('moved');
    await tick();
    expect(get(viewerDirty)).toBe(false);
    expect(get(destination)).toBe('timeline');
  });

  it('a change not yet settled is recorded before stepping', async () => {
    openLibraryView({ kind: 'tasks' });
    await tick();
    openLibraryView({ kind: 'tag', tag: 'B' });
    expect(goBack()).toBe('moved'); // same tick as the change
    await tick();
    expect(get(libraryView)).toEqual({ kind: 'tasks' });
    expect(get(viewHistory).entries.map(viewKey)).toEqual(['timeline', 'view:tasks', 'view:tag:B']);
  });

  it('nothing to step to', () => {
    expect(goForward()).toBe('none');
    expect(currentView().dest).toBe('timeline');
  });
});
