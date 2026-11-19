/**
 * deleted-ink.js — the ink of deleted transcript lines and the `textless`
 * stroke flag (v3.20.0, spec A.2 / A.3). No stroke is ever removed.
 */
import { describe, it, expect } from 'vitest';
import {
  INK_TEXTLESS, INK_RETRY, normalizeDeletedInk, withTextless, settleDeletedInk, lineHasInk, relinkAfterEdit, linkedLineIds
} from '../deleted-ink.js';

const s = (id, lineId = null, extra = {}) => ({ id, startTime: 1, lineId, points: [[0, 0]], ...extra });

describe('normalizeDeletedInk', () => {
  it('defaults to Not text; only retry is retry', () => {
    expect(normalizeDeletedInk(undefined)).toBe(INK_TEXTLESS);
    expect(normalizeDeletedInk('nonsense')).toBe(INK_TEXTLESS);
    expect(normalizeDeletedInk(INK_RETRY)).toBe(INK_RETRY);
  });
});

describe('withTextless', () => {
  it('setting it drops the line link', () => {
    expect(withTextless(s('s1', 'L1'), true)).toEqual({ ...s('s1'), textless: true, lineId: null });
  });

  it('clearing it removes the key (absent, never false) and keeps the stroke unlinked', () => {
    const out = withTextless(s('s1', null, { textless: true }), false);
    expect('textless' in out).toBe(false);
    expect(out.lineId).toBeNull();
  });

  it('returns the same object when nothing changes', () => {
    const a = s('s1', null, { textless: true });
    const b = s('s2');
    expect(withTextless(a, true)).toBe(a);
    expect(withTextless(b, false)).toBe(b);
  });
});

describe('settleDeletedInk', () => {
  const strokes = () => [s('s1', 'DEL'), s('s2', 'KEEP'), s('s3'), s('s4')];

  it('Not text: the deleted line\'s strokes and the listed unsaved ink are flagged; others untouched', () => {
    const r = settleDeletedInk(strokes(), { lineIds: ['DEL'], strokeIds: ['s3'], mode: INK_TEXTLESS });
    expect(r.textless).toEqual(['s1', 's3']);
    expect(r.strokes[0]).toMatchObject({ textless: true, lineId: null });
    expect(r.strokes[1]).toEqual(s('s2', 'KEEP'));
    expect(r.strokes[2]).toMatchObject({ textless: true });
    expect('textless' in r.strokes[3]).toBe(false);
    expect(r.strokes).toHaveLength(4);
  });

  it('Transcribe again: only unlinked, never flagged', () => {
    const r = settleDeletedInk(strokes(), { lineIds: ['DEL'], strokeIds: ['s3'], mode: INK_RETRY });
    expect(r.textless).toEqual([]);
    expect(r.unlinked).toEqual(['s1', 's3']);
    expect(r.strokes[0]).toEqual(s('s1'));
    expect(r.strokes.some((x) => x.textless)).toBe(false);
  });

  it('a stroke id listed as unsaved ink but linked to a kept line is never touched', () => {
    const r = settleDeletedInk(strokes(), { strokeIds: ['s2'], mode: INK_TEXTLESS });
    expect(r.strokes[1]).toEqual(s('s2', 'KEEP'));
  });

  it('empty input', () => {
    expect(settleDeletedInk([], {})).toEqual({ strokes: [], textless: [], unlinked: [] });
    expect(settleDeletedInk(null)).toEqual({ strokes: [], textless: [], unlinked: [] });
  });
});

describe('relinkAfterEdit', () => {
  const strokes = () => [s('s1', 'DEL'), s('s2', 'MERGED'), s('s3', 'KEEP'), s('s4', 'GONE_BEFORE')];
  const liveIds = new Set(['KEEP', 'SURV']);
  const remap = new Map([['MERGED', 'SURV']]);

  it('merged-away ink follows the survivor, deleted ink is flagged, other dead links dropped', () => {
    const r = relinkAfterEdit(strokes(), { liveIds, remap, deletedLineIds: ['DEL', 'MERGED', 'KEEP'], deletedInk: INK_TEXTLESS });
    expect(r.strokes.map((x) => [x.lineId, !!x.textless])).toEqual([
      [null, true], ['SURV', false], ['KEEP', false], [null, false]
    ]);
    expect(r.textless).toEqual(['s1']);
    // Merged ink is relinked, not unlinked; the old dangling link is unlinked too (the canvas copy follows).
    expect(r.unlinked).toEqual(['s4']);
  });

  it('reports the strokes it only unlinked, for the canvas copies', () => {
    const r = relinkAfterEdit(strokes(), { liveIds, remap, deletedLineIds: ['DEL'], deletedInk: INK_RETRY });
    expect(r.unlinked).toEqual(['s1', 's4']);
    expect(r.textless).toEqual([]);
  });

  it('without the Not text choice (Claude\'s edits pass none) it only unlinks, as before', () => {
    const r = relinkAfterEdit(strokes(), { liveIds, remap, deletedLineIds: ['DEL'] });
    expect(r.strokes.some((x) => x.textless)).toBe(false);
    expect(r.strokes[0].lineId).toBeNull();
    expect(r.textless).toEqual([]);
  });
});

describe('lineHasInk', () => {
  it('a saved line, or a line of the run with bounds, has ink; a typed line has none', () => {
    expect(lineHasInk({ blockUuid: 'L1' })).toBe(true);
    expect(lineHasInk({ fromBatch: true, yBounds: { minY: 1, maxY: 5 } })).toBe(true);
    expect(lineHasInk({ fromBatch: true, yBounds: { minY: 0, maxY: 0 } })).toBe(false);
    expect(lineHasInk({ fromBatch: false, yBounds: { minY: 1, maxY: 5 } })).toBe(false);
    expect(lineHasInk({})).toBe(false);
    expect(lineHasInk(null)).toBe(false);
  });
});

describe('linkedLineIds', () => {
  it('the lines with ink linked to them', () => {
    expect([...linkedLineIds([s('a', 'L1'), s('b', 'L1'), s('c'), s('d', 'L2')])]).toEqual(['L1', 'L2']);
    expect(linkedLineIds(null).size).toBe(0);
  });
});
