/**
 * Tests for storage/save-page.js — pressure and sketch-flag persistence.
 *
 * The transcript-merge half of this module predates these tests; what is covered
 * here is the stroke half, and specifically the two things that had to change for
 * sketch strokes:
 *
 *   - strokeToStored writes per-point pen force as a 4th tuple element, with a
 *     null timestamp placeholder so force keeps a fixed index.
 *   - savePageToFolder syncs the sketch flag onto strokes that are ALREADY on
 *     disk. The append-only rule means points are never rewritten, but `sketch`
 *     is an annotation the user toggles long after capture, so a save has to
 *     carry it through in both directions.
 *
 * getPage / savePage and the pending-changes store are mocked so no Electron
 * storage backend is needed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Path is resolved relative to THIS file, not to save-page.js — it has to land on
// the same module id that save-page.js's `./local-store.js` resolves to.
vi.mock('../storage/local-store.js', () => ({
  getPage: vi.fn(),
  savePage: vi.fn(),
}));

vi.mock('$stores/pending-changes.js', () => ({
  noteOnDiskStrokeIds: vi.fn(),
}));

import { getPage, savePage } from '../storage/local-store.js';
import { strokeToStored, savePageToFolder } from '../storage/save-page.js';

const PAGE_INFO = { section: 3, owner: 1012, book: 3017, page: 42 };

/** Canvas-format stroke: dotArray of {x, y, f, timestamp}. */
function canvasStroke(startTime, dots, extra = {}) {
  return {
    pageInfo: PAGE_INFO,
    startTime,
    endTime: startTime + 100,
    dotArray: dots.map(([x, y, f], i) => ({ x, y, f, timestamp: startTime + i })),
    ...extra,
  };
}

describe('strokeToStored', () => {
  it('writes force as the 4th point element alongside the timestamp', () => {
    const stored = strokeToStored(canvasStroke(1000, [[1, 2, 300], [3, 4, 700]]));
    expect(stored.points).toEqual([
      [1, 2, 1000, 300],
      [3, 4, 1001, 700],
    ]);
  });

  it('rounds coordinates to 2dp and force to an integer', () => {
    const stroke = canvasStroke(1000, [[1.23456, 2.98765, 417.62]]);
    expect(strokeToStored(stroke).points[0]).toEqual([1.23, 2.99, 1000, 418]);
  });

  it('uses a null timestamp placeholder so force keeps a fixed index', () => {
    const stroke = canvasStroke(1000, [[1, 2, 300]]);
    delete stroke.dotArray[0].timestamp;
    // Without the placeholder, force would land in slot 2 and read back as a
    // timestamp on the next load.
    expect(strokeToStored(stroke).points[0]).toEqual([1, 2, null, 300]);
  });

  it('emits a 3-element tuple when a dot has no usable force', () => {
    const stroke = canvasStroke(1000, [[1, 2, 300], [3, 4, undefined], [5, 6, null]]);
    const { points } = strokeToStored(stroke);
    expect(points[0]).toHaveLength(4);
    // Absent force must not coerce to 0 — that renders as a hairline.
    expect(points[1]).toEqual([3, 4, 1001]);
    expect(points[2]).toEqual([5, 6, 1002]);
  });

  it('keeps a genuine zero force', () => {
    const stored = strokeToStored(canvasStroke(1000, [[1, 2, 0]]));
    expect(stored.points[0]).toEqual([1, 2, 1000, 0]);
  });

  it('omits the sketch key for ordinary strokes and sets it for sketches', () => {
    expect(strokeToStored(canvasStroke(1000, [[1, 2, 300]]))).not.toHaveProperty('sketch');
    expect(strokeToStored(canvasStroke(1000, [[1, 2, 300]], { sketch: true })).sketch).toBe(true);
  });

  it('orders keys so points stay last in the serialized line', () => {
    const stored = strokeToStored(canvasStroke(1000, [[1, 2, 300]], { sketch: true }));
    expect(Object.keys(stored)).toEqual(['id', 'startTime', 'endTime', 'lineId', 'sketch', 'points']);
  });

  it('handles a stroke with no dots', () => {
    expect(strokeToStored({ startTime: 1000, endTime: 1001, dotArray: [] }).points).toEqual([]);
  });
});

describe('savePageToFolder — sketch flag round-trip', () => {
  /** Grab the PageDoc handed to savePage by the call under test. */
  const writtenDoc = () => savePage.mock.calls[0][2];

  beforeEach(() => {
    getPage.mockReset();
    savePage.mockReset();
    savePage.mockResolvedValue({ path: '/tmp/P42.json' });
  });

  it('persists the flag on a brand-new sketch stroke', async () => {
    getPage.mockResolvedValue(null);

    const result = await savePageToFolder({
      book: 3017,
      page: 42,
      activeStrokes: [canvasStroke(1000, [[1, 2, 300]], { sketch: true })],
    });

    expect(result.success).toBe(true);
    expect(writtenDoc().strokes[0].sketch).toBe(true);
  });

  it('marks a stroke already on disk when the canvas copy is flagged', async () => {
    // The interesting case: the stroke is not an addition, so the append branch
    // never touches it — only the metadata sync does.
    getPage.mockResolvedValue({
      version: '2.0',
      pageInfo: PAGE_INFO,
      metadata: { lastUpdated: 'x', totalStrokes: 1, bounds: {} },
      transcript: { lastTranscribed: null, lines: [] },
      strokes: [{ id: 's1000', startTime: 1000, endTime: 1100, lineId: null, points: [[1, 2, 1000, 300]] }],
    });

    const result = await savePageToFolder({
      book: 3017,
      page: 42,
      activeStrokes: [canvasStroke(1000, [[1, 2, 300]], { sketch: true })],
    });

    expect(result.added).toBe(0);
    expect(writtenDoc().strokes[0].sketch).toBe(true);
  });

  it('unmarks a stroke, removing the key rather than writing sketch: false', async () => {
    getPage.mockResolvedValue({
      version: '2.0',
      pageInfo: PAGE_INFO,
      metadata: { lastUpdated: 'x', totalStrokes: 1, bounds: {} },
      transcript: { lastTranscribed: null, lines: [] },
      strokes: [{ id: 's1000', startTime: 1000, endTime: 1100, lineId: null, sketch: true, points: [[1, 2, 1000, 300]] }],
    });

    await savePageToFolder({
      book: 3017,
      page: 42,
      activeStrokes: [canvasStroke(1000, [[1, 2, 300]])],
    });

    expect(writtenDoc().strokes[0]).not.toHaveProperty('sketch');
  });

  it('leaves the flag alone on disk strokes the canvas no longer holds', async () => {
    // Missing from the canvas is not a change — same principle as deletions.
    getPage.mockResolvedValue({
      version: '2.0',
      pageInfo: PAGE_INFO,
      metadata: { lastUpdated: 'x', totalStrokes: 1, bounds: {} },
      transcript: { lastTranscribed: null, lines: [] },
      strokes: [{ id: 's999', startTime: 999, endTime: 1000, lineId: null, sketch: true, points: [[9, 9, 999, 300]] }],
    });

    await savePageToFolder({
      book: 3017,
      page: 42,
      activeStrokes: [canvasStroke(1000, [[1, 2, 300]])],
    });

    const kept = writtenDoc().strokes.find((s) => s.id === 's999');
    expect(kept.sketch).toBe(true);
  });

  it('does not rewrite the points of a stroke already on disk', async () => {
    // Append-only: captured geometry is immutable even if the canvas copy has
    // drifted (e.g. legacy load injected a constant force).
    const onDisk = { id: 's1000', startTime: 1000, endTime: 1100, lineId: null, points: [[1, 2, 1000, 300]] };
    getPage.mockResolvedValue({
      version: '2.0',
      pageInfo: PAGE_INFO,
      metadata: { lastUpdated: 'x', totalStrokes: 1, bounds: {} },
      transcript: { lastTranscribed: null, lines: [] },
      strokes: [onDisk],
    });

    await savePageToFolder({
      book: 3017,
      page: 42,
      activeStrokes: [canvasStroke(1000, [[7, 8, 999]], { sketch: true })],
    });

    expect(writtenDoc().strokes[0].points).toEqual([[1, 2, 1000, 300]]);
  });

  it('preserves lineId sync alongside the new sketch sync', async () => {
    getPage.mockResolvedValue({
      version: '2.0',
      pageInfo: PAGE_INFO,
      metadata: { lastUpdated: 'x', totalStrokes: 1, bounds: {} },
      transcript: { lastTranscribed: null, lines: [{ id: 'line-1', text: 'hi', indentLevel: 0, parentId: null, checked: null, yBounds: null }] },
      strokes: [{ id: 's1000', startTime: 1000, endTime: 1100, lineId: null, points: [[1, 2, 1000, 300]] }],
    });

    await savePageToFolder({
      book: 3017,
      page: 42,
      activeStrokes: [canvasStroke(1000, [[1, 2, 300]], { sketch: true, blockUuid: 'line-1' })],
    });

    expect(writtenDoc().strokes[0].lineId).toBe('line-1');
    expect(writtenDoc().strokes[0].sketch).toBe(true);
  });
});

describe('savePageToFolder — point edits (the one geometry rewrite)', () => {
  const writtenDoc = () => savePage.mock.calls[0][2];

  /** PageDoc holding one 3-point stroke. */
  function docWithThreePoints(extra = {}) {
    return {
      version: '2.0',
      pageInfo: PAGE_INFO,
      metadata: { lastUpdated: 'x', totalStrokes: 1, bounds: {} },
      transcript: { lastTranscribed: null, lines: [] },
      strokes: [{
        id: 's1000',
        startTime: 1000,
        endTime: 1100,
        lineId: null,
        points: [[1, 2, 1000, 300], [0, 0, 1001, 0], [3, 4, 1002, 700]],
        ...extra,
      }],
    };
  }

  beforeEach(() => {
    getPage.mockReset();
    savePage.mockReset();
    savePage.mockResolvedValue({ path: '/tmp/P42.json' });
  });

  it('rewrites the stored points when the canvas stroke is marked pointsEdited', async () => {
    getPage.mockResolvedValue(docWithThreePoints());

    // The stray (0, 0) point is gone from the canvas copy.
    const result = await savePageToFolder({
      book: 3017,
      page: 42,
      activeStrokes: [canvasStroke(1000, [[1, 2, 300], [3, 4, 700]], { pointsEdited: true })],
    });

    expect(result.edited).toBe(1);
    expect(result.added).toBe(0);
    expect(writtenDoc().strokes[0].points).toEqual([[1, 2, 1000, 300], [3, 4, 1001, 700]]);
  });

  it('refuses the rewrite without the marker, however different the points are', async () => {
    // The whole point of gating on explicit intent: a truncated dotArray from any
    // other code path must not be able to destroy stored geometry.
    getPage.mockResolvedValue(docWithThreePoints());

    const result = await savePageToFolder({
      book: 3017,
      page: 42,
      activeStrokes: [canvasStroke(1000, [[9, 9, 111]])],
    });

    expect(result.edited).toBe(0);
    expect(writtenDoc().strokes[0].points).toHaveLength(3);
  });

  it('keeps the stroke id, startTime and endTime after removing the first point', async () => {
    // Identity must survive: `s{startTime}` is what dedupe, transcript links and
    // the LogSeq asset merge all key on.
    getPage.mockResolvedValue(docWithThreePoints());

    await savePageToFolder({
      book: 3017,
      page: 42,
      activeStrokes: [canvasStroke(1000, [[3, 4, 700]], { pointsEdited: true })],
    });

    const saved = writtenDoc().strokes[0];
    expect(saved.id).toBe('s1000');
    expect(saved.startTime).toBe(1000);
    expect(saved.endTime).toBe(1100);
    expect(writtenDoc().strokes).toHaveLength(1); // not re-added as a duplicate
  });

  it('keeps per-point force and the sketch flag through the rewrite', async () => {
    // A sketch stroke must still taper after an edit, which needs the 4th tuple
    // element on every surviving point.
    getPage.mockResolvedValue(docWithThreePoints({ sketch: true }));

    await savePageToFolder({
      book: 3017,
      page: 42,
      activeStrokes: [canvasStroke(1000, [[1, 2, 300], [3, 4, 700]], { sketch: true, pointsEdited: true })],
    });

    const saved = writtenDoc().strokes[0];
    expect(saved.sketch).toBe(true);
    expect(saved.points.map((p) => p[3])).toEqual([300, 700]);
  });

  it('never writes the pointsEdited marker into the PageDoc', async () => {
    getPage.mockResolvedValue(docWithThreePoints());

    await savePageToFolder({
      book: 3017,
      page: 42,
      activeStrokes: [canvasStroke(1000, [[1, 2, 300], [3, 4, 700]], { pointsEdited: true })],
    });

    expect(writtenDoc().strokes[0]).not.toHaveProperty('pointsEdited');
  });

  it('leaves points untouched on the OTHER strokes of an edited page', async () => {
    getPage.mockResolvedValue({
      version: '2.0',
      pageInfo: PAGE_INFO,
      metadata: { lastUpdated: 'x', totalStrokes: 2, bounds: {} },
      transcript: { lastTranscribed: null, lines: [] },
      strokes: [
        { id: 's1000', startTime: 1000, endTime: 1100, lineId: null, points: [[1, 2, 1000, 300], [0, 0, 1001, 0]] },
        { id: 's2000', startTime: 2000, endTime: 2100, lineId: null, points: [[5, 6, 2000, 400], [7, 8, 2001, 500]] },
      ],
    });

    const result = await savePageToFolder({
      book: 3017,
      page: 42,
      activeStrokes: [
        canvasStroke(1000, [[1, 2, 300], [9, 9, 900]], { pointsEdited: true }),
        canvasStroke(2000, [[0, 0, 0]]), // drifted, but unmarked
      ],
    });

    expect(result.edited).toBe(1);
    const byId = new Map(writtenDoc().strokes.map((s) => [s.id, s]));
    expect(byId.get('s1000').points).toHaveLength(2);
    expect(byId.get('s2000').points).toEqual([[5, 6, 2000, 400], [7, 8, 2001, 500]]);
  });

  it('recomputes page bounds from the edited geometry', async () => {
    // The reason the whole feature exists: a stray origin point stretches the
    // page's bounding box to the corner, and removing it must shrink it back.
    getPage.mockResolvedValue(docWithThreePoints());

    await savePageToFolder({
      book: 3017,
      page: 42,
      activeStrokes: [canvasStroke(1000, [[1, 2, 300], [3, 4, 700]], { pointsEdited: true })],
    });

    expect(writtenDoc().metadata.bounds).toEqual({ minX: 1, maxX: 3, minY: 2, maxY: 4 });
  });

  it('keeps points in their original key position so the serialized line is stable', async () => {
    getPage.mockResolvedValue(docWithThreePoints());

    await savePageToFolder({
      book: 3017,
      page: 42,
      activeStrokes: [canvasStroke(1000, [[1, 2, 300], [3, 4, 700]], { pointsEdited: true })],
    });

    expect(Object.keys(writtenDoc().strokes[0]))
      .toEqual(['id', 'startTime', 'endTime', 'lineId', 'points']);
  });

  it('reports edited: 0 when the marked stroke is new rather than stored', async () => {
    // A freshly drawn stroke that was point-edited before its first save is an
    // addition; the append branch writes its geometry anyway.
    getPage.mockResolvedValue(null);

    const result = await savePageToFolder({
      book: 3017,
      page: 42,
      activeStrokes: [canvasStroke(1000, [[1, 2, 300], [3, 4, 700]], { pointsEdited: true })],
    });

    expect(result.added).toBe(1);
    expect(result.edited).toBe(0);
    expect(writtenDoc().strokes[0].points).toHaveLength(2);
  });
});
