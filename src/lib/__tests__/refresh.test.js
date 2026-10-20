/**
 * lib/storage/refresh.js: after an Editor save the reading views drop the
 * saved pages' cached docs and thumbnails and reload the scan and dates; a new
 * data folder drops everything read from the old one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls = [];
vi.mock('$lib/storage/scan.js', () => ({ scanLocalPages: vi.fn(async () => { calls.push('scan'); return true; }) }));
vi.mock('$lib/storage/local-store.js', () => ({ getPage: vi.fn(async () => null) }));
vi.mock('$stores/volumes.js', () => ({ loadVolumes: vi.fn(async () => { calls.push('volumes'); }) }));
vi.mock('$stores/backgrounds.js', () => ({ refreshBackgrounds: vi.fn(() => calls.push('backgrounds')) }));
vi.mock('$stores/timeline.js', async (importOriginal) => ({
  ...(await importOriginal()),
  loadTimeline: vi.fn(async () => { calls.push('timeline'); return true; })
}));
vi.mock('$lib/viewer/page-cache.js', () => ({
  invalidatePage: vi.fn((b, p) => calls.push(`invalidate ${b}/${p}`)),
  clearPageCache: vi.fn(() => calls.push('clearCache')),
  peekCachedPage: vi.fn(() => null)
}));

import { get } from 'svelte/store';
import { refreshAfterSave, resetForDataFolder } from '$lib/storage/refresh.js';
import { thumbs } from '$lib/viewer/thumbs.js';
import { dataFolderReady } from '$stores/settings.js';
import { timelineIndex } from '$stores/timeline.js';
import { savedPages, libraryNotebook, viewerSelection, setViewerSelection } from '$stores';

beforeEach(() => {
  calls.length = 0;
  dataFolderReady.set(true);
});

describe('refreshAfterSave', () => {
  it('invalidates each saved page, then rescans and reloads dates', async () => {
    const spy = vi.spyOn(thumbs, 'invalidate');
    await refreshAfterSave([{ book: '388', page: 26 }, { book: '390', pageId: '151b' }]);
    expect(calls).toEqual(['invalidate 388/26', 'invalidate 390/151b', 'scan', 'timeline']);
    expect(spy).toHaveBeenCalledWith('390', '151b');
  });

  it('does nothing without a ready data folder', async () => {
    dataFolderReady.set(false);
    await refreshAfterSave([{ book: '1', page: 1 }]);
    expect(calls).toEqual([]);
  });
});

describe('resetForDataFolder', () => {
  it('drops the old folder\'s data and loads the new one', async () => {
    savedPages.set([{ book: '1', page: 1 }]);
    timelineIndex.set({ pages: {} });
    libraryNotebook.set('1');
    setViewerSelection('1', '1');
    await resetForDataFolder();
    expect(get(savedPages)).toEqual([]);
    expect(get(libraryNotebook)).toBe(null);
    expect(get(viewerSelection)).toBe(null);
    expect(calls).toEqual(['clearCache', 'volumes', 'scan', 'backgrounds', 'timeline']);
    expect(get(timelineIndex)).toBe(null);
  });
});
