/**
 * Tests for save-page.js planTranscript() and the save dialog's use of it
 * (page-changes.js): a saved transcript must stop counting as a change, and a
 * transcript confirmed in the Edit Transcription dialog updates saved lines in
 * place rather than appending copies.
 *
 * getPage / savePage and the pending-changes store are mocked so no Electron
 * storage backend is needed.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../storage/local-store.js', () => ({ getPage: vi.fn(), savePage: vi.fn(), deletePage: vi.fn() }));
vi.mock('$stores/pending-changes.js', () => ({ noteOnDiskStrokeIds: vi.fn() }));

import { getPage, savePage } from '../storage/local-store.js';
import { savePageToFolder, planTranscript } from '../storage/save-page.js';
import { computePageChangesFolder } from '../storage/page-changes.js';

const PAGE_INFO = { section: 3, owner: 1012, book: 3017, page: 42 };

const canvasStroke = (t) => ({
  pageInfo: PAGE_INFO, startTime: t, endTime: t + 100,
  dotArray: [{ x: 1, y: 1, f: 300, timestamp: t }, { x: 2, y: 2, f: 300, timestamp: t + 1 }]
});

const line = (id, text, extra = {}) =>
  ({ id, text, indentLevel: 0, parentId: null, checked: null, yBounds: { minY: 1, maxY: 5 }, ...extra });

function pageDoc(lines, strokes = []) {
  return {
    version: '2.0', pageInfo: { ...PAGE_INFO }, metadata: {},
    transcript: { lastTranscribed: '2026-10-01T00:00:00Z', lines },
    strokes
  };
}

/** Save, then ask the save dialog about the same page and transcription. */
async function saveThenAsk(doc, transcription) {
  let onDisk = doc;
  getPage.mockImplementation(async () => onDisk);
  savePage.mockImplementation(async (b, p, next) => { onDisk = next; return { success: true }; });
  const result = await savePageToFolder({
    book: '3017', page: 42, activeStrokes: [canvasStroke(1000)], deletedStrokeIds: new Set(), pageTranscription: transcription
  });
  const after = await computePageChangesFolder('3017', 42, [canvasStroke(1000)], transcription);
  return { result, onDisk, after };
}

describe('a saved transcript stops counting as a change', () => {
  it('task boxes: the file holds the parsed line, the dialog no longer says changed', async () => {
    const { result, onDisk, after } = await saveThenAsk(pageDoc([]), { lines: [
      { text: 'P2026-141 Smith', indentLevel: 0, yBounds: { minY: 1, maxY: 5 } },
      { text: '☐ call contractor', indentLevel: 1, yBounds: { minY: 8, maxY: 12 } }
    ] });
    expect(result.transcriptChanged).toBe(true);
    expect(onDisk.transcript.lines.map((l) => [l.text, l.checked])).toEqual([['P2026-141 Smith', null], ['call contractor', false]]);
    expect(after).toMatchObject({ hasNewTranscription: false, transcriptionChanged: false });
  });

  it('a partial transcription onto a transcribed page', async () => {
    const { onDisk, after } = await saveThenAsk(pageDoc([line('L1', 'old line')]), { lines: [
      { text: 'new line', indentLevel: 0, yBounds: { minY: 8, maxY: 12 } }
    ] });
    expect(onDisk.transcript.lines.map((l) => l.text)).toEqual(['old line', 'new line']);
    expect(after.transcriptionChanged).toBe(false);
  });

  it('before the save, the dialog still reports new and changed transcripts', async () => {
    getPage.mockResolvedValueOnce(pageDoc([]));
    const fresh = await computePageChangesFolder('3017', 42, [], { lines: [{ text: 'hello', yBounds: { minY: 1, maxY: 5 } }] });
    expect(fresh).toMatchObject({ hasNewTranscription: true, transcriptionChanged: false });
    getPage.mockResolvedValueOnce(pageDoc([line('L1', 'hello')]));
    const more = await computePageChangesFolder('3017', 42, [], { lines: [{ text: 'world', yBounds: { minY: 8, maxY: 12 } }] });
    expect(more).toMatchObject({ hasNewTranscription: false, transcriptionChanged: true });
  });
});

describe('planTranscript: the Edit Transcription result', () => {
  const editor = (lines, editorBaseIds, mergedBlockPairs = []) => ({ lines, editorBaseIds, mergedBlockPairs });

  it('edits a saved line in place (no copy appended), keeping its id and task state', () => {
    const saved = [line('L1', 'chek beam', { checked: false }), line('L2', 'other')];
    const plan = planTranscript(saved, editor([
      { text: 'check beam', blockUuid: 'L1', indentLevel: 0 },
      { text: 'other', blockUuid: 'L2', indentLevel: 0 }
    ], ['L1', 'L2']));
    expect(plan.changed).toBe(true);
    expect(plan.linesAdded).toBe(0);
    expect(plan.lines.map((l) => [l.id, l.text, l.checked])).toEqual([['L1', 'check beam', false], ['L2', 'other', null]]);
    expect(plan.lines[1]).toBe(saved[1]); // untouched lines are the same objects
  });

  it('is unchanged when nothing was edited', () => {
    const saved = [line('L1', 'a'), line('L2', 'b')];
    const plan = planTranscript(saved, editor([
      { text: 'a', blockUuid: 'L1' }, { text: 'b', blockUuid: 'L2' }
    ], ['L1', 'L2']));
    expect(plan.changed).toBe(false);
  });

  it('a merge removes the merged-away line and hands its strokes to the survivor', () => {
    const saved = [line('L1', 'check the'), line('L2', 'beam')];
    const plan = planTranscript(saved, editor([
      { text: 'check the beam', blockUuid: 'L1' }
    ], ['L1', 'L2'], [{ deletedBlockUuid: 'L2', survivingBlockUuid: 'L1' }]));
    expect(plan.lines.map((l) => [l.id, l.text])).toEqual([['L1', 'check the beam']]);
    expect(plan.lineIdRemap.get('L2')).toBe('L1');
  });

  it('an emptied saved line is removed', () => {
    const plan = planTranscript([line('L1', 'a'), line('L2', 'b')], editor([
      { text: 'a', blockUuid: 'L1' }, { text: '   ', blockUuid: 'L2' }
    ], ['L1', 'L2']));
    expect(plan.lines.map((l) => l.id)).toEqual(['L1']);
  });

  it('an indent change re-derives parentId; new lines get ids and parse task boxes', () => {
    const plan = planTranscript([line('L1', 'Smith'), line('L2', 'beam')], editor([
      { text: 'Smith', blockUuid: 'L1', indentLevel: 0 },
      { text: 'beam', blockUuid: 'L2', indentLevel: 1 },
      { text: '☐ call', indentLevel: 1, yBounds: { minY: 8, maxY: 12 } }
    ], ['L1', 'L2']));
    const [a, b, c] = plan.lines;
    expect(b).toMatchObject({ id: 'L2', indentLevel: 1, parentId: 'L1' });
    expect(c).toMatchObject({ text: 'call', checked: false, indentLevel: 1, parentId: 'L1' });
    expect(c.id).not.toMatch(/^L/);
    expect(a.parentId).toBeNull();
    expect(plan.linesAdded).toBe(1);
  });

  it('a box typed onto a plain saved line makes it a task', () => {
    const plan = planTranscript([line('L1', 'call Troy')], editor([{ text: '☐ call Troy', blockUuid: 'L1' }], ['L1']));
    expect(plan.lines[0]).toMatchObject({ id: 'L1', text: 'call Troy', checked: false });
  });

  it('keeps saved lines the dialog never saw, and is idempotent when saved again', () => {
    const result = editor([{ text: 'a', blockUuid: 'L1' }, { text: 'fresh', yBounds: { minY: 8, maxY: 12 } }], ['L1']);
    const first = planTranscript([line('L1', 'a'), line('L9', 'written meanwhile', { yBounds: { minY: 20, maxY: 24 } })], result);
    expect(first.lines.map((l) => l.text)).toEqual(['a', 'fresh', 'written meanwhile']);
    const again = planTranscript(first.lines, result);
    expect(again.changed).toBe(false);
  });

  it('the save writes the edit in place and remaps stroke lineIds from a merge', async () => {
    const strokes = [
      { id: 's1000', startTime: 1000, endTime: 1100, lineId: 'L2', points: [[1, 1], [2, 2]] }
    ];
    const { onDisk, after } = await saveThenAsk(pageDoc([line('L1', 'check the'), line('L2', 'beam')], strokes), editor(
      [{ text: 'check the beam', blockUuid: 'L1' }], ['L1', 'L2'], [{ deletedBlockUuid: 'L2', survivingBlockUuid: 'L1' }]
    ));
    expect(onDisk.transcript.lines.map((l) => [l.id, l.text])).toEqual([['L1', 'check the beam']]);
    expect(onDisk.strokes.find((s) => s.id === 's1000').lineId).toBe('L1');
    expect(after.transcriptionChanged).toBe(false);
  });
});
