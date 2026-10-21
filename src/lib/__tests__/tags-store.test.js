/**
 * Tests for the tags store (stores/tags.js): loading `_tags.json` through the
 * IPC facade, optimistic edits, rollback on a failed write, bulk edits,
 * rename / merge / delete, dismissals, and the reload on a data-folder change.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('$lib/storage/local-store.js', () => ({
  getTags: vi.fn(),
  patchTags: vi.fn()
}));

import { getTags, patchTags } from '$lib/storage/local-store.js';
import {
  pageTags, dismissedTags, tagIndex, tagStatsList, loadTags, clearTags, setPageTagList,
  addTagToPages, removeTagFromPages, renameTag, mergeTags, deleteTag, dismissSuggestion,
  resetDismissed, tagsFor, carryTagsForMoves, tagUndo, undoTagChange
} from '$stores/tags.js';
import { logMessages } from '$stores/ui.js';

const lastLog = () => get(logMessages)[0] || {}; // newest first

beforeEach(() => {
  vi.mocked(getTags).mockReset();
  vi.mocked(patchTags).mockReset();
  vi.mocked(patchTags).mockResolvedValue({ replacedCorrupt: false });
  pageTags.set({});
  dismissedTags.set({});
});

describe('loadTags', () => {
  it('normalizes what the sidecar holds', async () => {
    vi.mocked(getTags).mockResolvedValue({
      version: 1, state: 'ok',
      pages: { '388v2/151b': ['beam', 'p2026-141'], '388v1/1': ['x'] },
      dismissed: { '388v2/151b': ['2327-018'] }
    });
    expect(await loadTags()).toBe(true);
    expect(get(pageTags)).toEqual({ '388v2/151b': ['P2026-141', 'beam'] });
    expect(get(dismissedTags)).toEqual({ '388v2/151b': ['2327-018'] });
  });

  it('a missing data folder leaves no tags', async () => {
    pageTags.set({ '388/1': ['beam'] });
    vi.mocked(getTags).mockRejectedValue(new Error('No data folder selected.'));
    expect(await loadTags()).toBe(false);
    expect(get(pageTags)).toEqual({});
  });

  it('a corrupt sidecar shows no tags and says so', async () => {
    vi.mocked(getTags).mockResolvedValue({ version: 1, state: 'corrupt', pages: {}, dismissed: {} });
    await loadTags();
    expect(get(pageTags)).toEqual({});
    expect(lastLog().message).toMatch(/unreadable/);
  });

  it('waits for a write in flight before reading', async () => {
    let release;
    vi.mocked(patchTags).mockImplementationOnce(() => new Promise((res) => { release = () => res({}); }));
    vi.mocked(getTags).mockResolvedValue({ version: 1, state: 'ok', pages: { '388/1': ['beam'] }, dismissed: {} });
    const write = setPageTagList('388', '1', ['beam']);
    const load = loadTags();
    await Promise.resolve();
    expect(getTags).not.toHaveBeenCalled();
    release();
    await write;
    await load;
    expect(getTags).toHaveBeenCalledTimes(1);
  });
});

describe('setPageTagList', () => {
  it('applies at once and sends only the changed page', async () => {
    pageTags.set({ '388/1': ['beam'] });
    const pending = setPageTagList('388v2', '151b', ['Roof', 'p2026-141']);
    expect(get(pageTags)['388v2/151b']).toEqual(['P2026-141', 'roof']);
    expect(await pending).toBe(true);
    expect(patchTags).toHaveBeenCalledWith({ pages: { '388v2/151b': ['P2026-141', 'roof'] }, dismissed: {} });
  });

  it('an empty list removes the page', async () => {
    pageTags.set({ '388/1': ['beam'] });
    await setPageTagList('388', 1, []);
    expect(get(pageTags)).toEqual({});
    expect(patchTags).toHaveBeenCalledWith({ pages: { '388/1': null }, dismissed: {} });
  });

  it('writes nothing when nothing changed', async () => {
    pageTags.set({ '388/1': ['beam'] });
    expect(await setPageTagList('388', '1', ['Beam'])).toBe(true);
    expect(patchTags).not.toHaveBeenCalled();
  });

  it('rolls back and logs when the write fails', async () => {
    pageTags.set({ '388/1': ['beam'] });
    vi.mocked(patchTags).mockRejectedValue(new Error('disk full'));
    expect(await setPageTagList('388', '1', ['beam', 'roof'])).toBe(false);
    expect(get(pageTags)).toEqual({ '388/1': ['beam'] });
    expect(lastLog()).toMatchObject({ level: 'error' });
    expect(lastLog().message).toMatch(/disk full/);
  });

  it('a failed write undoes only its own page, and not a later change to it', async () => {
    let fail;
    vi.mocked(patchTags)
      .mockImplementationOnce(() => new Promise((_, rej) => { fail = () => rej(new Error('locked')); }))
      .mockResolvedValue({});
    const a = setPageTagList('388', '1', ['beam']);
    const b = setPageTagList('388', '2', ['roof']);
    await b;
    fail();
    await a;
    expect(get(pageTags)).toEqual({ '388/2': ['roof'] });

    vi.mocked(patchTags).mockImplementationOnce(() => new Promise((_, rej) => { fail = () => rej(new Error('locked')); }));
    const c = setPageTagList('388', '3', ['x']);
    await setPageTagList('388', '3', ['y']); // changed again before the failure
    fail();
    await c;
    expect(get(pageTags)['388/3']).toEqual(['y']);
  });

  it('refuses keys that are not pages', async () => {
    expect(await setPageTagList('388v1', '4', ['x'])).toBe(false);
    expect(await setPageTagList('388', '../x', ['x'])).toBe(false);
    expect(patchTags).not.toHaveBeenCalled();
  });

  it('keeps every quick edit (the store, not the reply, is the truth)', async () => {
    await Promise.all([
      setPageTagList('390v2', '2', ['a']),
      setPageTagList('390v2', '3', ['b']),
      setPageTagList('390v2', '2', ['a', 'c'])
    ]);
    expect(get(pageTags)).toEqual({ '390v2/2': ['a', 'c'], '390v2/3': ['b'] });
  });
});

describe('bulk, rename, merge, delete', () => {
  beforeEach(() => {
    pageTags.set({ '388/1': ['beam'], '388/2': ['beam', 'footing'], '3017/42': ['P2026-141'] });
  });

  it('adds a tag to many pages in one write', async () => {
    await addTagToPages(['388/1', '388/2', '388/3', null], 'Roof');
    expect(patchTags).toHaveBeenCalledTimes(1);
    expect(get(pageTags)['388/3']).toEqual(['roof']);
    expect(get(pageTags)['388/2']).toEqual(['beam', 'footing', 'roof']);
  });

  it('removes a tag from many pages in one write', async () => {
    await removeTagFromPages(['388/1', '388/2'], 'beam');
    expect(patchTags).toHaveBeenCalledTimes(1);
    expect(get(pageTags)).toEqual({ '388/2': ['footing'], '3017/42': ['P2026-141'] });
  });

  it('a bulk failure rolls back every page it touched', async () => {
    vi.mocked(patchTags).mockRejectedValue(new Error('nope'));
    await addTagToPages(['388/1', '388/9'], 'x');
    expect(get(pageTags)).toEqual({ '388/1': ['beam'], '388/2': ['beam', 'footing'], '3017/42': ['P2026-141'] });
  });

  it('renames, merges and deletes', async () => {
    await renameTag('beam', 'Beams');
    expect(get(pageTags)['388/2']).toEqual(['beams', 'footing']);
    await mergeTags('footing', 'beams');
    expect(get(pageTags)['388/2']).toEqual(['beams']);
    await deleteTag('beams');
    expect(get(pageTags)).toEqual({ '3017/42': ['P2026-141'] });
  });

  it('refuses an empty name', async () => {
    expect(await renameTag('beam', '!!')).toBe(false);
    expect(await addTagToPages(['388/1'], '  ')).toBe(false);
    expect(patchTags).not.toHaveBeenCalled();
  });

  it('derives the index and stats from the store', () => {
    expect(get(tagIndex).get('beam')).toEqual(['388/1', '388/2']);
    expect(get(tagStatsList)[0]).toEqual({ tag: 'beam', pages: 2, notebooks: 1 });
    expect(tagsFor(get(pageTags), '388', 2)).toEqual(['beam', 'footing']);
    expect(tagsFor(get(pageTags), '388', 7)).toEqual([]);
  });
});

describe('dismissals', () => {
  it('dismisses per page and resets all', async () => {
    await dismissSuggestion(['388/1', '388/2'], '2327-018');
    expect(get(dismissedTags)).toEqual({ '388/1': ['2327-018'], '388/2': ['2327-018'] });
    expect(patchTags).toHaveBeenLastCalledWith({ pages: {}, dismissed: { '388/1': ['2327-018'], '388/2': ['2327-018'] } });
    await resetDismissed();
    expect(get(dismissedTags)).toEqual({});
    expect(patchTags).toHaveBeenLastCalledWith({ pages: {}, dismissed: { '388/1': null, '388/2': null } });
  });

  it('clearTags empties both (data-folder change)', () => {
    pageTags.set({ '1/1': ['a'] });
    dismissedTags.set({ '1/1': ['2327-018'] });
    clearTags();
    expect(get(pageTags)).toEqual({});
    expect(get(dismissedTags)).toEqual({});
  });
});

describe('carryTagsForMoves (volume reassignment)', () => {
  it('carries an emptied page’s tags to its one target in one write', async () => {
    pageTags.set({ '390/12': ['beam'], '390/13': ['roof'] });
    dismissedTags.set({ '390/12': ['2327-018'] });
    const n = await carryTagsForMoves([{ fromBook: '390', fromPage: 12, toBook: '390v2', toPage: 12 }]);
    expect(n).toBe(1);
    expect(get(pageTags)).toEqual({ '390v2/12': ['beam'], '390/13': ['roof'] });
    expect(get(dismissedTags)).toEqual({ '390v2/12': ['2327-018'] });
    expect(patchTags).toHaveBeenCalledTimes(1);
    expect(patchTags).toHaveBeenCalledWith({
      pages: { '390/12': null, '390v2/12': ['beam'] },
      dismissed: { '390/12': null, '390v2/12': ['2327-018'] }
    });
  });

  it('does nothing for no moves or untagged pages', async () => {
    expect(await carryTagsForMoves([])).toBe(0);
    expect(await carryTagsForMoves(undefined)).toBe(0);
    expect(await carryTagsForMoves([{ fromBook: '390', fromPage: 1, toBook: '390v2', toPage: 1 }])).toBe(0);
    expect(patchTags).not.toHaveBeenCalled();
  });

  it('rolls the carry back if the write fails', async () => {
    pageTags.set({ '390/12': ['beam'] });
    vi.mocked(patchTags).mockRejectedValue(new Error('locked'));
    expect(await carryTagsForMoves([{ fromBook: '390', fromPage: 12, toBook: '390v2', toPage: 12 }])).toBe(0);
    expect(get(pageTags)).toEqual({ '390/12': ['beam'] });
  });
});

describe('undo (v3.2.0)', () => {
  beforeEach(() => {
    pageTags.set({ '388/1': ['a'], '388/2': ['a', 'b'], '388/3': ['b'], '3017/4': ['c'] });
    tagUndo.set(null);
  });

  it('a merge can be undone exactly, in one write', async () => {
    await mergeTags('a', 'b');
    expect(get(pageTags)).toEqual({ '388/1': ['b'], '388/2': ['b'], '388/3': ['b'], '3017/4': ['c'] });
    expect(get(tagUndo).label).toBe('Merged “a” into “b”');
    vi.mocked(patchTags).mockClear();
    expect(await undoTagChange()).toBe(true);
    expect(get(pageTags)).toEqual({ '388/1': ['a'], '388/2': ['a', 'b'], '388/3': ['b'], '3017/4': ['c'] });
    expect(patchTags).toHaveBeenCalledTimes(1);
    expect(patchTags).toHaveBeenCalledWith({ pages: { '388/1': ['a'], '388/2': ['a', 'b'] }, dismissed: {} });
    expect(get(tagUndo)).toBe(null);
    expect(await undoTagChange()).toBe(false);
  });

  it('labels a rename and a delete, and undoes a delete', async () => {
    await renameTag('c', 'd');
    expect(get(tagUndo).label).toBe('Renamed “c” to “d”');
    await deleteTag('a');
    expect(get(tagUndo).label).toBe('Removed “a” from 2 pages');
    await undoTagChange();
    expect(get(pageTags)['388/1']).toEqual(['a']);
    expect(get(pageTags)['388/2']).toEqual(['a', 'b']);
    expect(get(pageTags)['3017/4']).toEqual(['d']); // only the last change is undone
  });

  it('any later tag change ends the undo', async () => {
    await mergeTags('a', 'b');
    await setPageTagList('3017', '4', ['c', 'e']);
    expect(get(tagUndo)).toBe(null);
  });

  it('resetting dismissals can be undone', async () => {
    dismissedTags.set({ '388/1': ['2327-018'] });
    await resetDismissed();
    expect(get(dismissedTags)).toEqual({});
    await undoTagChange();
    expect(get(dismissedTags)).toEqual({ '388/1': ['2327-018'] });
  });

  it('a failed write leaves nothing to undo; a data-folder change clears it', async () => {
    vi.mocked(patchTags).mockRejectedValueOnce(new Error('locked'));
    await mergeTags('a', 'b');
    expect(get(pageTags)['388/1']).toEqual(['a']);
    expect(get(tagUndo)).toBe(null);
    await mergeTags('a', 'b');
    clearTags();
    expect(get(tagUndo)).toBe(null);
  });
});
