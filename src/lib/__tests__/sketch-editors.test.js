/**
 * Sketch lines in the transcript editors (v3.24.0, docs/TRANSCRIPT-STRUCTURE-SPEC.md
 * E.3 / E.4 / E.7): Library Edit (transcript-draft, save-transcript) and the Edit
 * Transcription dialog (editor-lines) keep a sketch row's kind and box, never merge,
 * split or empty it into a delete, a cleared label reads "Sketch", deleting one asks
 * first, and its ink is only unlinked (never flagged Not text, never deleted).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/storage/local-store.js', () => ({ getPage: vi.fn(), savePage: vi.fn() }));

import { getPage, savePage } from '$lib/storage/local-store.js';
import { cloneLines, mergeIndices, deletedBaseIds } from '../viewer/transcript-draft.js';
import { saveTranscriptLines, parseTypedTasks } from '../viewer/save-transcript.js';
import {
  mergeTranscriptLines, savedLinesForEditor, buildEditedTranscript, emptiedLines, detectMergeSuggestions
} from '../editor-lines.js';
import { deletePrompt, sketchConfirmText } from '../delete-lines.js';

const B = { minX: 1, maxX: 5, minY: 10, maxY: 20 };
const lines = () => [
  { id: 'A', text: 'visit', indentLevel: 0, parentId: null, checked: null, yBounds: { minY: 1, maxY: 2 } },
  { id: 'S', kind: 'sketch', text: 'Floor plan', indentLevel: 1, parentId: 'A', checked: null, yBounds: null, bounds: B },
  { id: 'C', text: 'heater', indentLevel: 1, parentId: 'A', checked: false, yBounds: { minY: 3, maxY: 4 } },
];

describe('Library Edit (transcript-draft)', () => {
  it('cloneLines keeps a sketch\'s kind and box', () => {
    expect(cloneLines(lines())[1]).toMatchObject({ id: 'S', kind: 'sketch', bounds: B, text: 'Floor plan' });
    expect(cloneLines(lines())[0]).not.toHaveProperty('kind');
  });
  it('Merge never takes a sketch', () => {
    const d = cloneLines(lines());
    expect(mergeIndices(d, new Set(), 0)).toEqual([]);
    expect(mergeIndices(d, new Set(['A', 'C']), -1)).toEqual([0, 2]);
    expect(mergeIndices(d, new Set(['A', 'S']), -1)).toEqual([]);
  });
  it('a deleted sketch is not the ink choice\'s business', () => {
    expect(deletedBaseIds([lines()[0]], lines())).toEqual(['C']);
  });
});

describe('Library Edit save (saveTranscriptLines)', () => {
  const doc = () => ({
    version: '2.0', pageInfo: {}, metadata: {}, transcript: { lastTranscribed: 'x', lines: lines() },
    strokes: [
      { id: 's1', lineId: 'A', points: [[1, 1], [2, 2]] },
      { id: 's2', lineId: 'S', points: [[1, 10], [5, 20]] },
      { id: 's3', lineId: 'S', points: [[2, 12], [3, 14]] },
      { id: 's4', lineId: 'C', points: [[1, 3], [2, 4]] },
    ]
  });
  beforeEach(() => {
    getPage.mockReset();
    savePage.mockReset();
    savePage.mockResolvedValue({ success: true });
  });

  it('keeps the kind and box; a cleared label is "Sketch"; a typed box never makes it a task', async () => {
    getPage.mockResolvedValue(doc());
    const draft = cloneLines(lines());
    draft[1].text = '';
    const r = await saveTranscriptLines('3017', '124', draft, { base: lines() });
    expect(r.lines[1]).toEqual({ id: 'S', kind: 'sketch', text: 'Sketch', indentLevel: 1, parentId: 'A', bounds: { minX: 1, maxX: 5, minY: 10, maxY: 20 }, checked: null, yBounds: null });
    expect(parseTypedTasks([{ id: 'S', kind: 'sketch', text: 'TODO plan', checked: null }], null)[0].checked).toBeNull();
  });

  it('a deleted sketch\'s ink is unlinked, never flagged Not text and never deleted', async () => {
    getPage.mockResolvedValue(doc());
    const draft = cloneLines(lines()).filter((l) => l.id !== 'S');
    const r = await saveTranscriptLines('3017', '124', draft, { base: lines(), deletedInk: 'textless' });
    expect(r.strokes).toHaveLength(4);
    expect(r.strokes.filter((s) => s.lineId === null).map((s) => s.id)).toEqual(['s2', 's3']);
    expect(r.strokes.some((s) => s.textless)).toBe(false);
    expect(r.textlessIds).toEqual([]);
  });
});

describe('the Edit Transcription dialog (editor-lines)', () => {
  it('savedLinesForEditor carries the kind and box', () => {
    expect(savedLinesForEditor(lines())[1]).toMatchObject({ kind: 'sketch', bounds: B, blockUuid: 'S' });
  });
  it('mergeTranscriptLines refuses a sketch', () => {
    const l = lines();
    expect(mergeTranscriptLines(l, [0, 1])).toBe(l);
  });
  it('an emptied sketch label is not a delete', () => {
    const rows = savedLinesForEditor(lines()).map((l, i) => ({ ...l, originalIndex: i, text: i === 1 ? '' : l.text }));
    expect(emptiedLines(rows, rows).indices).toEqual([]);
  });
  it('no merge suggestion takes a sketch row', () => {
    const rows = [{ text: 'a line', yBounds: { minY: 0, maxY: 0 } }, { text: 'lower', kind: 'sketch', yBounds: { minY: 0, maxY: 0 } }];
    expect(detectMergeSuggestions(rows)).toEqual([]);
  });
  it('the Pages tab\'s Edit structure (buildEditedTranscript) keeps the sketch; a cleared label is "Sketch"', () => {
    const rows = savedLinesForEditor(lines());
    rows[1] = { ...rows[1], text: '  ' };
    const { lines: out } = buildEditedTranscript(rows, lines(), lines(), () => 'new');
    expect(out[1]).toMatchObject({ id: 'S', kind: 'sketch', text: 'Sketch', bounds: B, checked: null, yBounds: null, parentId: 'A' });
  });
});

describe('deleting a sketch asks first', () => {
  it('deletePrompt asks for a sketch line, naming it', () => {
    const p = deletePrompt(lines(), [1]);
    expect(p).toMatchObject({ askBlock: false, lineSketches: ['Floor plan'], lineTasks: [] });
    expect(sketchConfirmText(p.lineSketches)).toBe("Delete the sketch 'Floor plan'?");
    expect(sketchConfirmText(['a', 'b'])).toBe("Delete 2 sketches ('a', 'b')?");
    expect(sketchConfirmText([])).toBe('');
  });
  it('a block holding a sketch names it in the block choice', () => {
    const p = deletePrompt(lines(), [0]);
    expect(p.askBlock).toBe(true);
    expect(p.blockSketches).toEqual(['Floor plan']);
    expect(p.lineSketches).toEqual([]);
  });
  it('a plain line still deletes without asking', () => {
    const l = lines();
    l[2].checked = null;
    expect(deletePrompt(l, [2])).toBeNull();
  });
});
