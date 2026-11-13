/**
 * Tests for stores/mcp-edits.js: Claude's edits applied by the app. A dry run
 * saves nothing; an apply needs the dry run's revision, saves through
 * saveTranscriptLines (task state from disk, deleted line's ink unlinked),
 * logs an undo entry first and refreshes the views; undo restores the page
 * exactly while nothing else has written it. Every guard refuses with nothing
 * written. Disk and main's undo log are in memory here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';

const disk = new Map();
let clock = 0;
vi.mock('$lib/storage/local-store.js', () => ({
  getPage: vi.fn(async (book, page) => {
    const d = disk.get(`${book}/${page}`);
    return d ? JSON.parse(JSON.stringify(d)) : null;
  }),
  savePage: vi.fn(async (book, page, doc) => {
    // Each write gets a distinct lastUpdated, as real writes a few ms apart do.
    const stamped = { ...doc, metadata: { ...doc.metadata, lastUpdated: `${doc.metadata.lastUpdated}#${++clock}` } };
    disk.set(`${book}/${page}`, JSON.parse(JSON.stringify(stamped)));
    return { success: true };
  }),
}));
vi.mock('$lib/storage/refresh.js', () => ({ refreshAfterSave: vi.fn(async () => {}) }));

import { savePage } from '$lib/storage/local-store.js';
import { refreshAfterSave } from '$lib/storage/refresh.js';
import { runEdit, runUndo, lastMcpEdit } from '$stores/mcp-edits.js';
import { dataRoot, dataFolderReady } from '$stores/settings.js';
import { markViewerDirtyPage, clearViewerDirtyPage, transcriptEditorHold } from '$stores/viewer.js';
import { pageTranscriptions } from '$stores/transcription.js';

const ROOT = 'C:\\scratch\\data';
const line = (id, text, indentLevel = 0, extra = {}) => ({
  id, text, indentLevel, parentId: null, checked: null, yBounds: { minY: 1, maxY: 2 }, ...extra
});

function makeDoc() {
  return {
    version: '2.0',
    pageInfo: { section: 3, owner: 1012, book: 3017, page: 180 },
    metadata: { lastUpdated: '2026-11-11T18:35:15.510Z', totalStrokes: 3, bounds: { minX: 0, maxX: 1, minY: 0, maxY: 1 } },
    transcript: {
      lastTranscribed: '2026-11-10T10:00:00.000Z',
      lines: [
        line('h', 'Prototyping Concrete Masonry Storm Shelters'),
        line('b', 'Brad Russell, AlA, P.E., S.E.', 1),
        line('s', 'Typical, A-Block, H-Block', 1),
        line('t', 'call Brad', 1, { checked: false }),
      ],
    },
    strokes: [
      { id: 's1', startTime: 1, endTime: 2, lineId: 'b', points: [[1, 2], [2, 3]] },
      { id: 's2', startTime: 3, endTime: 4, lineId: 's', points: [[1, 2], [2, 3]] },
      { id: 's3', startTime: 5, endTime: 6, lineId: 's', points: [[1, 2], [2, 3]] },
    ],
  };
}

const EDITS = [
  { op: 'set_text', line: 2, expect: 'Brad Russell, AlA, P.E., S.E.', text: 'Brad Russell, AIA, P.E., S.E.' },
  { op: 'delete', line: 3, expect: 'Typical, A-Block, H-Block' },
  { op: 'insert', after: 1, expect: 'Prototyping Concrete Masonry Storm Shelters', level: 1, text: 'Jason Thompson' },
];
const req = (extra = {}) => ({ book: '3017', page: '180', data_root: 'c:/scratch/data/', edits: EDITS, dry_run: true, ...extra });

let undoLog;
beforeEach(() => {
  disk.clear();
  disk.set('3017/180', makeDoc());
  undoLog = [];
  vi.mocked(savePage).mockClear();
  vi.mocked(refreshAfterSave).mockClear();
  window.mcpAPI = {
    editLog: vi.fn(async (action, book, page, payload) => {
      const last = undoLog[undoLog.length - 1] || null;
      if (action === 'append') undoLog.push(payload);
      if (action === 'finish') Object.assign(last, payload);
      if (action === 'drop' || action === 'pop') undoLog.pop();
      return { ok: true, result: action === 'append' ? payload : last };
    }),
  };
  dataRoot.set(ROOT);
  dataFolderReady.set(true);
  pageTranscriptions.set(new Map());
});

const stored = () => disk.get('3017/180');

describe('runEdit', () => {
  it('a dry run lists the result and saves nothing', async () => {
    const r = await runEdit(req());
    expect(r.ok).toBe(true);
    expect(r.revision).toBe('2026-11-11T18:35:15.510Z');
    expect(r.text).toContain('nothing saved');
    expect(r.text).toContain('~  #3     - Brad Russell, AIA, P.E., S.E.');
    expect(r.text).toContain('+  #2     - Jason Thompson');
    expect(r.text).toContain('Inserted lines have no ink linked');
    expect(savePage).not.toHaveBeenCalled();
    expect(undoLog).toEqual([]);
  });

  it('apply needs the dry run revision', async () => {
    expect((await runEdit(req({ dry_run: false }))).error).toMatch(/revision is required/);
    expect((await runEdit(req({ dry_run: false, revision: 'old' }))).error).toMatch(/changed since the dry run/);
    expect(savePage).not.toHaveBeenCalled();
  });

  it('applies through the Library Edit save, logs undo first, refreshes and announces', async () => {
    const { revision } = await runEdit(req());
    const r = await runEdit(req({ dry_run: false, revision }));
    expect(r.ok).toBe(true);
    expect(r.text).toMatch(/^Saved B3017\/P180 \(1 changed, 1 inserted, 1 deleted\)/);
    const doc = stored();
    expect(doc.transcript.lines.map((l) => [l.text, l.indentLevel, l.parentId])).toEqual([
      ['Prototyping Concrete Masonry Storm Shelters', 0, null],
      ['Jason Thompson', 1, 'h'],
      ['Brad Russell, AIA, P.E., S.E.', 1, 'h'],
      ['call Brad', 1, 'h'],
    ]);
    expect(doc.transcript.lines[3]).toMatchObject({ id: 't', checked: false });
    // the deleted line's ink is unlinked; other links stay
    expect(doc.strokes.map((s) => s.lineId)).toEqual(['b', null, null]);
    expect(r.revision).toBe(doc.metadata.lastUpdated);
    expect(undoLog).toHaveLength(1);
    expect(undoLog[0]).toMatchObject({ revisionBefore: revision, revisionAfter: doc.metadata.lastUpdated, scrubbed: [['s2', 's'], ['s3', 's']] });
    expect(undoLog[0].transcript).toEqual(makeDoc().transcript);
    expect(refreshAfterSave).toHaveBeenCalledWith([{ book: '3017', pageId: '180' }]);
    expect(get(lastMcpEdit).label).toBe('Claude edited B3017/P180: 1 changed, 1 inserted, 1 deleted');
  });

  it('undo restores the page exactly, links included, then has nothing left', async () => {
    const { revision } = await runEdit(req());
    await runEdit(req({ dry_run: false, revision }));
    const u = await runUndo(req());
    expect(u.ok).toBe(true);
    expect(stored().transcript).toEqual(makeDoc().transcript);
    expect(stored().strokes).toEqual(makeDoc().strokes);
    expect(undoLog).toEqual([]);
    expect((await runUndo(req())).error).toMatch(/No Claude edit to undo/);
  });

  it('undo refuses once the page was written since', async () => {
    const { revision } = await runEdit(req());
    await runEdit(req({ dry_run: false, revision }));
    const d = stored();
    d.metadata.lastUpdated = 'later';
    expect((await runUndo(req())).error).toMatch(/edited since/);
  });

  it('an undo log that cannot be written refuses the edit before any save', async () => {
    const { revision } = await runEdit(req());
    const real = window.mcpAPI.editLog;
    window.mcpAPI.editLog = vi.fn(async () => ({ ok: false, error: 'disk full' }));
    const r = await runEdit(req({ dry_run: false, revision }));
    window.mcpAPI.editLog = real;
    expect(r.error).toMatch(/undo log.*nothing was saved.*disk full/);
    expect(savePage).not.toHaveBeenCalled();
  });

  it('a failed finish after the save still reports the save, with undo unavailable', async () => {
    const { revision } = await runEdit(req());
    const real = window.mcpAPI.editLog;
    window.mcpAPI.editLog = vi.fn(async (action, ...rest) => (action === 'finish'
      ? { ok: false, error: 'locked' } : real(action, ...rest)));
    const r = await runEdit(req({ dry_run: false, revision }));
    window.mcpAPI.editLog = real;
    expect(r.ok).toBe(true);
    expect(r.revision).toBe(stored().metadata.lastUpdated);
    expect(r.text).not.toMatch(/undo with undo_transcript_edit/);
    expect(r.text).toMatch(/WARNING: undo_transcript_edit is not available for this edit \(locked\)/);
    expect(refreshAfterSave).toHaveBeenCalled();
  });

  it('a failed pop after an undo still reports the restore', async () => {
    const { revision } = await runEdit(req());
    await runEdit(req({ dry_run: false, revision }));
    const real = window.mcpAPI.editLog;
    window.mcpAPI.editLog = vi.fn(async (action, ...rest) => (action === 'pop'
      ? { ok: false, error: 'locked' } : real(action, ...rest)));
    const u = await runUndo(req());
    window.mcpAPI.editLog = real;
    expect(u.ok).toBe(true);
    expect(u.text).toMatch(/WARNING: the undo log entry could not be removed/);
    expect(stored().transcript).toEqual(makeDoc().transcript);
    // the entry left behind is stale: a second undo is refused, not applied twice
    expect((await runUndo(req())).error).toMatch(/edited since/);
  });

  it('a refused plan saves nothing and logs nothing', async () => {
    const r = await runEdit(req({ edits: [{ op: 'set_text', line: 2, expect: 'stale', text: 'x' }] }));
    expect(r.error).toMatch(/#2 reads/);
    const t = await runEdit(req({ edits: [{ op: 'delete', line: 4, expect: 'call Brad' }] }));
    expect(t.error).toMatch(/task_ok/);
    expect(savePage).not.toHaveBeenCalled();
  });
});

describe('guards', () => {
  it('refuses another data folder, a Library draft, an open editor, a pending transcription', async () => {
    expect((await runEdit(req({ data_root: 'D:\\other' }))).error).toMatch(/MCP reads/);

    markViewerDirtyPage('3017:180');
    expect((await runEdit(req())).error).toMatch(/unsaved transcript edits in the Library/);
    clearViewerDirtyPage('3017:180');

    const hold = transcriptEditorHold();
    hold.set('3017:180', true);
    expect((await runEdit(req())).error).toMatch(/open in a transcript editor/);
    expect((await runUndo(req())).error).toMatch(/open in a transcript editor/);
    hold.release();

    pageTranscriptions.set(new Map([['k', { pageInfo: { book: '3017', page: 180 } }]]));
    expect((await runEdit(req())).error).toMatch(/unsaved transcription in the Editor/);
    pageTranscriptions.set(new Map());

    dataFolderReady.set(false);
    expect((await runEdit(req())).error).toMatch(/no data folder/);
    expect(savePage).not.toHaveBeenCalled();
  });

  it('a missing page or one with no transcript', async () => {
    expect((await runEdit(req({ page: '181' }))).error).toMatch(/No page B3017\/P181/);
    disk.set('3017/180', { ...makeDoc(), transcript: { lastTranscribed: null, lines: [] } });
    expect((await runEdit(req())).error).toMatch(/has no transcript/);
  });
});
