/**
 * Tests for editor-lines.js: the Edit Transcription dialog's merge / split
 * keep task state, and an edited transcript written back takes the disk's
 * state for lines whose state the edit didn't change.
 */

import { describe, it, expect } from 'vitest';
import {
  mergeEditorLines, splitEditorLine, keepDiskTaskState, taskFieldsOf, buildEditedTranscript, mergeTranscriptLines,
  editorLineStatus, detectMergeSuggestions, deleteEditorLines, deletedLinesForSave,
  startHistory, pushHistory, stepHistory, savedLinesForEditor, mergeExistingAndNewLines
} from '../editor-lines.js';

const el = (i, text, extra = {}) => ({
  id: `line-${i}`, originalIndex: i, text, canonical: text.toLowerCase(),
  yBounds: { minY: i * 10, maxY: i * 10 + 5 }, indentLevel: 0, blockUuid: `L${i}`, syncStatus: 'synced', ...extra
});

describe('taskFieldsOf', () => {
  it('is the first task among the lines, with its marker', () => {
    expect(taskFieldsOf([el(0, 'a'), el(1, 'b', { checked: false, marker: 'WAITING' }), el(2, 'c', { checked: true })]))
      .toEqual({ checked: false, marker: 'WAITING' });
  });
  it('is {} when none is a task, and drops a marker on the wrong side', () => {
    expect(taskFieldsOf([el(0, 'a', { checked: null })])).toEqual({});
    expect(taskFieldsOf([])).toEqual({});
    expect(taskFieldsOf([el(0, 'a', { checked: true, marker: 'WAITING' })])).toEqual({ checked: true });
  });
});

describe('mergeEditorLines', () => {
  it('keeps the survivor block and takes the state of a task below it', () => {
    const m = mergeEditorLines([el(0, 'Smith'), el(1, 'geotech', { checked: false, marker: 'WAITING' })]);
    expect(m).toMatchObject({
      text: 'Smith geotech', blockUuid: 'L0', blocksToDelete: ['L1'], id: 'line-0',
      yBounds: { minY: 0, maxY: 15 }, checked: false, marker: 'WAITING'
    });
  });
  it('a merge of plain lines stays plain (no checked field)', () => {
    const m = mergeEditorLines([el(0, 'a'), el(1, 'b')]);
    expect('checked' in m).toBe(false);
    expect(m.mergedLineCount).toBe(2);
  });
  it('the top task wins when several are merged', () => {
    expect(mergeEditorLines([el(0, 'a', { checked: true }), el(1, 'b', { checked: false })]).checked).toBe(true);
  });
});

describe('splitEditorLine', () => {
  it('the first half keeps the block and the task state, the second is a plain new line', () => {
    const [a, b] = splitEditorLine(el(2, 'call city about permit', { checked: true, marker: 'CANCELLED' }), 'call city ', 'about permit');
    expect(a).toMatchObject({ text: 'call city', blockUuid: 'L2', checked: true, marker: 'CANCELLED', yBounds: { minY: 20, maxY: 22.5 } });
    expect(b).toMatchObject({ text: 'about permit', syncStatus: 'new', id: 'line-2-split' });
    expect(b.blockUuid).toBeUndefined();
    expect('checked' in b).toBe(false);
  });
});

describe('keepDiskTaskState', () => {
  const ln = (id, checked = null, marker) => ({ id, text: id, checked, ...(marker ? { marker } : {}) });

  it('a tick made on disk while editing is kept', () => {
    const out = keepDiskTaskState([ln('A', false)], [ln('A', false)], [ln('A', true)]);
    expect(out[0]).toMatchObject({ id: 'A', checked: true });
  });
  it('a line made plain on disk (Not a task) stays plain', () => {
    const out = keepDiskTaskState([ln('A', false, 'WAITING')], [ln('A', false, 'WAITING')], [ln('A', null)]);
    expect(out[0].checked).toBeNull();
    expect('marker' in out[0]).toBe(false);
  });
  it('a state the edit changed (a merge onto a plain line) wins over disk', () => {
    const lines = [ln('A', false)];
    expect(keepDiskTaskState(lines, [ln('A', null)], [ln('A', null)])).toEqual(lines);
  });
  it('lines new in the edit, or gone from disk, are left alone', () => {
    const lines = [ln('N', false), ln('G', true)];
    const out = keepDiskTaskState(lines, [ln('G', true)], []);
    expect(out[0]).toBe(lines[0]);
    expect(out[1]).toBe(lines[1]);
  });
});

describe('buildEditedTranscript (the Editor Pages tab save)', () => {
  let n = 0;
  const newId = () => `new-${++n}`;
  const disk = (id, text, extra = {}) => ({ id, text, indentLevel: 0, parentId: null, checked: null, yBounds: { minY: 1, maxY: 5 }, ...extra });

  it('keeps a tick made on disk while the dialog was open', () => {
    const base = [disk('L1', 'call Troy', { checked: false })];
    const now = [disk('L1', 'call Troy', { checked: true })];
    const { lines } = buildEditedTranscript([el(1, 'call Troy today', { blockUuid: 'L1', checked: false })], base, now, newId);
    expect(lines[0]).toMatchObject({ id: 'L1', text: 'call Troy today', checked: true });
  });

  it('a merged task keeps its state and hands its strokes to the survivor', () => {
    const base = [disk('L0', 'Smith'), disk('L1', 'geotech', { checked: false, marker: 'WAITING' })];
    const merged = mergeEditorLines([el(0, 'Smith'), el(1, 'geotech', { checked: false, marker: 'WAITING' })]);
    const { lines, lineIdRemap } = buildEditedTranscript([merged], base, base, newId);
    expect(lines).toEqual([expect.objectContaining({ id: 'L0', text: 'Smith geotech', checked: false, marker: 'WAITING' })]);
    expect(lineIdRemap.get('L1')).toBe('L0');
  });

  it('re-derives parentId from indents and gives new lines ids', () => {
    const { lines } = buildEditedTranscript([
      el(0, 'Smith'), { text: 'beam', indentLevel: 1, yBounds: { minY: 0, maxY: 0 } }
    ], [disk('L0', 'Smith')], [disk('L0', 'Smith')], newId);
    expect(lines[1]).toMatchObject({ text: 'beam', parentId: 'L0', checked: null, yBounds: null });
    expect(lines[1].id).toMatch(/^new-/);
  });
});

describe('mergeTranscriptLines (Library Edit merge)', () => {
  const tl = (id, text, extra = {}) => ({ id, text, indentLevel: 0, parentId: null, checked: null, yBounds: null, ...extra });

  it('joins the lines into the first, keeping its id and indent, with yBounds over the parts that have them', () => {
    const lines = [
      tl('a', 'Before'),
      tl('p1', '  The footing was poured ', { indentLevel: 1, yBounds: { minY: 10, maxY: 14 } }),
      tl('p2', 'before the rebar was', { yBounds: { minY: 15, maxY: 19 } }),
      tl('p3', 'inspected.'),
      tl('z', 'After'),
    ];
    const out = mergeTranscriptLines(lines, [3, 1, 2]);
    expect(out.map((l) => l.id)).toEqual(['a', 'p1', 'z']);
    expect(out[1]).toMatchObject({
      text: 'The footing was poured before the rebar was inspected.',
      indentLevel: 1, yBounds: { minY: 10, maxY: 19 }, checked: null, mergedIds: ['p2', 'p3'],
    });
    expect(out[1]).not.toHaveProperty('marker');
  });

  it('merges ticked lines that are not next to each other into the first one\'s place', () => {
    const out = mergeTranscriptLines([tl('a', 'x'), tl('b', 'y'), tl('c', 'z')], [0, 2]);
    expect(out.map((l) => [l.id, l.text])).toEqual([['a', 'x z'], ['b', 'y']]);
  });

  it('takes the first task\'s state, drops empty parts, and carries earlier merges', () => {
    const first = tl('a', 'plain', { mergedIds: ['old'] });
    const out = mergeTranscriptLines([first, tl('b', ''), tl('c', 'call', { checked: false, marker: 'WAITING', mergedIds: ['c0'] })], [0, 1, 2]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ text: 'plain call', checked: false, marker: 'WAITING', mergedIds: ['old', 'b', 'c', 'c0'], yBounds: null });
  });

  it('fewer than two valid indices leaves the lines alone', () => {
    const lines = [tl('a', 'x'), tl('b', 'y')];
    expect(mergeTranscriptLines(lines, [1])).toBe(lines);
    expect(mergeTranscriptLines(lines, [1, 1, 7])).toBe(lines);
    expect(mergeTranscriptLines([], [])).toEqual([]);
  });
});

describe('editorLineStatus', () => {
  it('is new without a saved counterpart, however edited', () => {
    expect(editorLineStatus({ syncStatus: 'new', blockUuid: 'L1' })).toBe('new');
    expect(editorLineStatus({ blockUuid: null, userModified: true, syncStatus: 'modified' })).toBe('new');
  });

  it('is modified for a saved line changed in the dialog', () => {
    expect(editorLineStatus({ blockUuid: 'L1', syncStatus: 'modified' })).toBe('modified');
    expect(editorLineStatus({ blockUuid: 'L1', syncStatus: 'synced', userModified: true })).toBe('modified');
  });

  it('is synced for a saved line left alone', () => {
    expect(editorLineStatus({ blockUuid: 'L1', syncStatus: 'synced' })).toBe('synced');
  });
});

describe('detectMergeSuggestions', () => {
  it('pairs a line that runs on into a lowercase next line', () => {
    const lines = [el(0, 'Check the beam'), el(1, 'at grid B'), el(2, 'Done.')];
    expect(detectMergeSuggestions(lines)).toEqual([{ indices: [0, 1], confidence: 0.8 }]);
  });

  it('does not pair across a sentence end, an indent change or a capital', () => {
    expect(detectMergeSuggestions([el(0, 'End.'), el(1, 'next')])).toEqual([]);
    expect(detectMergeSuggestions([el(0, 'One'), el(1, 'two', { indentLevel: 1 })])).toEqual([]);
    expect(detectMergeSuggestions([el(0, 'One'), el(1, 'Two')])).toEqual([]);
  });

  it('skips lines without yBounds or text instead of throwing', () => {
    expect(detectMergeSuggestions([el(0, 'One', { yBounds: null }), el(1, 'two')])).toEqual([]);
    expect(detectMergeSuggestions([el(0, 'One'), { yBounds: { minY: 6, maxY: 9 } }])).toEqual([]);
    expect(detectMergeSuggestions([])).toEqual([]);
    expect(detectMergeSuggestions(null)).toEqual([]);
  });
});

describe("deleteEditorLines (the dialog's Delete, v3.20.0)", () => {
  // Meeting / ··Tom / ····call back / Next
  const dialog = () => [
    el(0, 'Meeting'), el(1, 'Tom', { indentLevel: 1 }), el(2, 'call back', { indentLevel: 2 }), el(3, 'Next')
  ];

  it('Delete line: its children move up one level and read as modified', () => {
    const r = deleteEditorLines(dialog(), [0]);
    expect(r.lines.map((l) => [l.text, l.indentLevel])).toEqual([['Tom', 0], ['call back', 1], ['Next', 0]]);
    expect(r.lines.slice(0, 2).map(editorLineStatus)).toEqual(['modified', 'modified']);
    expect(editorLineStatus(r.lines[2])).toBe('synced');
    expect(r.removed.map((l) => l.blockUuid)).toEqual(['L0']);
  });

  it('Delete block: the children go too', () => {
    const r = deleteEditorLines(dialog(), [0], { block: true });
    expect(r.lines.map((l) => l.text)).toEqual(['Next']);
    expect(r.removed.map((l) => l.blockUuid)).toEqual(['L0', 'L1', 'L2']);
  });

  it('a line of the run not saved yet: removed, and reported by its bounds, not an id', () => {
    const fresh = el(4, 'scribble', { blockUuid: undefined, syncStatus: 'new', fromBatch: true, yBounds: { minY: 40, maxY: 45 } });
    const typed = el(5, 'typed', { blockUuid: undefined, syncStatus: 'new', yBounds: { minY: 0, maxY: 0 } });
    const r = deleteEditorLines([...dialog(), fresh, typed], [4, 5]);
    expect(r.lines).toHaveLength(4);
    expect(deletedLinesForSave(r.removed)).toEqual({
      deletedLineIds: [],
      deletedLines: [{ yBounds: { minY: 40, maxY: 45 }, fromBatch: true }]
    });
  });

  it('a deleted merged line reports the saved lines merged into it too', () => {
    const merged = mergeEditorLines([el(0, 'a'), el(1, 'b')]);
    expect(deletedLinesForSave([merged]).deletedLineIds).toEqual(['L0', 'L1']);
    expect(deletedLinesForSave([])).toEqual({ deletedLineIds: [], deletedLines: [] });
  });
});

describe("the dialog's undo history", () => {
  it('undo brings a deleted line back, redo deletes it again', () => {
    const lines = [el(0, 'Meeting'), el(1, 'Tom', { indentLevel: 1 })];
    let h = startHistory({ lines, deleted: [] });
    const r = deleteEditorLines(lines, [0]);
    h = pushHistory(h, { lines: r.lines, deleted: r.removed });
    expect(h.at).toBe(1);

    const back = stepHistory(h, -1);
    expect(back.state.lines.map((l) => [l.text, l.indentLevel])).toEqual([['Meeting', 0], ['Tom', 1]]);
    expect(back.state.deleted).toEqual([]);
    h = back.history;

    const again = stepHistory(h, 1);
    expect(again.state.lines.map((l) => l.text)).toEqual(['Tom']);
    expect(again.state.deleted.map((l) => l.blockUuid)).toEqual(['L0']);
  });

  it('a step equal to the current one adds nothing; a new step drops the redo steps', () => {
    const lines = [el(0, 'a')];
    let h = startHistory({ lines, deleted: [] });
    expect(pushHistory(h, { lines, deleted: [] })).toBe(h);
    h = pushHistory(h, { lines: [], deleted: lines });
    h = stepHistory(h, -1).history;
    h = pushHistory(h, { lines: [el(0, 'b')], deleted: [] });
    expect(h.steps).toHaveLength(2);
    expect(stepHistory(h, 1)).toBeNull();
    expect(stepHistory(startHistory({ lines: [], deleted: [] }), -1)).toBeNull();
  });

  it('steps are copies: editing the shown state does not change the history', () => {
    const h = startHistory({ lines: [el(0, 'a')], deleted: [] });
    const shown = stepHistory(pushHistory(h, { lines: [el(0, 'b')], deleted: [] }), -1).state;
    shown.lines[0].text = 'changed';
    expect(h.steps[0].lines[0].text).toBe('a');
  });
});

describe('savedLinesForEditor / mergeExistingAndNewLines (moved from TranscriptionView)', () => {
  it('saved lines carry their id as blockUuid and their task state', () => {
    const [l] = savedLinesForEditor([{ id: 'A', text: 'Call', indentLevel: 1, checked: false, marker: 'WAITING', yBounds: null }]);
    expect(l).toMatchObject({ blockUuid: 'A', canonical: 'call', checked: false, marker: 'WAITING', syncStatus: 'synced', yBounds: { minY: 0, maxY: 0 } });
  });

  it('a run line already saved (same text, overlapping) is not listed twice; the rest come in as new', () => {
    const existing = savedLinesForEditor([{ id: 'A', text: 'Call', yBounds: { minY: 1, maxY: 5 } }]);
    const out = mergeExistingAndNewLines(existing, [{ text: 'call', yBounds: { minY: 2, maxY: 6 } }, { text: 'more', yBounds: { minY: 9, maxY: 12 } }]);
    expect(out.map((l) => [l.text, l.syncStatus, !!l.fromBatch])).toEqual([['Call', 'synced', false], ['more', 'new', true]]);
    expect(mergeExistingAndNewLines([], [{ text: 'x' }])[0]).toMatchObject({ syncStatus: 'new', fromBatch: true });
  });
});
