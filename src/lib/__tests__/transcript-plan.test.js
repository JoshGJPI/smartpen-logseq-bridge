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
import { savePageToFolder, planTranscript, carryTaskState } from '../storage/save-page.js';
import { yBoundsToNcode } from '../myscript-api.js';
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

  it('moved lines (v3.17.0) are written in the new order; a parent left below is worked out again', () => {
    // 3017/180: the 11/6 meeting, stored last, moved to the top.
    const saved = [
      line('A', '11/10/26'), line('B', 'NSSA', { indentLevel: 1, parentId: 'A' }),
      line('M', 'Meeting w/ Joe H'), line('N', 'not worth it', { indentLevel: 1, parentId: 'M' }),
      line('X', 'stray', { indentLevel: 1, parentId: 'A' })
    ];
    const plan = planTranscript(saved, editor([
      { text: 'Meeting w/ Joe H', blockUuid: 'M', indentLevel: 0 },
      { text: 'not worth it', blockUuid: 'N', indentLevel: 1 },
      { text: 'stray', blockUuid: 'X', indentLevel: 1 },
      { text: '11/10/26', blockUuid: 'A', indentLevel: 0 },
      { text: 'NSSA', blockUuid: 'B', indentLevel: 1 }
    ], ['A', 'B', 'M', 'N', 'X']));
    expect(plan.changed).toBe(true);
    expect(plan.lines.map((l) => [l.id, l.parentId])).toEqual([['M', null], ['N', 'M'], ['X', 'M'], ['A', null], ['B', 'A']]);
    expect(plan.lines[1]).toBe(saved[3]); // its parent is still above it: untouched
  });

  it('a task merged under a plain saved line keeps its state (WAITING too)', () => {
    const saved = [line('L1', 'Smith'), line('L2', 'geotech report', { checked: false, marker: 'WAITING' })];
    // The dialog's merged line carries the task part's state (editor-lines.js mergeEditorLines).
    const plan = planTranscript(saved, editor([
      { text: 'Smith geotech report', blockUuid: 'L1', checked: false, marker: 'WAITING' }
    ], ['L1', 'L2'], [{ deletedBlockUuid: 'L2', survivingBlockUuid: 'L1' }]));
    expect(plan.lines).toHaveLength(1);
    expect(plan.lines[0]).toMatchObject({ id: 'L1', text: 'Smith geotech report', checked: false, marker: 'WAITING' });
  });

  it('a saved task merged into a new MyScript line keeps its state', () => {
    const saved = [line('L2', 'call city', { checked: true, marker: 'CANCELLED' })];
    const plan = planTranscript(saved, editor([
      { text: 'call city about permit', checked: true, marker: 'CANCELLED', yBounds: { minY: 1, maxY: 9 } }
    ], ['L2']));
    expect(plan.lines.map((l) => [l.text, l.checked, l.marker])).toEqual([['call city about permit', true, 'CANCELLED']]);
  });

  it('a saved task keeps its own state on disk over the dialog copy', () => {
    // Ticked DONE while the dialog was open on the TODO copy.
    const plan = planTranscript([line('L1', 'call Troy', { checked: true })],
      editor([{ text: 'call Troy today', blockUuid: 'L1', checked: false }], ['L1']));
    expect(plan.lines[0]).toMatchObject({ text: 'call Troy today', checked: true });
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

describe('re-transcribing a reset page (replace, v3.17.0)', () => {
  // 3017/182: one saved line held 479 strokes and the lines below none. The
  // re-transcription has to replace the old lines and take their strokes.
  const yb = { minY: 10, maxY: 15 };
  const mid = (() => { const r = yBoundsToNcode(yb, 0); return (r.minY + r.maxY) / 2; })();
  const stroke = (t, lineId) => ({ id: `s${t}`, startTime: t, endTime: t + 100, lineId, points: [[1, mid], [2, mid + 0.2]] });

  it('replaces the saved lines, relinks their strokes and carries task state by text', async () => {
    const saved = [
      line('OLD1', 'Large Gym'),
      line('OLD2', 'call Joe', { checked: false, marker: 'WAITING' }),
      line('OLD3', 'Typical, A-Block, H-Block')
    ];
    const { onDisk, after } = await saveThenAsk(pageDoc(saved, [stroke(1000, 'OLD1'), stroke(2000, 'OLD3')]), {
      replace: true, originNcodeY: 0,
      lines: [
        { text: 'Large Gym', indentLevel: 0, yBounds: yb },
        { text: '☐ call Joe', indentLevel: 1, yBounds: { minY: 40, maxY: 45 } }
      ]
    });
    const [gym, call] = onDisk.transcript.lines;
    expect(onDisk.transcript.lines).toHaveLength(2);
    expect(gym.id).not.toMatch(/^OLD/);
    expect(call).toMatchObject({ text: 'call Joe', checked: false, marker: 'WAITING' });
    expect(onDisk.strokes.map((s) => s.lineId)).toEqual([gym.id, gym.id]);
    expect(after.transcriptionChanged).toBe(false);
  });

  it('same text as saved: lines and ids kept, but every stroke relinked from the run (a drawing unlinked)', async () => {
    const saved = [line('L1', 'Large Gym'), line('L2', 'Arching was ignored')];
    const far = { id: 's3000', startTime: 3000, endTime: 3100, lineId: 'L1', points: [[1, 900], [2, 901]] };
    const { onDisk, after } = await saveThenAsk(pageDoc(saved, [stroke(1000, 'L2'), far]), {
      replace: true, originNcodeY: 0,
      lines: [{ text: 'Large Gym', indentLevel: 0, yBounds: yb }, { text: 'Arching was ignored', indentLevel: 0, yBounds: { minY: 40, maxY: 45 } }]
    });
    expect(onDisk.transcript.lines.map((l) => l.id)).toEqual(['L1', 'L2']);
    expect(onDisk.strokes.map((s) => [s.id, s.lineId])).toEqual([['s1000', 'L1'], ['s3000', null]]);
    expect(after.transcriptionChanged).toBe(false);
  });

  it('without replace the same run is appended, as before', () => {
    const plan = planTranscript([line('OLD1', 'Large Gym', { yBounds: yb })], { lines: [{ text: 'Arching was ignored', yBounds: { minY: 40, maxY: 45 } }] });
    expect(plan.lines.map((l) => l.text)).toEqual(['Large Gym', 'Arching was ignored']);
  });

  it('the dialog path drops saved lines whose ids it was given', () => {
    const plan = planTranscript([line('OLD1', 'Large Gym'), line('OLD2', 'done thing', { checked: true })], {
      replace: true, editorBaseIds: ['OLD1', 'OLD2'],
      lines: [{ text: 'Large Gym', indentLevel: 0, yBounds: yb }, { text: 'done thing', indentLevel: 0, yBounds: yb }]
    });
    expect(plan.lines.map((l) => [l.text, l.checked])).toEqual([['Large Gym', null], ['done thing', true]]);
    expect(plan.lines.every((l) => !l.id.startsWith('OLD'))).toBe(true);
  });
});

describe('carryTaskState', () => {
  const old = [line('A', 'call Joe', { checked: false, marker: 'WAITING' }), line('B', 'send RFI', { checked: true, marker: 'CANCELLED' })];
  it('a new line with no box takes the old state; one box agreeing on open/closed keeps the marker', () => {
    const out = carryTaskState(old, [line('n1', 'Call joe'), line('n2', 'send RFI', { checked: true })]);
    expect(out.map((l) => [l.checked, l.marker])).toEqual([[false, 'WAITING'], [true, 'CANCELLED']]);
  });
  it('a box that disagrees wins; kept old lines and unmatched text carry nothing', () => {
    const out = carryTaskState(old, [line('n1', 'call Joe', { checked: true }), line('B', 'send RFI', { checked: true }), line('n3', 'other')]);
    expect(out[0]).toMatchObject({ checked: true });
    expect(out[0].marker).toBeUndefined();
    expect(out[2].checked).toBeNull();
    expect(carryTaskState([], out)).toBe(out);
  });
});
