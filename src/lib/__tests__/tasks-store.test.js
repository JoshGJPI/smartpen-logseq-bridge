/**
 * Tests for stores/tasks.js: rows derived from the scan records, page tags
 * and capture dates; the optimistic change, its rollback on a failed write,
 * Undo, per-page ordering, and the unsaved-draft refusal. The write path
 * (lib/viewer/task-state.js) runs for real against a mocked local-store.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';

vi.mock('$lib/storage/local-store.js', () => ({
  getPage: vi.fn(),
  savePage: vi.fn(),
  getTags: vi.fn(),
  patchTags: vi.fn()
}));

import { getPage, savePage } from '$lib/storage/local-store.js';
import { savedPages, markViewerDirtyPage, clearAllViewerDirty } from '$stores';
import { pageTags } from '$stores/tags.js';
import { timelineIndex } from '$stores/timeline.js';
import { logMessages } from '$stores/ui.js';
import {
  taskRows, taskCountsStore, openTaskCount, taskOverrides, taskUndo, changeTask, toggleTask,
  undoTaskChange, clearTasks, setTaskGroupBy, taskGroupBy, setTaskFilter, taskFilter
} from '$stores/tasks.js';

const lastLog = () => get(logMessages)[0] || {};

/** A tiny on-disk library the mocked local-store serves. */
let disk;

function doc(lines) {
  return {
    version: '2.0',
    pageInfo: { section: 3, owner: 1012, book: 3017, page: 142 },
    metadata: { lastUpdated: 'old', totalStrokes: 0, bounds: {} },
    transcript: { lastTranscribed: 'T0', lines },
    strokes: []
  };
}
const ln = (id, checked, extra = {}) => ({ id, text: `task ${id}`, indentLevel: 1, parentId: 'h', checked, yBounds: null, ...extra });

function summary(lines) {
  return lines.filter((l) => l.checked !== null).map((l) => ({
    id: l.id, text: l.text, checked: l.checked, marker: l.marker || null, parentText: 'Meeting'
  }));
}

beforeEach(() => {
  const p142 = [{ id: 'h', text: 'Meeting', indentLevel: 0, parentId: null, checked: null, yBounds: null }, ln('a', false), ln('b', true)];
  const p170 = [ln('c', false, { marker: 'WAITING' })];
  disk = { '3017/142': doc(p142), '3017/170': doc(p170) };
  vi.mocked(getPage).mockReset();
  vi.mocked(getPage).mockImplementation(async (book, pageId) => structuredClone(disk[`${book}/${pageId}`] || null));
  vi.mocked(savePage).mockReset();
  vi.mocked(savePage).mockImplementation(async (book, pageId, d) => { disk[`${book}/${pageId}`] = d; return { success: true }; });
  clearAllViewerDirty();
  clearTasks();
  pageTags.set({ '3017/142': ['P2026-141'] });
  timelineIndex.set({ pages: { '3017/142': { book: '3017', page: 142, pageId: '142', days: { '2026-10-14': 20 } } } });
  savedPages.set([
    { book: '3017', page: 142, pageId: '142', tasks: summary(p142) },
    { book: '3017', page: 170, pageId: '170', tasks: summary(p170) },
    { book: '3017', page: 171, pageId: '171', tasks: [] }
  ]);
});

const stateOf = (lineId) => get(taskRows).find((r) => r.lineId === lineId)?.state;

describe('derived rows', () => {
  it('one row per task with project tag and date written', () => {
    const rows = get(taskRows);
    expect(rows.map((r) => [r.lineId, r.state])).toEqual([['a', 'todo'], ['b', 'done'], ['c', 'waiting']]);
    expect(rows[0]).toMatchObject({ project: 'P2026-141', day: '2026-10-14', parentText: 'Meeting' });
    expect(rows[2]).toMatchObject({ project: null, day: null });
    expect(get(taskCountsStore)).toEqual({ open: 1, waiting: 1, done: 1, cancelled: 0, all: 3 });
    expect(get(openTaskCount)).toBe(1);
  });

  it('follows a tag change without touching any page', () => {
    pageTags.set({ '3017/170': ['2327-018'] });
    expect(get(taskRows).find((r) => r.lineId === 'c').project).toBe('2327-018');
    expect(getPage).not.toHaveBeenCalled();
  });

  it('filter and grouping choices', () => {
    setTaskFilter('done');
    expect(get(taskFilter)).toBe('done');
    setTaskFilter('nonsense');
    expect(get(taskFilter)).toBe('open');
    setTaskGroupBy('book');
    expect(get(taskGroupBy)).toBe('book');
    setTaskGroupBy('nonsense');
    expect(get(taskGroupBy)).toBe('project');
  });
});

describe('changeTask', () => {
  it('shows at once, writes the page, then reads from the scan record', async () => {
    const pending = changeTask('3017', '142', 'a', 'done');
    expect(stateOf('a')).toBe('done');
    expect(get(taskOverrides).size).toBe(1);
    expect(await pending).toBe(true);
    expect(get(taskOverrides).size).toBe(0);
    expect(stateOf('a')).toBe('done');
    expect(disk['3017/142'].transcript.lines[1].checked).toBe(true);
    expect(disk['3017/142'].transcript.lastTranscribed).toBe('T0');
    expect(get(taskUndo)).toMatchObject({ prev: 'todo', state: 'done', label: 'Marked DONE · B3017 p.142' });
  });

  it('rolls back that task on a failed write and says why', async () => {
    vi.mocked(savePage).mockRejectedValueOnce(new Error('disk full'));
    const pending = changeTask('3017', '142', 'a', 'waiting');
    expect(stateOf('a')).toBe('waiting');
    expect(await pending).toBe(false);
    expect(stateOf('a')).toBe('todo');
    expect(get(taskUndo)).toBeNull();
    expect(lastLog()).toMatchObject({ level: 'error' });
    expect(lastLog().message).toMatch(/disk full/);
  });

  it('a failure on one page leaves a change on another page alone', async () => {
    vi.mocked(savePage).mockImplementation(async (book, pageId, d) => {
      if (pageId === '170') throw new Error('locked');
      disk[`${book}/${pageId}`] = d;
      return { success: true };
    });
    const a = changeTask('3017', '142', 'a', 'done');
    const c = changeTask('3017', '170', 'c', 'done');
    expect(await Promise.all([a, c])).toEqual([true, false]);
    expect(stateOf('a')).toBe('done');
    expect(stateOf('c')).toBe('waiting');
  });

  it('refuses while the page has an unsaved draft, without showing a change', async () => {
    markViewerDirtyPage('3017:142');
    expect(await changeTask('3017', '142', 'a', 'done')).toBe(false);
    expect(stateOf('a')).toBe('todo');
    expect(savePage).not.toHaveBeenCalled();
    expect(lastLog().message).toMatch(/unsaved transcript edits/);
  });

  it('a line removed since the scan is an error, not a write', async () => {
    disk['3017/142'].transcript.lines.splice(1, 1);
    expect(await changeTask('3017', '142', 'a', 'done')).toBe(false);
    expect(stateOf('a')).toBe('todo');
    expect(savePage).not.toHaveBeenCalled();
  });

  it('quick toggles on one page are written in order, last one wins', async () => {
    const first = toggleTask('3017', '142', 'a');   // → done
    const second = toggleTask('3017', '142', 'a');  // → todo
    expect(stateOf('a')).toBe('todo');
    await Promise.all([first, second]);
    expect(stateOf('a')).toBe('todo');
    expect(disk['3017/142'].transcript.lines[1].checked).toBe(false);
  });

  it('toggle: WAITING goes to DONE, DONE back to TODO', async () => {
    await toggleTask('3017', '170', 'c');
    expect(stateOf('c')).toBe('done');
    expect(disk['3017/170'].transcript.lines[0]).not.toHaveProperty('marker');
    await toggleTask('3017', '142', 'b');
    expect(stateOf('b')).toBe('todo');
  });

  it('a line the scan does not list yet uses the state the caller shows', async () => {
    savedPages.update((pages) => pages.map((p) => ({ ...p, tasks: [] })));
    expect(await toggleTask('3017', '142', 'a', { from: 'todo' })).toBe(true);
    expect(disk['3017/142'].transcript.lines[1].checked).toBe(true);
  });
});

describe('undoTaskChange', () => {
  it('puts the last change back, once', async () => {
    await changeTask('3017', '170', 'c', 'done');
    expect(await undoTaskChange()).toBe(true);
    expect(stateOf('c')).toBe('waiting');
    expect(disk['3017/170'].transcript.lines[0]).toMatchObject({ checked: false, marker: 'WAITING' });
    expect(get(taskUndo)).toBeNull();
    expect(await undoTaskChange()).toBe(false);
  });

  it('only the latest change is undoable', async () => {
    await changeTask('3017', '142', 'a', 'done');
    await changeTask('3017', '142', 'b', 'todo');
    await undoTaskChange();
    expect(stateOf('a')).toBe('done');
    expect(stateOf('b')).toBe('done');
  });
});
