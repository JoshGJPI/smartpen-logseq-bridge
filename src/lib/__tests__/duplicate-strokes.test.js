/**
 * Strokes sharing an id on one page (v3.18.0): the pure plan / apply in
 * lib/storage/duplicate-strokes.js, the save-path guard in savePageToFolder,
 * and main's per-page count in extractCaptureDays (read through the timeline
 * entry shape, since main.cjs isn't importable here).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../storage/local-store.js', () => ({
  getPage: vi.fn(),
  savePage: vi.fn(),
  deletePage: vi.fn(),
}));

vi.mock('$stores/pending-changes.js', () => ({
  noteOnDiskStrokeIds: vi.fn(),
}));

import { getPage, savePage } from '../storage/local-store.js';
import { savePageToFolder } from '../storage/save-page.js';
import {
  sameInk, countDuplicateStrokes, shiftStoredStroke, planDuplicateCleanup,
  applyDuplicateCleanup, cleanPageDoc
} from '../storage/duplicate-strokes.js';

/** Stored stroke; points are [x, y, ts, f]. */
function stored(startTime, pts, extra = {}) {
  const points = pts.map(([x, y], i) => [x, y, startTime + i * 20, 100 + i]);
  return { id: `s${startTime}`, startTime, endTime: startTime + (pts.length - 1) * 20,
    lineId: null, ...extra, points };
}

// The B1211/P20 pair (2026-11-11): same start, different ink.
const A = stored(1000, [[36.8, 71.37], [36.79, 71.48], [36.18, 71.96]]);
const B = stored(1000, [[36.36, 71.95], [36.34, 71.98]]);

describe('sameInk', () => {
  it('is true for an exact copy and false for different points or end time', () => {
    expect(sameInk(A, structuredClone(A))).toBe(true);
    expect(sameInk(A, B)).toBe(false);
    expect(sameInk(A, { ...structuredClone(A), endTime: A.endTime + 1 })).toBe(false);
    expect(sameInk(A, null)).toBe(false);
  });
});

describe('countDuplicateStrokes', () => {
  it('counts copies beyond the first per id', () => {
    expect(countDuplicateStrokes([])).toBe(0);
    expect(countDuplicateStrokes(null)).toBe(0);
    expect(countDuplicateStrokes([A, stored(2000, [[1, 1]])])).toBe(0);
    expect(countDuplicateStrokes([A, B, structuredClone(A)])).toBe(2);
  });
});

describe('shiftStoredStroke', () => {
  it('moves id, start, end and numeric point timestamps; keeps force, nulls, lineId, sketch', () => {
    const s = { ...stored(1000, [[1, 2], [3, 4]], { lineId: 'L1', sketch: true }) };
    s.points[1][2] = null;
    const out = shiftStoredStroke(s, 3);
    expect(out.id).toBe('s1003');
    expect(out.startTime).toBe(1003);
    expect(out.endTime).toBe(s.endTime + 3);
    expect(out.points).toEqual([[1, 2, 1003, 100], [3, 4, null, 101]]);
    expect(out.lineId).toBe('L1');
    expect(out.sketch).toBe(true);
    expect(s.id).toBe('s1000'); // input untouched
  });
});

describe('planDuplicateCleanup / applyDuplicateCleanup', () => {
  it('plans nothing for a clean page', () => {
    expect(planDuplicateCleanup([A, stored(2000, [[1, 1]])])).toEqual([]);
    expect(planDuplicateCleanup(undefined)).toEqual([]);
  });

  it('removes an exact copy and keeps the first', () => {
    const strokes = [A, structuredClone(A)];
    const plan = planDuplicateCleanup(strokes);
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ index: 1, action: 'remove', exact: true });
    const r = applyDuplicateCleanup(strokes, plan);
    expect(r.strokes).toEqual([A]);
    expect(r).toMatchObject({ removed: 1, reIded: 0, skipped: 0 });
  });

  it('keeps a different stroke under the next free millisecond', () => {
    const taken = stored(1001, [[5, 5]]);
    const strokes = [A, B, taken];
    const plan = planDuplicateCleanup(strokes);
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ index: 1, action: 'reid', exact: false, newId: 's1002' });
    const r = applyDuplicateCleanup(strokes, plan);
    expect(r.strokes.map((s) => s.id)).toEqual(['s1000', 's1001', 's1002']);
    expect(r.strokes[0]).toBe(A);
    expect(r.strokes[2].points.map((p) => [p[0], p[1]])).toEqual(B.points.map((p) => [p[0], p[1]]));
    expect(countDuplicateStrokes(r.strokes)).toBe(0);
  });

  it('removes a different stroke when the caller chooses to', () => {
    const plan = planDuplicateCleanup([A, B]).map((c) => ({ ...c, action: 'remove' }));
    const r = applyDuplicateCleanup([A, B], plan);
    expect(r.strokes).toEqual([A]);
    expect(r.removed).toBe(1);
  });

  it('gives three copies distinct ids', () => {
    const C = stored(1000, [[9, 9], [8, 8]]);
    const r = applyDuplicateCleanup([A, B, C], planDuplicateCleanup([A, B, C]));
    expect(r.strokes.map((s) => s.id)).toEqual(['s1000', 's1001', 's1002']);
  });

  it('skips a copy whose stroke changed since the plan', () => {
    const plan = planDuplicateCleanup([A, B]);
    const r = applyDuplicateCleanup([A, stored(1500, [[1, 1]])], plan);
    expect(r).toMatchObject({ removed: 0, reIded: 0, skipped: 1 });
  });
});

describe('cleanPageDoc', () => {
  it('updates totalStrokes, bounds and lastUpdated, and returns the input when clean', () => {
    const doc = { version: '2.0', metadata: { totalStrokes: 2, lastUpdated: 'old' }, strokes: [A, structuredClone(A)] };
    const r = cleanPageDoc(doc, null, 'now');
    expect(r.doc.metadata.totalStrokes).toBe(1);
    expect(r.doc.metadata.lastUpdated).toBe('now');
    expect(r.doc.metadata.bounds).toBeTruthy();
    const again = cleanPageDoc(r.doc);
    expect(again.doc).toBe(r.doc);
  });
});

describe('savePageToFolder never writes two strokes under one id', () => {
  const PAGE_INFO = { section: 3, owner: 1012, book: 1211, page: 20 };
  const canvas = (startTime, dots) => ({
    pageInfo: PAGE_INFO, startTime, endTime: startTime + 100,
    dotArray: dots.map(([x, y], i) => ({ x, y, f: 200, timestamp: startTime + i })),
  });
  const writtenDoc = () => savePage.mock.calls[0][2];

  beforeEach(() => {
    getPage.mockReset();
    savePage.mockReset();
    savePage.mockResolvedValue({ path: '/tmp/P20.json' });
  });

  it('keeps two different new strokes with one start time as two ids', async () => {
    getPage.mockResolvedValue(null);
    const result = await savePageToFolder({
      book: '1211', page: 20,
      activeStrokes: [canvas(5000, [[1, 1], [2, 2]]), canvas(5000, [[3, 3], [4, 4]])],
    });
    expect(result.success).toBe(true);
    expect(result.reIded).toBe(1);
    expect(writtenDoc().strokes.map((s) => s.id)).toEqual(['s5000', 's5001']);
    expect(writtenDoc().strokes[1].points[0]).toEqual([3, 3, 5001, 200]);
  });

  it('drops an exact second copy', async () => {
    getPage.mockResolvedValue(null);
    const result = await savePageToFolder({
      book: '1211', page: 20,
      activeStrokes: [canvas(5000, [[1, 1]]), canvas(5000, [[1, 1]])],
    });
    expect(result.added).toBe(1);
    expect(result.reIded).toBe(0);
    expect(writtenDoc().strokes).toHaveLength(1);
  });

  it('never re-times a canvas stroke whose id is already on disk', async () => {
    getPage.mockResolvedValue({
      version: '2.0', pageInfo: PAGE_INFO, metadata: {},
      transcript: { lastTranscribed: null, lines: [] },
      strokes: [stored(5000, [[1, 1], [2, 2]])],
    });
    const result = await savePageToFolder({
      book: '1211', page: 20, activeStrokes: [canvas(5000, [[3, 3], [4, 4]])],
    });
    expect(result.added).toBe(0);
    expect(result.reIded).toBe(0);
    expect(writtenDoc().strokes).toHaveLength(1);
  });
});
