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
  resetDismissed, tagsFor, carryTagsForMoves, tagUndo, undoTagChange, tagInfo, setTagInfo, setTagType,
  tagBlocks, tagBlock, untagBlock
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

describe('tag info (v3.22.0)', () => {
  const tom = { type: 'person', label: 'Tom', aliases: ['Thomas'] };

  beforeEach(() => {
    tagInfo.set({});
    tagUndo.set(null);
  });

  it('loadTags reads the info section, normalized', async () => {
    vi.mocked(getTags).mockResolvedValue({
      version: 1, state: 'ok', pages: { '388/1': ['tom'] }, dismissed: {},
      info: { tom: { ...tom, junk: 1 }, Bad: { label: 'x' } }
    });
    await loadTags();
    expect(get(tagInfo)).toEqual({ tom });
    clearTags();
    expect(get(tagInfo)).toEqual({});
  });

  it('setTagInfo writes one record at once, as an info-only patch', async () => {
    expect(await setTagInfo('tom', { ...tom, note: ' PM ' })).toBe(true);
    expect(get(tagInfo)).toEqual({ tom: { ...tom, note: 'PM' } });
    expect(patchTags).toHaveBeenCalledWith({ pages: {}, dismissed: {}, info: { tom: { ...tom, note: 'PM' } } });
    expect(await setTagInfo('tom', null)).toBe(true);
    expect(patchTags).toHaveBeenLastCalledWith({ pages: {}, dismissed: {}, info: { tom: null } });
    expect(await setTagInfo('Tom', tom)).toBe(false);   // keys are normalized tags
  });

  it('a failed info write rolls back that tag only, and says so', async () => {
    tagInfo.set({ beam: { aliases: ['girder'] } });
    vi.mocked(patchTags).mockRejectedValueOnce(new Error('disk full'));
    expect(await setTagInfo('tom', tom)).toBe(false);
    expect(get(tagInfo)).toEqual({ beam: { aliases: ['girder'] } });
    expect(lastLog().message).toMatch(/details.*disk full/);
  });

  it('a rollback leaves a later edit to the same tag alone', async () => {
    let fail;
    vi.mocked(patchTags).mockImplementationOnce(() => new Promise((_, rej) => { fail = rej; }));
    const first = setTagInfo('tom', tom);
    await setTagInfo('beam', { aliases: ['girder'] });
    fail(new Error('nope'));
    await first;
    expect(get(tagInfo)).toEqual({ beam: { aliases: ['girder'] } });
  });

  it('setTagType makes a keyword a Person or a Topic; a project number is refused', async () => {
    expect(await setTagType('tom', 'person', 'Tom')).toBe(true);
    expect(get(tagInfo)).toEqual({ tom: { type: 'person', label: 'Tom' } });
    expect(await setTagType('tom', 'topic')).toBe(true);
    expect(get(tagInfo)).toEqual({ tom: { label: 'Tom' } });
    vi.mocked(patchTags).mockClear();
    expect(await setTagType('5444-006', 'person')).toBe(false);
    expect(await setTagType('tom', 'project')).toBe(false);
    expect(patchTags).not.toHaveBeenCalled();
  });

  it('rename carries the record in the same write as the pages', async () => {
    pageTags.set({ '388/1': ['tom'], '388/2': ['tom'] });
    tagInfo.set({ tom });
    await renameTag('tom', 'tom-b');
    expect(get(tagInfo)).toEqual({ 'tom-b': tom });
    expect(patchTags).toHaveBeenCalledTimes(1);
    expect(patchTags).toHaveBeenCalledWith({
      pages: { '388/1': ['tom-b'], '388/2': ['tom-b'] }, dismissed: {}, info: { tom: null, 'tom-b': tom }
    });
  });

  it('merge keeps the target\'s info and adds the source\'s aliases, in one write', async () => {
    pageTags.set({ '388/1': ['tom'], '388/2': ['thomas'] });
    tagInfo.set({ tom, thomas: { type: 'person', label: 'Thomas B.' } });
    await mergeTags('tom', 'thomas');
    expect(get(tagInfo)).toEqual({ thomas: { type: 'person', label: 'Thomas B.', aliases: ['Tom', 'Thomas'] } });
    expect(patchTags).toHaveBeenCalledTimes(1);
    expect(vi.mocked(patchTags).mock.calls[0][0].info).toEqual({ tom: null, thomas: { type: 'person', label: 'Thomas B.', aliases: ['Tom', 'Thomas'] } });
  });

  it('delete drops the record in the same write', async () => {
    pageTags.set({ '388/1': ['tom', 'beam'] });
    tagInfo.set({ tom, beam: { aliases: ['girder'] } });
    await deleteTag('tom');
    expect(get(tagInfo)).toEqual({ beam: { aliases: ['girder'] } });
    expect(patchTags).toHaveBeenCalledWith({ pages: { '388/1': ['beam'] }, dismissed: {}, info: { tom: null } });
  });

  it('a failed rename rolls back pages and info together', async () => {
    pageTags.set({ '388/1': ['tom'] });
    tagInfo.set({ tom });
    vi.mocked(patchTags).mockRejectedValueOnce(new Error('locked'));
    expect(await renameTag('tom', 'tom-b')).toBe(false);
    expect(get(pageTags)).toEqual({ '388/1': ['tom'] });
    expect(get(tagInfo)).toEqual({ tom });
    expect(get(tagUndo)).toBeNull();
  });

  it('undo of a delete brings the record back', async () => {
    pageTags.set({ '388/1': ['tom'] });
    tagInfo.set({ tom });
    await deleteTag('tom');
    expect(get(tagInfo)).toEqual({});
    await undoTagChange();
    expect(get(pageTags)).toEqual({ '388/1': ['tom'] });
    expect(get(tagInfo)).toEqual({ tom });
    expect(patchTags).toHaveBeenLastCalledWith({ pages: { '388/1': ['tom'] }, dismissed: {}, info: { tom } });
  });

  it('tag edits that do not touch info send no info section', async () => {
    tagInfo.set({ tom });
    await addTagToPages(['388/1'], 'beam');
    expect(patchTags).toHaveBeenCalledWith({ pages: { '388/1': ['beam'] }, dismissed: {} });
  });
});

describe('coordinator QA fixes: one write, merge rule, info-only tags (v3.22.0)', () => {
  const typeAs = { tag: 'rich', type: 'person', label: 'Rich' };

  beforeEach(() => {
    tagInfo.set({});
    tagUndo.set(null);
  });

  it('"Add as Person" on one page is ONE patch: the page list and the person together', async () => {
    expect(await setPageTagList('388', '1', ['rich'], { typeAs })).toBe(true);
    expect(patchTags).toHaveBeenCalledTimes(1);
    expect(patchTags).toHaveBeenCalledWith({
      pages: { '388/1': ['rich'] }, dismissed: {}, info: { rich: { type: 'person', label: 'Rich' } }
    });
  });

  it('"Add as Person" on many pages (bulk bar) is ONE patch', async () => {
    expect(await addTagToPages(['388/1', '388/2'], 'rich', { typeAs })).toBe(true);
    expect(patchTags).toHaveBeenCalledTimes(1);
    expect(patchTags).toHaveBeenCalledWith({
      pages: { '388/1': ['rich'], '388/2': ['rich'] }, dismissed: {}, info: { rich: { type: 'person', label: 'Rich' } }
    });
  });

  it('if that write fails, neither the page nor the person is left behind', async () => {
    vi.mocked(patchTags).mockRejectedValueOnce(new Error('disk full'));
    expect(await setPageTagList('388', '1', ['rich'], { typeAs })).toBe(false);
    expect(get(pageTags)).toEqual({});
    expect(get(tagInfo)).toEqual({});
  });

  it('a type for a tag the lists do not carry is not written', async () => {
    await setPageTagList('388', '1', ['beam'], { typeAs });
    expect(patchTags).toHaveBeenCalledWith({ pages: { '388/1': ['beam'] }, dismissed: {} });
    expect(get(tagInfo)).toEqual({});
  });

  it('renaming onto a tag on no page that kept its details says Merged, and merges', async () => {
    pageTags.set({ '388/1': ['tommy'] });
    tagInfo.set({ tom: { type: 'person', label: 'Tom' }, tommy: { label: 'Tommy' } });
    await renameTag('tommy', 'tom');
    expect(get(tagUndo).label).toMatch(/^Merged “tommy” into “tom”/);
    expect(get(tagInfo)).toEqual({ tom: { type: 'person', label: 'Tom', aliases: ['Tommy'] } });
    expect(get(pageTags)).toEqual({ '388/1': ['tom'] });
  });

  it('a tag removed from its last page keeps its details; Delete then drops them', async () => {
    pageTags.set({ '388/1': ['tom'] });
    tagInfo.set({ tom: { type: 'person', label: 'Tom' } });
    await removeTagFromPages(['388/1'], 'tom');
    expect(get(tagInfo)).toEqual({ tom: { type: 'person', label: 'Tom' } });
    await deleteTag('tom');
    expect(get(tagInfo)).toEqual({});
    expect(get(tagUndo).label).toBe('Removed the details of “tom”');
    expect(patchTags).toHaveBeenLastCalledWith({ pages: {}, dismissed: {}, info: { tom: null } });
  });
});

describe('block corrections (v3.23.0)', () => {
  beforeEach(() => {
    tagInfo.set({ rich: { type: 'person', label: 'Rich' } });
    tagBlocks.set({});
    tagUndo.set(null);
  });

  it('loadTags reads the blocks section, normalized; clearTags empties it', async () => {
    vi.mocked(getTags).mockResolvedValue({
      version: 1, state: 'ok', pages: {}, dismissed: {}, info: {},
      blocks: { '3017/170': { rich: { add: ['l1', 'l1'] } }, junk: { rich: { add: ['x'] } } }
    });
    await loadTags();
    expect(get(tagBlocks)).toEqual({ '3017/170': { rich: { add: ['l1'] } } });
    clearTags();
    expect(get(tagBlocks)).toEqual({});
  });

  it('Tag this block adds the tag to the page and the root in ONE write', async () => {
    expect(await tagBlock('3017', '170', 'rich', 'l5')).toBe(true);
    expect(patchTags).toHaveBeenCalledTimes(1);
    expect(patchTags).toHaveBeenCalledWith({
      pages: { '3017/170': ['rich'] }, dismissed: {}, blocks: { '3017/170': { rich: { add: ['l5'] } } }
    });
    expect(get(pageTags)).toEqual({ '3017/170': ['rich'] });
  });

  it('Tag this block with a new person writes page, person and root in one patch', async () => {
    await tagBlock('3017', '170', 'tom', 'l5', { typeAs: { tag: 'tom', type: 'person', label: 'Tom' } });
    expect(patchTags).toHaveBeenCalledTimes(1);
    const patch = vi.mocked(patchTags).mock.calls[0][0];
    expect(patch.pages).toEqual({ '3017/170': ['tom'] });
    expect(patch.info).toEqual({ tom: { type: 'person', label: 'Tom' } });
    expect(patch.blocks).toEqual({ '3017/170': { tom: { add: ['l5'] } } });
  });

  it('Not this person writes a remove only; the page keeps its tag', async () => {
    pageTags.set({ '3017/170': ['rich'] });
    await untagBlock('3017', '170', 'rich', 'l1', { byText: true });
    expect(patchTags).toHaveBeenLastCalledWith({ pages: {}, dismissed: {}, blocks: { '3017/170': { rich: { remove: ['l1'] } } } });
    expect(get(pageTags)).toEqual({ '3017/170': ['rich'] });
  });

  it('a failed write rolls back pages and blocks together, and says so', async () => {
    tagBlocks.set({ '3017/171': { rich: { add: ['z'] } } });
    vi.mocked(patchTags).mockRejectedValueOnce(new Error('disk full'));
    expect(await tagBlock('3017', '170', 'rich', 'l5')).toBe(false);
    expect(get(pageTags)).toEqual({});
    expect(get(tagBlocks)).toEqual({ '3017/171': { rich: { add: ['z'] } } });
    expect(lastLog().message).toMatch(/disk full/);
  });

  it('a rollback leaves a later edit to the same page alone', async () => {
    let fail;
    vi.mocked(patchTags).mockImplementationOnce(() => new Promise((_, rej) => { fail = rej; }));
    const first = tagBlock('3017', '170', 'rich', 'l5');
    await untagBlock('3017', '170', 'rich', 'l5');   // a later change to the same page entry
    fail(new Error('nope'));
    await first;
    expect(get(tagBlocks)).toEqual({});   // the later state stands, not the first write's
  });

  it('rename and merge carry block entries in the same write as the pages; undo puts them back', async () => {
    pageTags.set({ '3017/170': ['thomas', 'tom'], '3017/171': ['thomas'] });
    tagInfo.set({ tom: { type: 'person', label: 'Tom' }, thomas: { type: 'person', label: 'Thomas' } });
    tagBlocks.set({ '3017/170': { thomas: { add: ['a'] }, tom: { remove: ['b'] } }, '3017/171': { thomas: { add: ['c'] } } });
    await mergeTags('thomas', 'tom');
    expect(patchTags).toHaveBeenCalledTimes(1);
    expect(get(tagBlocks)).toEqual({ '3017/170': { tom: { add: ['a'], remove: ['b'] } }, '3017/171': { tom: { add: ['c'] } } });
    expect(vi.mocked(patchTags).mock.calls[0][0].blocks).toEqual({
      '3017/170': { tom: { add: ['a'], remove: ['b'] } }, '3017/171': { tom: { add: ['c'] } }
    });
    await undoTagChange();
    expect(get(tagBlocks)).toEqual({ '3017/170': { thomas: { add: ['a'] }, tom: { remove: ['b'] } }, '3017/171': { thomas: { add: ['c'] } } });
  });

  it('delete drops the tag’s block entries in the same write', async () => {
    pageTags.set({ '3017/170': ['rich'] });
    tagBlocks.set({ '3017/170': { rich: { add: ['a'] } } });
    await deleteTag('rich');
    expect(patchTags).toHaveBeenCalledTimes(1);
    expect(vi.mocked(patchTags).mock.calls[0][0].blocks).toEqual({ '3017/170': null });
    expect(get(tagBlocks)).toEqual({});
  });

  it('a volume move carries a page’s block entries with its tags, in one write', async () => {
    pageTags.set({ '390/12': ['rich'] });
    tagBlocks.set({ '390/12': { rich: { add: ['a'] } } });
    expect(await carryTagsForMoves([{ fromBook: '390', fromPage: 12, toBook: '390v2', toPage: 12 }])).toBe(1);
    expect(patchTags).toHaveBeenCalledTimes(1);
    expect(get(tagBlocks)).toEqual({ '390v2/12': { rich: { add: ['a'] } } });
    expect(vi.mocked(patchTags).mock.calls[0][0].blocks).toEqual({ '390/12': null, '390v2/12': { rich: { add: ['a'] } } });
  });

  it('tag edits that do not touch blocks send no blocks section', async () => {
    tagBlocks.set({ '3017/170': { rich: { add: ['a'] } } });
    await setPageTagList('3017', '171', ['beam']);
    expect('blocks' in vi.mocked(patchTags).mock.calls[0][0]).toBe(false);
  });
});

describe('Mentioned, not tagged (v3.23.0, decision 5)', () => {
  it('finding mentions never writes; only Tag page’s click tags, that one page', async () => {
    const { mentionedNotTagged } = await import('$lib/tag-scope.js');
    pageTags.set({ '3017/170': ['rich'] });
    tagInfo.set({ rich: { type: 'person', label: 'Rich' } });
    const records = [
      { book: '3017', page: 171, pageId: '171', transcriptionText: 'Rich called\n  about the stair' },
      { book: '3017', page: 172, pageId: '172', transcriptionText: 'Rich update' }
    ];
    const found = mentionedNotTagged(records, 'rich', get(tagInfo), get(pageTags));
    expect(found.map((m) => m.key)).toEqual(['3017/171', '3017/172']);
    expect(patchTags).not.toHaveBeenCalled();
    expect(get(pageTags)).toEqual({ '3017/170': ['rich'] });
    await addTagToPages([found[0].key], 'rich');   // what Tag page calls
    expect(patchTags).toHaveBeenCalledTimes(1);
    expect(patchTags).toHaveBeenCalledWith({ pages: { '3017/171': ['rich'] }, dismissed: {} });
  });

  it('MentionedPages and the Person page tag a page only from a click handler', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const dir = path.resolve(__dirname, '../../components/tags');
    const src = fs.readFileSync(path.join(dir, 'MentionedPages.svelte'), 'utf8');
    const calls = src.split('\n').filter((l) => /addTagToPages\(|setPageTagList\(|tagBlock\(/.test(l));
    expect(calls.length).toBe(1);
    expect(calls[0]).toMatch(/on:click=\{\(\) => addTagToPages\(\[m\.key\], tag\)\}/);
    for (const f of ['PersonItems.svelte', 'TagBlocksList.svelte', 'ScopeToggles.svelte']) {
      expect(fs.readFileSync(path.join(dir, f), 'utf8')).not.toMatch(/addTagToPages|setPageTagList|tagBlock\(/);
    }
  });
});

describe('a tag leaving a page drops its block corrections there (v3.23.0)', () => {
  beforeEach(() => {
    tagInfo.set({ rich: { type: 'person', label: 'Rich' } });
    tagUndo.set(null);
    pageTags.set({ '3017/170': ['beam', 'rich'], '3017/171': ['rich'] });
    tagBlocks.set({ '3017/170': { rich: { add: ['a'] } }, '3017/171': { rich: { remove: ['b'] } } });
  });

  it('the chip × (setPageTagList) drops the entry in the same patch; Undo brings both back', async () => {
    await setPageTagList('3017', '170', ['beam']);
    expect(patchTags).toHaveBeenCalledTimes(1);
    expect(patchTags).toHaveBeenCalledWith({
      pages: { '3017/170': ['beam'] }, dismissed: {}, blocks: { '3017/170': null }
    });
    expect(get(tagBlocks)).toEqual({ '3017/171': { rich: { remove: ['b'] } } });
    expect(get(tagUndo).label).toMatch(/Removed “rich” and its block corrections from 1 page/);
    await undoTagChange();
    expect(get(pageTags)['3017/170']).toEqual(['beam', 'rich']);
    expect(get(tagBlocks)).toEqual({ '3017/170': { rich: { add: ['a'] } }, '3017/171': { rich: { remove: ['b'] } } });
  });

  it('a bulk remove (removeTagFromPages) drops every page’s entry in one patch; Undo restores', async () => {
    await removeTagFromPages(['3017/170', '3017/171'], 'rich');
    expect(patchTags).toHaveBeenCalledTimes(1);
    expect(vi.mocked(patchTags).mock.calls[0][0].blocks).toEqual({ '3017/170': null, '3017/171': null });
    expect(get(tagBlocks)).toEqual({});
    await undoTagChange();
    expect(get(tagBlocks)).toEqual({ '3017/170': { rich: { add: ['a'] } }, '3017/171': { rich: { remove: ['b'] } } });
  });

  it('a failed untag rolls the corrections back with the page', async () => {
    vi.mocked(patchTags).mockRejectedValueOnce(new Error('disk full'));
    expect(await removeTagFromPages(['3017/170'], 'rich')).toBe(false);
    expect(get(pageTags)['3017/170']).toEqual(['beam', 'rich']);
    expect(get(tagBlocks)['3017/170']).toEqual({ rich: { add: ['a'] } });
  });

  it('removing another tag keeps them, and leaves no undo (as before)', async () => {
    await setPageTagList('3017', '170', ['rich']);
    expect('blocks' in vi.mocked(patchTags).mock.calls[0][0]).toBe(false);
    expect(get(tagUndo)).toBeNull();
  });
});
