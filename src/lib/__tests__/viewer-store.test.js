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
