/**
 * Contextual left panel (reading-first package C):
 *   lib/left-panel.js       CONTEXT_TABS, tabsFor, resolvePanelTab
 *   lib/library-contents.js buildContents (the Library's table of contents)
 *   stores/ui.js            panelTab following the destination
 *   stores/left-panel.js    contentsOpenBooks
 *
 * What matters: Transcripts is in every set (search opens there from any
 * view, and nothing may open into a hidden panel); the long-standing tab ids
 * still resolve; the ink click's setActiveTab('dates') shows Dates once the
 * Timeline is up; the contents are built from scan records alone.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { CONTEXT_TABS, tabsFor, resolvePanelTab } from '$lib/left-panel.js';
import { buildContents } from '$lib/library-contents.js';
import { activeTab, panelTab, setActiveTab, revealLeftPanel } from '../../stores/ui.js';
import { navigateTo, clearAllViewerDirty, setViewerMode, setBookViewMode } from '../../stores/viewer.js';
import { contentsOpenBooks, setContentsBookOpen, leftPanelCollapsed, collapseLeftPanel } from '../../stores/left-panel.js';

describe('tabsFor / resolvePanelTab', () => {
  it('each destination has its own set', () => {
    expect(tabsFor('library')).toEqual(['contents', 'transcription']);
    expect(tabsFor('timeline')).toEqual(['dates', 'transcription']);
    expect(tabsFor('editor')).toEqual(['strokes', 'transcription', 'saved-pages', 'dates']);
    expect(tabsFor('nonsense')).toBe(CONTEXT_TABS.editor);
  });

  it('Transcripts is reachable from every destination', () => {
    for (const d of Object.keys(CONTEXT_TABS)) {
      expect(resolvePanelTab(d, 'transcription')).toBe('transcription');
    }
  });

  it('a tab outside the set shows the set\'s first tab', () => {
    expect(resolvePanelTab('library', 'dates')).toBe('contents');
    expect(resolvePanelTab('timeline', 'strokes')).toBe('dates');
    expect(resolvePanelTab('editor', 'contents')).toBe('strokes');
  });

  it('the old ids still resolve; "books" falls back (now in Settings)', () => {
    expect(resolvePanelTab('editor', 'saved-pages')).toBe('saved-pages');
    expect(resolvePanelTab('editor', 'dates')).toBe('dates');
    expect(resolvePanelTab('editor', 'books')).toBe('strokes');
    expect(resolvePanelTab('library', 'books')).toBe('contents');
    expect(resolvePanelTab('timeline', undefined)).toBe('dates');
  });
});

describe('panelTab store', () => {
  beforeEach(() => {
    clearAllViewerDirty();
    setBookViewMode('timeline');
    setViewerMode('book');
    setActiveTab('dates');
  });

  it('follows the destination without rewriting activeTab', () => {
    expect(get(panelTab)).toBe('dates');
    navigateTo('library');
    expect(get(panelTab)).toBe('contents');
    expect(get(activeTab)).toBe('dates');
    navigateTo('editor');
    expect(get(panelTab)).toBe('dates');
  });

  it('the ink click (setActiveTab dates, then Timeline) shows Dates', () => {
    navigateTo('library');
    setActiveTab('contents');
    navigateTo('timeline');
    setActiveTab('dates');
    expect(get(panelTab)).toBe('dates');
  });

  it('search reveals Transcripts in the Library with the panel collapsed', () => {
    navigateTo('library');
    collapseLeftPanel();
    revealLeftPanel('transcription');
    expect(get(leftPanelCollapsed)).toBe(false);
    expect(get(panelTab)).toBe('transcription');
  });
});

describe('contentsOpenBooks', () => {
  it('opens, closes and toggles by book key', () => {
    setContentsBookOpen('388', true);
    setContentsBookOpen('388v2', true);
    expect(get(contentsOpenBooks).has('388')).toBe(true);
    setContentsBookOpen('388');
    expect(get(contentsOpenBooks).has('388')).toBe(false);
    expect(get(contentsOpenBooks).has('388v2')).toBe(true);
    setContentsBookOpen(388, false);
    setContentsBookOpen('388v2', false);
    expect(get(contentsOpenBooks).size).toBe(0);
  });
});

describe('buildContents', () => {
  const pagesByBook = {
    '388': [
      { book: '388', page: 1, pageId: '1', strokeCount: 10, transcribed: true },
      { book: '388', page: 2, pageId: '2', strokeCount: 0, transcribed: false },
      { book: '388', page: 2, pageId: '2b', transcribed: true }
    ],
    '388v2': [{ book: '388v2', page: 5, strokeCount: 3 }],
    '3017': []
  };

  it('groups pages under books in bookIds order with transcribed counts', () => {
    const out = buildContents(pagesByBook, ['388', '388v2', '3017'], (b) => `Book ${b}`);
    expect(out.map((b) => b.book)).toEqual(['388', '388v2']); // empty book dropped
    expect(out[0]).toEqual({
      book: '388',
      name: 'Book 388',
      transcribed: 2,
      pages: [
        { pageId: '1', transcribed: true, strokeCount: 10 },
        { pageId: '2', transcribed: false, strokeCount: 0 },
        { pageId: '2b', transcribed: true, strokeCount: 0 }
      ]
    });
    expect(out[1].pages).toEqual([{ pageId: '5', transcribed: false, strokeCount: 3 }]);
  });

  it('defaults the name and tolerates missing input', () => {
    expect(buildContents(pagesByBook, ['388v2'])[0].name).toBe('B388v2');
    expect(buildContents(null, ['388'])).toEqual([]);
    expect(buildContents(pagesByBook, null)).toEqual([]);
    expect(buildContents(pagesByBook, ['999'])).toEqual([]);
  });
});
