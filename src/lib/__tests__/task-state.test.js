/**
 * Tests for lib/viewer/task-state.js setTaskState(): one line of one PageDoc
 * changes, `metadata.lastUpdated` is bumped, `transcript.lastTranscribed`
 * never is, and the refusals (unsaved draft, missing page / line, not a task)
 * write nothing. Also the copies it refreshes: the scan record, the page
 * cache and the reader's `lastTaskWrite`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';

vi.mock('$lib/storage/local-store.js', () => ({
  getPage: vi.fn(),
  savePage: vi.fn()
}));
vi.mock('$lib/viewer/page-cache.js', () => ({
  invalidatePage: vi.fn(),
  getCachedPage: vi.fn(),
  peekCachedPage: vi.fn(),
  clearPageCache: vi.fn()
}));

import { getPage, savePage } from '$lib/storage/local-store.js';
import { invalidatePage } from '$lib/viewer/page-cache.js';
import { setTaskState, docWithTaskState, TaskStateError } from '../viewer/task-state.js';
import {
  savedPages, markViewerDirtyPage, clearAllViewerDirty, lastTaskWrite
} from '$stores';
import { isTrustworthyTranscript } from '../viewer/ink-text.js';

const LAST_TRANSCRIBED = '2026-09-01T10:00:00.000Z';

function makeDoc() {
  return {
    version: '2.0',
    pageInfo: { section: 3, owner: 1012, book: 3017, page: 142 },
    metadata: { lastUpdated: '2026-09-01T10:00:00.000Z', totalStrokes: 1, bounds: { minX: 0, maxX: 1, minY: 0, maxY: 1 } },
    transcript: {
      lastTranscribed: LAST_TRANSCRIBED,
      lines: [
        { id: 'h', text: 'Meeting', indentLevel: 0, parentId: null, checked: null, yBounds: { minY: 1, maxY: 2 } },
        { id: 'a', text: 'Call Troy', indentLevel: 1, parentId: 'h', checked: false, yBounds: { minY: 3, maxY: 4 } },
        { id: 'b', text: 'Check PO', indentLevel: 1, parentId: 'h', checked: true, yBounds: null }
      ]
    },
    strokes: [{ id: 's1', startTime: 1, endTime: 2, lineId: 'a', points: [[1, 2, 1, 300], [2, 3, 2, 310]] }]
  };
}

const record = () => ({
  book: '3017', page: 142, pageId: '142', lastUpdated: 'old',
  tasks: [
    { id: 'a', text: 'Call Troy', checked: false, marker: null, parentText: 'Meeting' },
    { id: 'b', text: 'Check PO', checked: true, marker: null, parentText: 'Meeting' }
  ]
});

beforeEach(() => {
  vi.mocked(getPage).mockReset();
  vi.mocked(savePage).mockReset();
  vi.mocked(savePage).mockResolvedValue({ success: true });
  vi.mocked(invalidatePage).mockReset();
  clearAllViewerDirty();
  savedPages.set([record()]);
});

const written = () => vi.mocked(savePage).mock.calls[0][2];

describe('setTaskState', () => {
  it('changes only that line and lastUpdated', async () => {
    const doc = makeDoc();
    vi.mocked(getPage).mockResolvedValue(doc);
    const res = await setTaskState('3017', '142', 'a', 'done');
    expect(res).toMatchObject({ changed: true, prev: 'todo', state: 'done' });

    const [book, pageId, out] = vi.mocked(savePage).mock.calls[0];
    expect([book, pageId]).toEqual(['3017', '142']);
    expect(out.transcript.lines[1]).toEqual({ ...doc.transcript.lines[1], checked: true });
    expect(out.transcript.lines[0]).toBe(doc.transcript.lines[0]);
    expect(out.transcript.lines[2]).toBe(doc.transcript.lines[2]);
    expect(out.strokes).toBe(doc.strokes);
    expect(out.transcript.lastTranscribed).toBe(LAST_TRANSCRIBED);
    expect(out.metadata.lastUpdated).not.toBe(doc.metadata.lastUpdated);
    expect({ ...out.metadata, lastUpdated: 0 }).toEqual({ ...doc.metadata, lastUpdated: 0 });
    expect(isTrustworthyTranscript(out)).toBe(isTrustworthyTranscript(doc));
  });

  it('WAITING adds the marker; TODO and DONE clear it', async () => {
    vi.mocked(getPage).mockResolvedValue(makeDoc());
    await setTaskState('3017', '142', 'a', 'waiting');
    expect(written().transcript.lines[1]).toMatchObject({ checked: false, marker: 'WAITING' });

    const waiting = makeDoc();
    waiting.transcript.lines[1].marker = 'WAITING';
    vi.mocked(savePage).mockClear();
    vi.mocked(getPage).mockResolvedValue(waiting);
    await setTaskState('3017', '142', 'a', 'todo');
    expect(written().transcript.lines[1]).not.toHaveProperty('marker');
    expect(written().transcript.lines[1].checked).toBe(false);
  });

  it('CANCELLED writes checked: true with the marker; reopening clears it (v3.5.0)', async () => {
    const doc = makeDoc();
    vi.mocked(getPage).mockResolvedValue(doc);
    const res = await setTaskState('3017', '142', 'a', 'cancelled');
    expect(res).toMatchObject({ changed: true, prev: 'todo', state: 'cancelled' });
    expect(written().transcript.lines[1]).toEqual({ ...doc.transcript.lines[1], checked: true, marker: 'CANCELLED' });
    expect(written().transcript.lastTranscribed).toBe(LAST_TRANSCRIBED);
    expect(get(savedPages)[0].tasks[0]).toMatchObject({ id: 'a', checked: true, marker: 'CANCELLED' });

    const cancelled = makeDoc();
    Object.assign(cancelled.transcript.lines[1], { checked: true, marker: 'CANCELLED' });
    vi.mocked(savePage).mockClear();
    vi.mocked(getPage).mockResolvedValue(cancelled);
    const back = await setTaskState('3017', '142', 'a', 'todo');
    expect(back.prev).toBe('cancelled');
    expect(written().transcript.lines[1]).not.toHaveProperty('marker');
    expect(written().transcript.lines[1].checked).toBe(false);
  });

  it('refreshes the scan record, the page cache and the open reader', async () => {
    vi.mocked(getPage).mockResolvedValue(makeDoc());
    const before = get(lastTaskWrite);
    const res = await setTaskState('3017', '142', 'b', 'todo');
    const r = get(savedPages)[0];
    expect(r.tasks[1]).toMatchObject({ id: 'b', checked: false, marker: null });
    expect(r.tasks[0]).toEqual(record().tasks[0]);
    expect(r.lastUpdated).toBe(res.lastUpdated);
    expect(invalidatePage).toHaveBeenCalledWith('3017', '142');
    expect(get(lastTaskWrite)).toMatchObject({ book: '3017', pageId: '142', lineId: 'b', state: 'todo', n: (before?.n || 0) + 1 });
  });

  it('writes nothing when the line is already in that state', async () => {
    vi.mocked(getPage).mockResolvedValue(makeDoc());
    expect(await setTaskState('3017', '142', 'b', 'done')).toMatchObject({ changed: false });
    expect(savePage).not.toHaveBeenCalled();
  });

  it('refuses while the page has an unsaved transcript draft', async () => {
    vi.mocked(getPage).mockResolvedValue(makeDoc());
    markViewerDirtyPage('3017:142');
    await expect(setTaskState('3017', '142', 'a', 'done')).rejects.toMatchObject({ code: 'dirty', message: expect.stringMatching(/unsaved transcript edits/) });
    expect(getPage).not.toHaveBeenCalled();
    expect(savePage).not.toHaveBeenCalled();
  });

  it('a draft on another page does not block', async () => {
    vi.mocked(getPage).mockResolvedValue(makeDoc());
    markViewerDirtyPage('3017:143');
    await setTaskState('3017', '142', 'a', 'done');
    expect(savePage).toHaveBeenCalledTimes(1);
  });

  it('refuses a line that no longer exists', async () => {
    vi.mocked(getPage).mockResolvedValue(makeDoc());
    await expect(setTaskState('3017', '142', 'gone', 'done')).rejects.toMatchObject({ code: 'no-line' });
    expect(savePage).not.toHaveBeenCalled();
  });

  it('refuses a missing page', async () => {
    vi.mocked(getPage).mockResolvedValue(null);
    await expect(setTaskState('3017', '142', 'a', 'done')).rejects.toBeInstanceOf(TaskStateError);
    await expect(setTaskState('3017', '142', 'a', 'done')).rejects.toMatchObject({ code: 'no-page' });
    expect(savePage).not.toHaveBeenCalled();
  });

  it('refuses a line that is not a task, and an unknown state', async () => {
    vi.mocked(getPage).mockResolvedValue(makeDoc());
    await expect(setTaskState('3017', '142', 'h', 'done')).rejects.toMatchObject({ code: 'not-task' });
    await expect(setTaskState('3017', '142', 'a', 'doing')).rejects.toMatchObject({ code: 'bad-state' });
    expect(savePage).not.toHaveBeenCalled();
  });

  it('a failed write leaves the scan record alone', async () => {
    vi.mocked(getPage).mockResolvedValue(makeDoc());
    vi.mocked(savePage).mockRejectedValue(new Error('disk full'));
    await expect(setTaskState('3017', '142', 'a', 'done')).rejects.toThrow('disk full');
    expect(get(savedPages)[0]).toEqual(record());
  });
});

describe('Not a task', () => {
  beforeEach(() => {
    let disk = makeDoc();
    vi.mocked(getPage).mockImplementation(async () => structuredClone(disk));
    vi.mocked(savePage).mockImplementation(async (b, p, d) => { disk = d; return { success: true }; });
    savedPages.set([record()]);
  });

  it('makes the line plain, keeps its text, and drops it from the scan record', async () => {
    const res = await setTaskState('3017', '142', 'a', 'none');
    expect(res).toMatchObject({ changed: true, prev: 'todo', state: 'none' });
    const written = vi.mocked(savePage).mock.calls[0][2];
    expect(written.transcript.lines[1]).toEqual({ ...makeDoc().transcript.lines[1], checked: null });
    expect(written.transcript.lastTranscribed).toBe(LAST_TRANSCRIBED);
    expect(get(savedPages)[0].tasks.map((t) => t.id)).toEqual(['b']);
    expect(get(lastTaskWrite)).toMatchObject({ lineId: 'a', state: 'none' });
  });

  it('a plain line is refused unless it is an Undo (allowPlain), which restores the task', async () => {
    await setTaskState('3017', '142', 'a', 'none');
    await expect(setTaskState('3017', '142', 'a', 'todo')).rejects.toMatchObject({ code: 'not-task' });
    const res = await setTaskState('3017', '142', 'a', 'waiting', { allowPlain: true });
    expect(res).toMatchObject({ changed: true, prev: 'none' });
    expect(get(savedPages)[0].tasks.map((t) => [t.id, t.marker])).toEqual([['a', 'WAITING'], ['b', null]]);
  });

  it('Not a task on a plain line is refused (the header is not a task)', async () => {
    await expect(setTaskState('3017', '142', 'h', 'none')).rejects.toMatchObject({ code: 'not-task' });
    expect(savePage).not.toHaveBeenCalled();
  });
});

describe('docWithTaskState', () => {
  it('is pure', () => {
    const doc = makeDoc();
    const snapshot = JSON.stringify(doc);
    const out = docWithTaskState(doc, 'a', 'waiting', 'NOW');
    expect(JSON.stringify(doc)).toBe(snapshot);
    expect(out.prev).toBe('todo');
    expect(out.doc.metadata.lastUpdated).toBe('NOW');
  });
});
