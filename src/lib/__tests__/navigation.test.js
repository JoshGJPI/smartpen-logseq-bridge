/**
 * Navigation spine (reading-first package C):
 *   lib/navigation.js    destination <-> (viewerMode, bookViewMode), the leave rule
 *   stores/viewer.js     navigateTo / openPageInLibrary applying it
 *
 * What matters: the discard prompt is asked exactly where the old switchView /
 * switchBookMode asked it (leaving for the Editor or the Timeline with unsaved
 * transcript edits), cancelling leaves everything as it was, unsaved strokes
 * never prompt, and the same destination is a no-op.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
  DESTINATIONS, DISCARD_PROMPT, destinationOf, modesFor, planNavigation, isDestination
} from '$lib/navigation.js';
import {
  viewerMode, bookViewMode, viewerDirty, viewerSelection, destination,
  setViewerMode, setBookViewMode, markViewerDirtyPage, clearAllViewerDirty,
  setViewerSelection, navigateTo, openPageInLibrary, showEditorForLiveInk
} from '../../stores/viewer.js';
import { unsavedChanges, markUnsavedChanges, clearUnsavedChanges } from '../../stores/storage.js';

describe('destinationOf / modesFor', () => {
  it('maps the two store fields onto three destinations', () => {
    expect(destinationOf('book', 'books')).toBe('library');
    expect(destinationOf('book', 'timeline')).toBe('timeline');
    expect(destinationOf('editor', 'books')).toBe('editor');
    expect(destinationOf('editor', 'timeline')).toBe('editor');
  });

  it('round-trips every destination', () => {
    for (const d of DESTINATIONS) {
      const m = modesFor(d);
      expect(destinationOf(m.viewerMode, m.bookViewMode ?? 'books')).toBe(d);
    }
  });

  it('leaves bookViewMode alone for the Editor', () => {
    expect(modesFor('editor')).toEqual({ viewerMode: 'editor', bookViewMode: null });
  });

  it('knows its destinations', () => {
    expect(isDestination('library')).toBe(true);
    expect(isDestination('book')).toBe(false);
    expect(isDestination(undefined)).toBe(false);
  });
});

describe('planNavigation', () => {
  it('same destination is a no-op, even when dirty', () => {
    expect(planNavigation({ from: 'library', to: 'library', viewerDirty: true })).toBe('same');
    expect(planNavigation({ from: 'editor', to: 'editor' })).toBe('same');
  });

  it('asks before leaving with transcript edits, for the Editor and the Timeline', () => {
    expect(planNavigation({ from: 'library', to: 'editor', viewerDirty: true })).toBe('confirm');
    expect(planNavigation({ from: 'library', to: 'timeline', viewerDirty: true })).toBe('confirm');
  });

  it('never asks on the way into the Library (the edits live there)', () => {
    expect(planNavigation({ from: 'editor', to: 'library', viewerDirty: true })).toBe('go');
    expect(planNavigation({ from: 'timeline', to: 'library', viewerDirty: true })).toBe('go');
  });

  it('goes straight when clean', () => {
    expect(planNavigation({ from: 'library', to: 'editor' })).toBe('go');
    expect(planNavigation({ from: 'timeline', to: 'editor', viewerDirty: false })).toBe('go');
  });
});

describe('navigateTo', () => {
  beforeEach(() => {
    clearAllViewerDirty();
    clearUnsavedChanges();
    setBookViewMode('books');
    setViewerMode('book');
  });

  it('switches destinations and reports it', () => {
    expect(get(destination)).toBe('library');
    expect(navigateTo('timeline')).toBe('navigated');
    expect(get(viewerMode)).toBe('book');
    expect(get(bookViewMode)).toBe('timeline');
    expect(navigateTo('editor')).toBe('navigated');
    expect(get(destination)).toBe('editor');
  });

  it('returns to the last reading view from the Editor', () => {
    navigateTo('timeline');
    navigateTo('editor');
    expect(get(bookViewMode)).toBe('timeline');
  });

  it('same destination does nothing and never asks', () => {
    markViewerDirtyPage('388:12');
    const confirm = vi.fn(() => false);
    expect(navigateTo('library', { confirm })).toBe('same');
    expect(confirm).not.toHaveBeenCalled();
    expect(get(viewerDirty)).toBe(true);
  });

  it('cancelled: stays put, edits kept', () => {
    markViewerDirtyPage('388:12');
    const confirm = vi.fn(() => false);
    expect(navigateTo('editor', { confirm })).toBe('cancelled');
    expect(confirm).toHaveBeenCalledWith(DISCARD_PROMPT);
    expect(get(destination)).toBe('library');
    expect(get(viewerDirty)).toBe(true);
  });

  it('accepted: leaves and clears the dirty set', () => {
    markViewerDirtyPage('388:12');
    expect(navigateTo('timeline', { confirm: () => true })).toBe('navigated');
    expect(get(destination)).toBe('timeline');
    expect(get(viewerDirty)).toBe(false);
  });

  it('unsaved strokes never prompt, and stay unsaved', () => {
    markUnsavedChanges();
    const confirm = vi.fn(() => false);
    expect(navigateTo('editor', { confirm })).toBe('navigated');
    expect(navigateTo('timeline', { confirm })).toBe('navigated');
    expect(confirm).not.toHaveBeenCalled();
    expect(get(unsavedChanges)).toBe(true);
  });

  it('rejects unknown destinations', () => {
    expect(navigateTo('book')).toBe('invalid');
    expect(get(destination)).toBe('library');
  });

  it('live ink keeps its own rule: blocked while dirty, no prompt', () => {
    markViewerDirtyPage('388:12');
    expect(showEditorForLiveInk()).toBe('blocked');
    expect(get(destination)).toBe('library');
  });
});

describe('openPageInLibrary', () => {
  beforeEach(() => {
    clearAllViewerDirty();
    setViewerSelection('388', '10');
    setBookViewMode('timeline');
    setViewerMode('book');
  });

  it('opens the page in the Library from the Timeline', () => {
    expect(openPageInLibrary('3017', '42')).toBe('opened');
    expect(get(destination)).toBe('library');
    expect(get(viewerSelection)).toEqual({ book: '3017', pageId: '42' });
  });

  it('asks before replacing a page with unsaved edits', () => {
    setBookViewMode('books');
    markViewerDirtyPage('388:10');
    const confirm = vi.fn(() => false);
    expect(openPageInLibrary('388', '11', { confirm })).toBe('cancelled');
    expect(get(viewerSelection)).toEqual({ book: '388', pageId: '10' });
    expect(get(viewerDirty)).toBe(true);
  });

  it('re-opening the page already open does not ask', () => {
    setBookViewMode('books');
    markViewerDirtyPage('388:10');
    const confirm = vi.fn(() => false);
    expect(openPageInLibrary('388', 10, { confirm })).toBe('opened');
    expect(confirm).not.toHaveBeenCalled();
    expect(get(viewerDirty)).toBe(true);
  });
});
