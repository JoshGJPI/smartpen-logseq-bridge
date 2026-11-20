/**
 * Tests for storage/save-page.js — pressure, sketch-flag persistence, and the
 * transcript merge's stroke→line matching.
 *
 * The stroke half covers the two things that had to change for sketch strokes:
 *
 *   - strokeToStored writes per-point pen force as a 4th tuple element, with a
 *     null timestamp placeholder so force keeps a fixed index.
 *   - savePageToFolder syncs the sketch flag onto strokes that are ALREADY on
 *     disk. The append-only rule means points are never rewritten, but `sketch`
 *     is an annotation the user toggles long after capture, so a save has to
 *     carry it through in both directions.
 *
 * The transcript half covers the coordinate-space fix: a line's yBounds are
 * MyScript millimetres measured from the batch's own origin, stroke points are
 * raw Ncode, and until Aug 2026 the two were compared as if they were the same
 * number.
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
  deletePage: vi.fn(),
}));

vi.mock('$stores/pending-changes.js', () => ({
  noteOnDiskStrokeIds: vi.fn(),
}));

import { getPage, savePage, deletePage } from '../storage/local-store.js';
import {
  strokeToStored, savePageToFolder, planPageMove, finalizePageMoves, transcriptionOriginY, sentStrokeIds
} from '../storage/save-page.js';
import { NCODE_TO_MM, MYSCRIPT_INK_ORIGIN_MM } from '../myscript-api.js';

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

/* ==================================================================
 *  Volumes
 * ================================================================== */

/* -----------------------------------------------------------------
 *  Transcript merge — Ncode vs MyScript millimetres
 * ----------------------------------------------------------------- */

/**
 * The millimetre yBounds MyScript would report for ink spanning `minY`..`maxY`
 * in Ncode, given a batch anchored at `originY`. The forward direction of
 * yBoundsToNcode, so the tests state the fixture in the space the pen writes in
 * and let the constants do the rest.
 */
function mmBounds(minY, maxY, originY) {
  return {
    minY: (minY - originY) * NCODE_TO_MM + MYSCRIPT_INK_ORIGIN_MM,
    maxY: (maxY - originY) * NCODE_TO_MM + MYSCRIPT_INK_ORIGIN_MM,
  };
}

/** A stroke drawn as a vertical tick from Ncode y=minY to y=maxY. */
function strokeAtY(startTime, minY, maxY) {
  return canvasStroke(startTime, [[10, minY, 400], [10.5, maxY, 400]]);
}

/** StoredStroke shape, for the functions that read off disk. */
function storedAtY(startTime, minY, maxY) {
  return {
    id: `s${startTime}`,
    startTime,
    endTime: startTime + 100,
    lineId: null,
    points: [[10, minY, startTime, 400], [10.5, maxY, startTime + 1, 400]],
  };
}

describe('transcriptionOriginY', () => {
  const strokes = [storedAtY(1000, 40, 43), storedAtY(2000, 60, 63)];

  it('prefers the origin recorded at recognition time', () => {
    // setPageTranscription measures it with the sent strokes in hand. Trusting
    // that over a re-measurement is what keeps the anchor stable when one of
    // those strokes is later deleted or point-edited.
    const t = { originNcodeY: 60, transcribedStrokeIds: ['1000'] };
    expect(transcriptionOriginY(t, strokes)).toBe(60);
  });

  it('re-measures from the ids when no origin was recorded', () => {
    // Entries from before the field existed, and any built by another path.
    expect(transcriptionOriginY({ originNcodeY: null, transcribedStrokeIds: ['2000'] }, strokes)).toBe(60);
    expect(transcriptionOriginY({ originNcodeY: Infinity, transcribedStrokeIds: ['2000'] }, strokes)).toBe(60);
  });

  it('falls back to the whole page when the transcription lists no strokes', () => {
    expect(transcriptionOriginY(null, strokes)).toBe(40);
    expect(transcriptionOriginY({ lines: [] }, strokes)).toBe(40);
    expect(transcriptionOriginY({ transcribedStrokeIds: [] }, strokes)).toBe(40);
  });

  it('anchors to the strokes that were actually sent, not the page', () => {
    // The case the page bounds get wrong: only the lower block was re-sent, so
    // the batch starts 20 units down the page.
    expect(transcriptionOriginY({ transcribedStrokeIds: ['2000'] }, strokes)).toBe(60);
  });

  it('accepts the bare startTime ids setPageTranscription records, and s-prefixed ones', () => {
    expect(transcriptionOriginY({ transcribedStrokeIds: [2000] }, strokes)).toBe(60);
    expect(transcriptionOriginY({ transcribedStrokeIds: ['s2000'] }, strokes)).toBe(60);
  });

  it('falls back to the page when none of the listed strokes survive', () => {
    // Deleted between recognition and save — better a whole-page guess than none.
    expect(transcriptionOriginY({ transcribedStrokeIds: ['9999'] }, strokes)).toBe(40);
  });

  it('ignores strokes with no points and reports Infinity when there are none', () => {
    expect(transcriptionOriginY(null, [{ id: 's1', points: [] }, storedAtY(1000, 40, 43)])).toBe(40);
    expect(transcriptionOriginY(null, [])).toBe(Infinity);
    expect(transcriptionOriginY(null, null)).toBe(Infinity);
  });
});

describe('savePageToFolder — stroke→line matching across coordinate spaces', () => {
  const writtenDoc = () => savePage.mock.calls[0][2];
  const strokeById = (id) => writtenDoc().strokes.find((s) => s.id === id);

  beforeEach(() => {
    getPage.mockReset();
    getPage.mockResolvedValue(null);
    savePage.mockReset();
    savePage.mockResolvedValue({ path: '/tmp/P42.json' });
  });

  it('converts a line yBounds from millimetres before matching strokes', async () => {
    // Two lines of writing 10 Ncode units apart, i.e. where a real page has
    // them. Compared raw, the millimetre values (1.6-8.8 and 25.4-32.5) miss
    // both strokes entirely and nothing gets linked.
    const strokes = [strokeAtY(1000, 40, 43), strokeAtY(2000, 50, 53)];
    await savePageToFolder({
      book: 3017,
      page: 42,
      activeStrokes: strokes,
      pageTranscription: {
        lines: [
          { text: 'top line', yBounds: mmBounds(40, 43, 40) },
          { text: 'lower line', yBounds: mmBounds(50, 53, 40) },
        ],
      },
    });

    const [top, lower] = writtenDoc().transcript.lines;
    expect(strokeById('s1000').lineId).toBe(top.id);
    expect(strokeById('s2000').lineId).toBe(lower.id);
  });

  it('honours the recorded batch origin over the strokes still on the page', async () => {
    // The stroke that anchored the batch has since been deleted; without the
    // recorded value the anchor would slide up to the remaining stroke and take
    // every line with it.
    await savePageToFolder({
      book: 3017,
      page: 42,
      activeStrokes: [strokeAtY(2000, 60, 63)],
      pageTranscription: {
        originNcodeY: 50,
        transcribedStrokeIds: ['1000', '2000'],
        lines: [{ text: 'the new block', yBounds: mmBounds(60, 63, 50) }],
      },
    });

    const [line] = writtenDoc().transcript.lines;
    expect(strokeById('s2000').lineId).toBe(line.id);
  });

  it('anchors the conversion to the strokes that were sent, not the page bounds', async () => {
    // The partial re-transcription case: only the second block was untranscribed,
    // so MyScript measured from y=60. Anchoring at the page's own minY (40)
    // would slide the line up 20 units and link the wrong block.
    await savePageToFolder({
      book: 3017,
      page: 42,
      activeStrokes: [strokeAtY(1000, 40, 43), strokeAtY(2000, 60, 63)],
      pageTranscription: {
        transcribedStrokeIds: ['2000'],
        lines: [{ text: 'the new block', yBounds: mmBounds(60, 63, 60) }],
      },
    });

    const [line] = writtenDoc().transcript.lines;
    expect(strokeById('s2000').lineId).toBe(line.id);
    expect(strokeById('s1000').lineId).toBeNull();
  });

  it('gives a stroke touching two lines to the one it overlaps most', async () => {
    // A tall stroke (a bracket, a long descender) reaching from line 1 well into
    // line 2's band. Taking the last line to be considered would hand it to
    // line 2 on nothing more than iteration order.
    await savePageToFolder({
      book: 3017,
      page: 42,
      activeStrokes: [strokeAtY(1000, 40, 46.5)],
      pageTranscription: {
        lines: [
          { text: 'first', yBounds: mmBounds(40, 46, 40) },
          { text: 'second', yBounds: mmBounds(46, 49, 40) },
        ],
      },
    });

    const [first] = writtenDoc().transcript.lines;
    expect(strokeById('s1000').lineId).toBe(first.id);
  });

  it('reaches a little past the line box, but not to the next line', async () => {
    // MyScript's word boxes wrap the text core; a descender or a dropped comma
    // sits just outside it and still belongs to the line.
    await savePageToFolder({
      book: 3017,
      page: 42,
      activeStrokes: [strokeAtY(1000, 40, 43), strokeAtY(2000, 43.5, 44), strokeAtY(3000, 46, 46.5)],
      pageTranscription: {
        lines: [{ text: 'one line', yBounds: mmBounds(40, 43, 40) }],
      },
    });

    const [line] = writtenDoc().transcript.lines;
    expect(strokeById('s2000').lineId).toBe(line.id);
    expect(strokeById('s3000').lineId).toBeNull();
  });

  it('links nothing for a line MyScript gave no usable bounds', async () => {
    // 0/0 is parseMyScriptResponse's "no word matched" marker, not the top of
    // the page — linking every stroke near the origin to it would be worse than
    // leaving the line unlinked.
    await savePageToFolder({
      book: 3017,
      page: 42,
      activeStrokes: [strokeAtY(1000, 40, 43)],
      pageTranscription: {
        lines: [
          { text: 'unplaced', yBounds: { minY: 0, maxY: 0 } },
          { text: 'no bounds at all' },
        ],
      },
    });

    expect(strokeById('s1000').lineId).toBeNull();
    expect(writtenDoc().transcript.lines).toHaveLength(2);
  });

  it('leaves a stroke that already belongs to a line alone', async () => {
    getPage.mockResolvedValue({
      version: '2.0',
      pageInfo: PAGE_INFO,
      metadata: { lastUpdated: 'x', totalStrokes: 1, bounds: {} },
      transcript: {
        lastTranscribed: 'x',
        lines: [{ id: 'existing-line', text: 'from before', indentLevel: 0, parentId: null, checked: null, yBounds: { minY: 1, maxY: 8 } }],
      },
      strokes: [{ ...storedAtY(1000, 40, 43), lineId: 'existing-line' }],
    });

    await savePageToFolder({
      book: 3017,
      page: 42,
      activeStrokes: [strokeAtY(2000, 60, 63)],
      pageTranscription: {
        transcribedStrokeIds: ['2000'],
        // Deliberately wide enough to reach both strokes once converted.
        lines: [{ text: 'the new block', yBounds: mmBounds(38, 65, 60) }],
      },
    });

    expect(strokeById('s1000').lineId).toBe('existing-line');
    expect(strokeById('s2000').lineId).toBe(writtenDoc().transcript.lines[1].id);
  });

  it('matches a page sent rotated in the upright frame, without rewriting its points', async () => {
    // Written with the notebook turned: each "line" is a column running down
    // the page. Shown at 270° (lib/page-orientation.js, NOMINAL_FRAME 66 wide)
    // upright y = 66 - x, so the column at x=40 is the top line (y 26) and the
    // one at x=20 the next (y 46). The batch was sent turned, origin y 26.
    const strokes = [
      canvasStroke(1000, [[20, 30, 400], [20, 60, 400]]),
      canvasStroke(2000, [[40, 30, 400], [40, 60, 400]]),
    ];
    await savePageToFolder({
      book: 3017,
      page: 42,
      activeStrokes: strokes,
      pageTranscription: {
        rotation: 270,
        originNcodeY: 26,
        lines: [
          { text: 'top line', yBounds: mmBounds(25.5, 26.5, 26) },
          { text: 'next line', yBounds: mmBounds(45.5, 46.5, 26) },
        ],
      },
    });

    const [top, next] = writtenDoc().transcript.lines;
    expect(strokeById('s2000').lineId).toBe(top.id);
    expect(strokeById('s1000').lineId).toBe(next.id);
    // Stored geometry is the page's, untouched.
    expect(strokeById('s1000').points.map((p) => p.slice(0, 2))).toEqual([[20, 30], [20, 60]]);
  });
});

describe('savePageToFolder — task boxes become TODO / DONE', () => {
  const writtenLines = () => savePage.mock.calls[0][2].transcript.lines;
  const existingDoc = (lines) => ({
    version: '2.0',
    pageInfo: PAGE_INFO,
    metadata: { lastUpdated: 'x', totalStrokes: 1, bounds: {} },
    transcript: { lastTranscribed: 'x', lines },
    strokes: [storedAtY(1000, 40, 43)],
  });
  const oldLine = (id, text, checked = null) => ({
    id, text, indentLevel: 0, parentId: null, checked, yBounds: mmBounds(40, 43, 40),
  });

  beforeEach(() => {
    getPage.mockReset();
    getPage.mockResolvedValue(null);
    savePage.mockReset();
    savePage.mockResolvedValue({ path: '/tmp/P42.json' });
  });

  const transcribe = (lines, activeStrokes = [strokeAtY(1000, 40, 43)]) =>
    savePageToFolder({ book: 3017, page: 42, activeStrokes, pageTranscription: { originNcodeY: 40, lines } });

  it('stores a drawn box as TODO and a ticked one as DONE, without the glyph', async () => {
    await transcribe([
      { text: 'Coordination call', yBounds: mmBounds(40, 43, 40) },
      { text: '☐ Call Troy', yBounds: mmBounds(50, 53, 40) },
      { text: '☑ Check on PO', yBounds: mmBounds(60, 63, 40) },
    ]);
    expect(writtenLines().map((l) => [l.text, l.checked])).toEqual([
      ['Coordination call', null],
      ['Call Troy', false],
      ['Check on PO', true],
    ]);
  });

  it('leaves a bare tick as text', async () => {
    await transcribe([{ text: '✓ Looks fine', yBounds: mmBounds(40, 43, 40) }]);
    expect(writtenLines()[0]).toMatchObject({ text: '✓ Looks fine', checked: null });
  });

  it('does not duplicate an old line that still holds its glyph as text', async () => {
    getPage.mockResolvedValue(existingDoc([oldLine('old', '☐ Call Troy')]));
    await transcribe([{ text: '☐ Call Troy', yBounds: mmBounds(40, 43, 40) }]);
    expect(writtenLines()).toHaveLength(1);
    expect(writtenLines()[0].id).toBe('old');
  });

  it('does not duplicate when the new reading has a box the old line lacked', async () => {
    getPage.mockResolvedValue(existingDoc([oldLine('old', 'Call Troy')]));
    await transcribe([{ text: '☐ Call Troy', yBounds: mmBounds(40, 43, 40) }]);
    expect(writtenLines()).toHaveLength(1);
  });

  it("keeps an existing line's state through re-transcription", async () => {
    // Ticked DONE after the ink was read as an empty box: the re-reading still
    // says ☐, and the line must not go back to TODO.
    getPage.mockResolvedValue(existingDoc([oldLine('old', 'Call Troy', true)]));
    await transcribe([{ text: '☐ Call Troy', yBounds: mmBounds(40, 43, 40) }]);
    expect(writtenLines()).toEqual([expect.objectContaining({ id: 'old', text: 'Call Troy', checked: true })]);
  });

  it('keeps a WAITING marker on an existing line, and never sets one on a new line', async () => {
    getPage.mockResolvedValue(existingDoc([{ ...oldLine('old', 'Vault confirmation', false), marker: 'WAITING' }]));
    await transcribe([
      { text: '☐ Vault confirmation', yBounds: mmBounds(40, 43, 40) },
      { text: '☐ WAITING on the PO', yBounds: mmBounds(60, 63, 40) },
    ]);
    const [old, added] = writtenLines();
    expect(old).toMatchObject({ id: 'old', checked: false, marker: 'WAITING' });
    expect(added).toMatchObject({ text: 'WAITING on the PO', checked: false });
    expect(added).not.toHaveProperty('marker');
  });
});

describe('savePageToFolder — volume book keys', () => {
  const writtenDoc = () => savePage.mock.calls[0][2];

  beforeEach(() => {
    vi.clearAllMocks();
    savePage.mockReset();
    savePage.mockResolvedValue({ path: '/tmp/P42.json' });
  });

  // The whole reason existing files stay byte-identical: `volume` is omitted
  // when 1, so validatePageDoc's `typeof book === 'number'` still holds and no
  // pre-volume page changes shape.
  it('writes a plain numeric book with no volume key for volume 1', async () => {
    getPage.mockResolvedValue(null);
    await savePageToFolder({
      book: '3017', page: 42,
      activeStrokes: [canvasStroke(1000, [[1, 2, 300], [3, 4, 400]])],
    });

    const pi = writtenDoc().pageInfo;
    expect(pi.book).toBe(3017);
    expect(typeof pi.book).toBe('number');
    expect('volume' in pi).toBe(false);
  });

  it('splits a volume key into a numeric book plus a volume field', async () => {
    getPage.mockResolvedValue(null);
    await savePageToFolder({
      book: '3017v2', page: 42,
      activeStrokes: [canvasStroke(1000, [[1, 2, 300], [3, 4, 400]])],
    });

    const pi = writtenDoc().pageInfo;
    expect(pi.book).toBe(3017);
    expect(pi.volume).toBe(2);
    expect(pi.page).toBe(42);
  });

  it('reads and writes the volume page through the book key, not the number', async () => {
    getPage.mockResolvedValue(null);
    await savePageToFolder({
      book: '3017v2', page: 42,
      activeStrokes: [canvasStroke(1000, [[1, 2, 300], [3, 4, 400]])],
    });

    expect(getPage).toHaveBeenCalledWith('3017v2', 42);
    expect(savePage.mock.calls[0][0]).toBe('3017v2');
  });

  it('still accepts a bare numeric book from pre-volume call sites', async () => {
    getPage.mockResolvedValue(null);
    await savePageToFolder({
      book: 3017, page: 42,
      activeStrokes: [canvasStroke(1000, [[1, 2, 300], [3, 4, 400]])],
    });
    expect(writtenDoc().pageInfo.book).toBe(3017);
    expect('volume' in writtenDoc().pageInfo).toBe(false);
  });
});

describe('planPageMove', () => {
  // Transcript lines live in doc.transcript.lines, not on strokes, so moving
  // every stroke off a page strands the recognised text with nothing linking it.
  it('carries the transcript when the source empties into a single target', () => {
    expect(planPageMove({ strokeCount: 0, lineCount: 5 }, { lineCount: 0 }, 1))
      .toEqual({ carryTranscript: true, deleteSource: true });
  });

  it('leaves the transcript when strokes remain on the source', () => {
    expect(planPageMove({ strokeCount: 3, lineCount: 5 }, { lineCount: 0 }, 1))
      .toEqual({ carryTranscript: false, deleteSource: false });
  });

  // Real recognised text on the target; the source's claim to it is no stronger.
  it('never overwrites a transcript the target already has', () => {
    expect(planPageMove({ strokeCount: 0, lineCount: 5 }, { lineCount: 2 }, 1))
      .toEqual({ carryTranscript: false, deleteSource: false });
  });

  // Splitting a transcript across two volumes by guesswork is worse than
  // leaving it where it is.
  it('leaves the transcript when the strokes split across two targets', () => {
    expect(planPageMove({ strokeCount: 0, lineCount: 5 }, { lineCount: 0 }, 2))
      .toEqual({ carryTranscript: false, deleteSource: false });
  });

  it('deletes an emptied source that had no transcript to begin with', () => {
    expect(planPageMove({ strokeCount: 0, lineCount: 0 }, { lineCount: 0 }, 1))
      .toEqual({ carryTranscript: false, deleteSource: true });
  });

  it('handles missing state objects', () => {
    expect(planPageMove(null, null, 1)).toEqual({ carryTranscript: false, deleteSource: true });
  });
});

describe('finalizePageMoves', () => {
  const doc = (strokes, lines) => ({
    version: '2.0',
    pageInfo: { section: 3, owner: 1012, book: 3017, page: 42 },
    metadata: { lastUpdated: '2026-01-01T00:00:00.000Z' },
    transcript: { lastTranscribed: null, lines },
    strokes,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    savePage.mockResolvedValue({ path: '/tmp/x.json' });
    deletePage.mockResolvedValue(true);
  });

  it('does nothing when there are no moves', async () => {
    const out = await finalizePageMoves([]);
    expect(out).toEqual({ transcriptsMoved: 0, pagesDeleted: 0, errors: [], emptied: [] });
    expect(getPage).not.toHaveBeenCalled();
  });

  it('moves the transcript and removes the emptied source file', async () => {
    getPage.mockImplementation(async (book) =>
      book === '3017' ? doc([], [{ id: 'l1', text: 'notes' }]) : doc([{ id: 's1' }], [])
    );

    const out = await finalizePageMoves([
      { fromBook: '3017', fromPage: 42, toBook: '3017v2', toPage: 42 }
    ]);

    expect(out.transcriptsMoved).toBe(1);
    expect(out.pagesDeleted).toBe(1);
    expect(savePage).toHaveBeenCalledWith('3017v2', 42, expect.objectContaining({
      transcript: { lastTranscribed: null, lines: [{ id: 'l1', text: 'notes' }] }
    }));
    expect(deletePage).toHaveBeenCalledWith('3017', 42);
  });

  it('leaves a partially-moved source alone', async () => {
    getPage.mockImplementation(async (book) =>
      book === '3017' ? doc([{ id: 's1' }], [{ id: 'l1', text: 'notes' }]) : doc([], [])
    );

    const out = await finalizePageMoves([
      { fromBook: '3017', fromPage: 42, toBook: '3017v2', toPage: 42 }
    ]);

    expect(out.transcriptsMoved).toBe(0);
    expect(out.pagesDeleted).toBe(0);
    expect(savePage).not.toHaveBeenCalled();
    expect(deletePage).not.toHaveBeenCalled();
  });

  it('processes each source page once even with many moved strokes', async () => {
    getPage.mockResolvedValue(doc([], []));
    await finalizePageMoves([
      { fromBook: '3017', fromPage: 42, toBook: '3017v2', toPage: 42 },
      { fromBook: '3017', fromPage: 42, toBook: '3017v2', toPage: 42 },
    ]);
    expect(deletePage).toHaveBeenCalledTimes(1);
  });

  // Best-effort: the strokes are already safe on disk by this point, so a
  // cleanup failure must not fail a save that already succeeded.
  it('collects errors rather than throwing', async () => {
    getPage.mockRejectedValue(new Error('disk gone'));
    const out = await finalizePageMoves([
      { fromBook: '3017', fromPage: 42, toBook: '3017v2', toPage: 42 }
    ]);
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0]).toContain('disk gone');
  });

  it('skips a source page that no longer exists', async () => {
    getPage.mockResolvedValue(null);
    const out = await finalizePageMoves([
      { fromBook: '3017', fromPage: 42, toBook: '3017v2', toPage: 42 }
    ]);
    expect(out).toEqual({ transcriptsMoved: 0, pagesDeleted: 0, errors: [], emptied: [] });
  });

  // Page tags live in _tags.json, so the whole-page moves are reported for
  // stores/tags.js to carry them (v3.1.0).
  it('reports whole-page moves (source emptied, one target) for the tag carry', async () => {
    getPage.mockImplementation(async (book) => (book === '3017' ? doc([], []) : doc([{ id: 's1' }], [])));
    const out = await finalizePageMoves([{ fromBook: '3017', fromPage: 42, toBook: '3017v2', toPage: 42 }]);
    expect(out.emptied).toEqual([{ fromBook: '3017', fromPage: 42, toBook: '3017v2', toPage: 42 }]);
  });

  it('a partial move or a split source is not reported', async () => {
    getPage.mockImplementation(async (book) => (book === '3017' ? doc([{ id: 's9' }], []) : doc([], [])));
    expect((await finalizePageMoves([{ fromBook: '3017', fromPage: 42, toBook: '3017v2', toPage: 42 }])).emptied).toEqual([]);

    getPage.mockResolvedValue(doc([], []));
    const split = await finalizePageMoves([
      { fromBook: '3017', fromPage: 42, toBook: '3017v2', toPage: 42 },
      { fromBook: '3017', fromPage: 42, toBook: '3017v3', toPage: 42 }
    ]);
    expect(split.emptied).toEqual([]);
  });
});

describe('savePageToFolder — a retimed stroke (v3.6.0)', () => {
  const writtenDoc = () => savePage.mock.calls[0][2];

  beforeEach(() => {
    getPage.mockReset();
    savePage.mockReset();
    savePage.mockResolvedValue({ path: '/tmp/P42.json' });
  });

  // The save the Editor does after a retime: the old id in the deletion set,
  // the canvas stroke at its new time. One stroke on disk, at the new time.
  it('replaces the stored copy instead of keeping one at each time', async () => {
    getPage.mockResolvedValue({
      version: '2.0',
      pageInfo: PAGE_INFO,
      metadata: { lastUpdated: 'x', totalStrokes: 2, bounds: {} },
      transcript: { lastTranscribed: null, lines: [{ id: 'L1', text: 'beam', indentLevel: 0, parentId: null }] },
      strokes: [
        { id: 's1000', startTime: 1000, endTime: 1100, lineId: 'L1', sketch: true, points: [[1, 2, 1000, 300]] },
        { id: 's5000', startTime: 5000, endTime: 5100, lineId: null, points: [[3, 4, 5000, 300]] }
      ],
    });

    const retimed = canvasStroke(9000, [[1, 2, 300]], { sketch: true, blockUuid: 'L1', retimedFrom: { id: 's1000' } });
    const result = await savePageToFolder({
      book: 3017,
      page: 42,
      activeStrokes: [retimed],
      deletedStrokeIds: new Set(['s1000']),
    });

    expect(result.success).toBe(true);
    const ids = writtenDoc().strokes.map((st) => st.id);
    expect(ids).toEqual(['s5000', 's9000']);           // re-sorted by time
    const moved = writtenDoc().strokes[1];
    expect(moved.startTime).toBe(9000);
    expect(moved.points[0]).toEqual([1, 2, 9000, 300]);
    expect(moved.lineId).toBe('L1');
    expect(moved.sketch).toBe(true);
    expect('retimedFrom' in moved).toBe(false);        // in-memory marker never reaches disk
  });
});

describe('textless ("Not text", v3.20.0)', () => {
  const writtenDoc = () => savePage.mock.calls[0][2];
  const strokeById = (id) => writtenDoc().strokes.find((s) => s.id === id);
  const doc = (strokes, lines = []) => ({
    version: '2.0', pageInfo: PAGE_INFO, metadata: { lastUpdated: 'x', totalStrokes: strokes.length, bounds: {} },
    transcript: { lastTranscribed: '2026-11-01T00:00:00.000Z', lines }, strokes
  });
  const textLine = (id, text, extra = {}) => ({ id, text, indentLevel: 0, parentId: null, checked: null, yBounds: null, ...extra });

  beforeEach(() => {
    getPage.mockReset();
    savePage.mockReset();
    savePage.mockResolvedValue({ path: '/tmp/P42.json' });
  });

  it('strokeToStored writes it only when true, and a textless stroke is in no line', () => {
    const on = strokeToStored(canvasStroke(1000, [[1, 2, 300]], { textless: true, blockUuid: 'L1' }));
    expect(on.textless).toBe(true);
    expect(on.lineId).toBeNull();
    const off = strokeToStored(canvasStroke(1000, [[1, 2, 300]], { textless: false, blockUuid: 'L1' }));
    expect('textless' in off).toBe(false);
    expect(off.lineId).toBe('L1');
    // A fixed key list: an in-memory marker never reaches disk.
    expect(Object.keys(on)).toEqual(['id', 'startTime', 'endTime', 'lineId', 'textless', 'points']);
    // textlessFrom (the link kept for a quick Include) is in-memory only.
    const kept = strokeToStored(canvasStroke(1000, [[1, 2, 300]], { textless: true, textlessFrom: 'L1' }));
    expect('textlessFrom' in kept).toBe(false);
  });

  it('a canvas toggle syncs both ways; a canvas copy without the key leaves the disk alone', async () => {
    getPage.mockResolvedValue(doc([
      { ...storedAtY(1000, 40, 43), lineId: 'L1' },
      { ...storedAtY(2000, 50, 53), textless: true },
      { ...storedAtY(3000, 60, 63), textless: true },
    ], [textLine('L1', 'a')]));
    await savePageToFolder({
      book: 3017, page: 42,
      activeStrokes: [
        { ...strokeAtY(1000, 40, 43), blockUuid: 'L1', textless: true },  // left out: unlinked too
        { ...strokeAtY(2000, 50, 53), textless: false },                  // taken back in
        { ...strokeAtY(3000, 60, 63), blockUuid: 'L1' },                  // stale copy: no say, and no link
      ],
    });
    expect(strokeById('s1000')).toMatchObject({ textless: true, lineId: null });
    expect('textless' in strokeById('s2000')).toBe(false);
    expect(strokeById('s3000')).toMatchObject({ textless: true, lineId: null });
    expect(writtenDoc().strokes).toHaveLength(3);
  });

  it('a textless stroke is never matched to a new line of a transcription', async () => {
    getPage.mockResolvedValue(doc([{ ...storedAtY(1000, 40, 43), textless: true }, storedAtY(2000, 40, 43)]));
    await savePageToFolder({
      book: 3017, page: 42,
      activeStrokes: [strokeAtY(1000, 40, 43), strokeAtY(2000, 40, 43)],
      pageTranscription: { originNcodeY: 40, lines: [{ text: 'line', yBounds: mmBounds(40, 43, 40) }] },
    });
    const [line] = writtenDoc().transcript.lines;
    expect(strokeById('s2000').lineId).toBe(line.id);
    expect(strokeById('s1000')).toMatchObject({ textless: true, lineId: null });
  });

  describe('a line deleted in the Edit Transcription dialog', () => {
    const saved = () => doc(
      [{ ...storedAtY(1000, 40, 43), lineId: 'L1' }, { ...storedAtY(2000, 50, 53), lineId: 'L2' }, { ...storedAtY(2500, 50, 53), lineId: 'L2' }],
      [textLine('L1', 'keep'), textLine('L2', 'scribble')]
    );
    const canvas = () => [
      { ...strokeAtY(1000, 40, 43), blockUuid: 'L1' },
      { ...strokeAtY(2000, 50, 53), blockUuid: 'L2' },
      { ...strokeAtY(2500, 50, 53), blockUuid: 'L2' },
    ];
    const editorResult = (extra) => ({
      lines: [{ text: 'keep', blockUuid: 'L1', indentLevel: 0 }],
      editorBaseIds: ['L1', 'L2'], deletedLineIds: ['L2'], deletedLines: [], ...extra
    });

    it('is removed and its strokes are unlinked, kept, and flagged Not text (the default)', async () => {
      getPage.mockResolvedValue(saved());
      const result = await savePageToFolder({ book: 3017, page: 42, activeStrokes: canvas(), pageTranscription: editorResult({}) });
      expect(writtenDoc().transcript.lines.map((l) => l.id)).toEqual(['L1']);
      expect(writtenDoc().strokes).toHaveLength(3);
      expect(strokeById('s1000')).toMatchObject({ lineId: 'L1' });
      expect('textless' in strokeById('s1000')).toBe(false);
      expect(strokeById('s2000')).toMatchObject({ lineId: null, textless: true });
      expect(strokeById('s2500')).toMatchObject({ lineId: null, textless: true });
      expect(result.textlessIds.sort()).toEqual(['s2000', 's2500']);
      expect(result.unlinkedIds).toEqual([]);
      expect(result.deleted).toBe(0);
    });

    it('with Transcribe again, its strokes are unlinked and not flagged', async () => {
      getPage.mockResolvedValue(saved());
      const result = await savePageToFolder({
        book: 3017, page: 42, activeStrokes: canvas(), pageTranscription: editorResult({ deletedInk: 'retry' })
      });
      expect(writtenDoc().transcript.lines.map((l) => l.id)).toEqual(['L1']);
      expect(strokeById('s2000').lineId).toBeNull();
      expect(writtenDoc().strokes.some((s) => s.textless)).toBe(false);
      expect(result.textlessIds).toEqual([]);
      expect(result.unlinkedIds.sort()).toEqual(['s2000', 's2500']);
    });

    it('a line merged away (not deleted) hands its strokes to the survivor, never flagged', async () => {
      getPage.mockResolvedValue(saved());
      await savePageToFolder({
        book: 3017, page: 42, activeStrokes: canvas(),
        pageTranscription: editorResult({
          lines: [{ text: 'keep scribble', blockUuid: 'L1', indentLevel: 0 }], deletedLineIds: [],
          mergedBlockPairs: [{ deletedBlockUuid: 'L2', survivingBlockUuid: 'L1' }]
        })
      });
      expect(strokeById('s2000')).toMatchObject({ lineId: 'L1' });
      expect(writtenDoc().strokes.some((s) => s.textless)).toBe(false);
    });

    it('a line of the run not saved yet: the strokes it covered are flagged, the kept line still gets its own', async () => {
      getPage.mockResolvedValue(null);
      const result = await savePageToFolder({
        book: 3017, page: 42,
        activeStrokes: [strokeAtY(1000, 40, 43), strokeAtY(2000, 50, 53)],
        pageTranscription: {
          originNcodeY: 40,
          transcribedStrokeIds: ['1000', '2000'],
          lines: [{ text: 'top', yBounds: mmBounds(40, 43, 40), fromBatch: true }],
          editorBaseIds: [], deletedLineIds: [],
          deletedLines: [{ yBounds: mmBounds(50, 53, 40), fromBatch: true }],
        },
      });
      const [top] = writtenDoc().transcript.lines;
      expect(writtenDoc().transcript.lines).toHaveLength(1);
      expect(strokeById('s1000').lineId).toBe(top.id);
      expect(strokeById('s2000')).toMatchObject({ lineId: null, textless: true });
      expect(result.textlessIds).toEqual(['s2000']);
    });
  });
});

describe('QA fixes (v3.20.0): sent strokes only, stale canvas links', () => {
  const writtenDoc = () => savePage.mock.calls[0][2];
  const strokeById = (id) => writtenDoc().strokes.find((s) => s.id === id);
  const doc = (strokes, lines = []) => ({
    version: '2.0', pageInfo: PAGE_INFO, metadata: { lastUpdated: 'x', totalStrokes: strokes.length, bounds: {} },
    transcript: { lastTranscribed: '2026-11-01T00:00:00.000Z', lines }, strokes
  });
  const textLine = (id, text) => ({ id, text, indentLevel: 0, parentId: null, checked: null, yBounds: null });
  // A run that sent s2000 only; its line at y 50-53 was deleted in the dialog. s3000 sits in the same band
  // (a sketch beside it, or ink left out of a partial selection), s4000 too but linked to a saved line.
  const run = (extra) => ({
    originNcodeY: 40,
    lines: [{ text: 'keep', blockUuid: 'L1', indentLevel: 0 }],
    editorBaseIds: ['L1'], deletedLineIds: [],
    deletedLines: [{ yBounds: mmBounds(50, 53, 50), fromBatch: true }],
    ...extra,
  });
  const page = () => doc([
    { ...storedAtY(1000, 40, 43), lineId: 'L1' }, storedAtY(2000, 50, 53), storedAtY(3000, 50, 53),
    { ...storedAtY(4000, 50, 53), lineId: 'L1' },
  ], [textLine('L1', 'keep')]);
  const canvas = () => [
    { ...strokeAtY(1000, 40, 43), blockUuid: 'L1' }, strokeAtY(2000, 50, 53), strokeAtY(3000, 50, 53),
    { ...strokeAtY(4000, 50, 53), blockUuid: 'L1' },
  ];

  beforeEach(() => {
    getPage.mockReset();
    savePage.mockReset();
    savePage.mockResolvedValue({ path: '/tmp/P42.json' });
  });

  it('a deleted run line flags only the strokes that were in its batch', async () => {
    getPage.mockResolvedValue(page());
    const result = await savePageToFolder({
      book: 3017, page: 42, activeStrokes: canvas(),
      pageTranscription: run({ originNcodeY: 50, transcribedStrokeIds: ['2000'] }),
    });
    expect(strokeById('s2000')).toMatchObject({ textless: true, lineId: null });
    // In the band, not in the batch: neither flagged nor unlinked.
    expect('textless' in strokeById('s3000')).toBe(false);
    expect('textless' in strokeById('s4000')).toBe(false);
    expect(strokeById('s4000').lineId).toBe('L1');
    expect(result.textlessIds).toEqual(['s2000']);
    expect(result.unlinkedIds).toEqual([]);
  });

  it('with the batch unknown (an older in-memory result) its ink is only unlinked, never flagged', async () => {
    getPage.mockResolvedValue(page());
    const result = await savePageToFolder({
      book: 3017, page: 42, activeStrokes: canvas(), pageTranscription: run({ originNcodeY: 50 }),
    });
    expect(writtenDoc().strokes.some((s) => s.textless)).toBe(false);
    expect(result.textlessIds).toEqual([]);
    expect(strokeById('s4000').lineId).toBe('L1');
  });

  it('sentStrokeIds reads the in-memory ids in either form, else null', () => {
    expect([...sentStrokeIds({ transcribedStrokeIds: ['1000', 's2000'] })]).toEqual(['s1000', 's2000']);
    expect(sentStrokeIds({})).toBeNull();
    expect(sentStrokeIds(null)).toBeNull();
  });

  it('a stale canvas link to a line that is gone never replaces the live link on disk', async () => {
    // Library Edit merged line C into A: disk says A, the Editor's copy still says C.
    getPage.mockResolvedValue(doc([{ ...storedAtY(1000, 40, 43), lineId: 'A' }, storedAtY(2000, 50, 53)], [textLine('A', 'merged')]));
    await savePageToFolder({
      book: 3017, page: 42,
      activeStrokes: [{ ...strokeAtY(1000, 40, 43), blockUuid: 'C' }, { ...strokeAtY(2000, 50, 53), blockUuid: 'DEAD' }],
    });
    expect(strokeById('s1000').lineId).toBe('A');
    expect(strokeById('s2000').lineId).toBeNull();
  });

  it('a canvas link to a live line still syncs', async () => {
    getPage.mockResolvedValue(doc([storedAtY(1000, 40, 43)], [textLine('A', 'a')]));
    await savePageToFolder({ book: 3017, page: 42, activeStrokes: [{ ...strokeAtY(1000, 40, 43), blockUuid: 'A' }] });
    expect(strokeById('s1000').lineId).toBe('A');
  });
});

describe('savePageToFolder — Relink (v3.21.0, spec B.3 / B.7)', () => {
  // Imported here so the rest of the file is unchanged.
  let isTrustworthyTranscript, classifyRelink, buildRelinkSpec, defaultDecisions, fixture;
  beforeEach(async () => {
    ({ isTrustworthyTranscript } = await import('../viewer/ink-text.js'));
    ({ classifyRelink, buildRelinkSpec, defaultDecisions } = await import('../relink.js'));
    fixture = await import('./fixtures/relink-page.js');
    vi.mocked(getPage).mockReset();
    vi.mocked(savePage).mockReset();
    vi.mocked(savePage).mockResolvedValue({ success: true, path: 'x' });
  });

  const written = () => vi.mocked(savePage).mock.calls.at(-1)[2];
  const fields = (l) => ({ id: l.id, text: l.text, indentLevel: l.indentLevel, parentId: l.parentId, checked: l.checked, marker: l.marker });

  function relinkOf(doc, run, decide = () => {}) {
    const model = classifyRelink(doc.transcript.lines, run.lines);
    const d = defaultDecisions(model);
    decide(d, model);
    return buildRelinkSpec(run, model, d);
  }

  it('the 3017/123-like page (28 lines, 5 tasks, one CANCELLED): trustworthy after, every task unchanged', async () => {
    const doc = fixture.makeOldPage();
    expect(isTrustworthyTranscript(doc)).toBe(false);
    vi.mocked(getPage).mockResolvedValue(JSON.parse(JSON.stringify(doc)));
    const r = await savePageToFolder({ book: '3017', page: '123', activeStrokes: [], relink: relinkOf(doc, fixture.makeRun(doc)) });
    expect(r.success).toBe(true);
    expect(r.relinked).toBe(28);
    const out = written();
    expect(isTrustworthyTranscript(out)).toBe(true);
    // Every line field but yBounds kept: ids, text, order, indent, parent, task state.
    expect(out.transcript.lines.map(fields)).toEqual(doc.transcript.lines.map(fields));
    const tasks = (ls) => ls.filter((l) => l.checked != null).map((l) => [l.id, l.checked, l.marker ?? null]);
    expect(tasks(out.transcript.lines)).toEqual(tasks(doc.transcript.lines));
    expect(tasks(out.transcript.lines)).toHaveLength(5);
    expect(out.transcript.lines.find((l) => l.marker === 'CANCELLED')).toMatchObject({ id: 'L13', checked: true });
    // No stroke deleted, points and order untouched, each linked to its own line.
    expect(out.strokes).toHaveLength(doc.strokes.length);
    out.strokes.forEach((s, k) => {
      expect(s.points).toEqual(doc.strokes[k].points);
      expect(s.lineId).toBe(doc.transcript.lines[Math.floor(k / 3)].id);
    });
    expect(out.transcript.lastTranscribed > doc.transcript.lastTranscribed).toBe(true);
    expect(out.metadata.lastUpdated > doc.metadata.lastUpdated).toBe(true);
    expect(out.pageInfo).toMatchObject({ book: 3017, page: 123, section: 3, owner: 1012 });
  });

  it('the 3017/180-like page: moved lines linked in place, the page trustworthy after', async () => {
    const doc = fixture.makeMovedPage();
    vi.mocked(getPage).mockResolvedValue(JSON.parse(JSON.stringify(doc)));
    const r = await savePageToFolder({ book: '3017', page: '180', relink: relinkOf(doc, fixture.makeRun(doc)) });
    expect(r.relinked).toBe(28);
    const out = written();
    expect(out.transcript.lines.map(fields)).toEqual(doc.transcript.lines.map(fields));
    expect(isTrustworthyTranscript(out)).toBe(true);
  });

  it('leaves textless and kind-line strokes alone and keeps the kind line', async () => {
    const doc = fixture.makeOldPage();
    doc.strokes[0].textless = true;
    doc.strokes[0].lineId = null;
    doc.transcript.lines.push({ id: 'sk', kind: 'sketch', text: 'Sketch', indentLevel: 0, parentId: null, checked: null, yBounds: null });
    doc.strokes[4].lineId = 'sk';
    vi.mocked(getPage).mockResolvedValue(JSON.parse(JSON.stringify(doc)));
    const run = fixture.makeRun(doc);
    run.sent = run.sent.filter((id) => id !== doc.strokes[4].id);
    await savePageToFolder({ book: '3017', page: '123', relink: relinkOf(doc, run) });
    const out = written();
    expect(out.strokes[0]).toEqual(doc.strokes[0]);
    expect(out.strokes[4]).toEqual(doc.strokes[4]);
    expect(out.transcript.lines.at(-1)).toMatchObject(doc.transcript.lines.at(-1));
    // v3.24.0: the save recomputes a sketch's box from its strokes.
    expect(out.transcript.lines.at(-1).bounds).toBeTruthy();
  });

  it('writes leftover ink chosen as Not text, and a taken word fix, in the same save', async () => {
    const doc = fixture.makeOldPage();
    const y = fixture.rowY(27) + 6;
    doc.strokes.push({ id: 's1765400000000', startTime: 1765400000000, endTime: 1765400000400, lineId: 'L03', points: [[20, y], [30, y + 2]] });
    vi.mocked(getPage).mockResolvedValue(JSON.parse(JSON.stringify(doc)));
    const run = fixture.makeRun(doc, { extra: [{ text: 'scribble', y }] });
    const spec = relinkOf(doc, run, (d, m) => {
      d.leftover[m.rows.find((r) => r.type === 'leftover').ms] = 'textless';
      d.fixes.L05 = [0];
    });
    const r = await savePageToFolder({ book: '3017', page: '123', relink: spec });
    const out = written();
    expect(out.strokes.at(-1)).toMatchObject({ textless: true, lineId: null });
    expect(r.textlessIds).toEqual(['s1765400000000']);
    expect(out.transcript.lines[5].text).toBe('boring plate at top');
    expect(out.transcript.lines).toHaveLength(28);
  });

  it('refuses a relink that links no line (every row no ink, or every confirm set to Don\'t link), writing nothing', async () => {
    const doc = fixture.makeOldPage();
    vi.mocked(getPage).mockResolvedValue(JSON.parse(JSON.stringify(doc)));
    const run = fixture.makeRun(doc, { overrides: { 7: 'coordinate w/ architekt' } });
    const spec = relinkOf(doc, run, (d, m) => {
      for (const r of m.rows) if (r.type === 'confirm') d.link[r.lineId] = false;
    });
    spec.links = [];
    const r = await savePageToFolder({ book: '3017', page: '123', relink: spec });
    expect(r).toMatchObject({ success: false, noLinks: true });
    expect(savePage).not.toHaveBeenCalled();
  });

  it('a no-ink line saved with yBounds null is safe on the now trustworthy page: a later transcription merges past it', async () => {
    const doc = fixture.makeOldPage();
    vi.mocked(getPage).mockResolvedValue(JSON.parse(JSON.stringify(doc)));
    await savePageToFolder({ book: '3017', page: '123', relink: relinkOf(doc, fixture.makeRun(doc, { drop: [10] })) });
    const out = written();
    expect(out.transcript.lines[10].yBounds).toBeNull();
    expect(isTrustworthyTranscript(out)).toBe(true);
    // Transcribing a new line with the same text: not taken for a duplicate of the
    // unmeasured line (its yBounds no longer look like a position), and nothing throws.
    vi.mocked(getPage).mockResolvedValue(JSON.parse(JSON.stringify(out)));
    const y = fixture.rowY(27) + 6;
    const r = await savePageToFolder({
      book: '3017', page: '123', activeStrokes: [],
      pageTranscription: { lines: [{ text: out.transcript.lines[10].text, yBounds: { minY: fixture.mm(y), maxY: fixture.mm(y + 2) } }], originNcodeY: 10 }
    });
    expect(r.success).toBe(true);
    expect(written().transcript.lines).toHaveLength(29);
  });

  it('refuses a page written since its MyScript run (stale), writing nothing', async () => {
    const doc = fixture.makeOldPage();
    const spec = relinkOf(doc, fixture.makeRun(doc));
    vi.mocked(getPage).mockResolvedValue({ ...JSON.parse(JSON.stringify(doc)), metadata: { ...doc.metadata, lastUpdated: '2026-11-19T09:00:00.000Z' } });
    const r = await savePageToFolder({ book: '3017', page: '123', relink: spec });
    expect(r).toMatchObject({ success: false, stale: true });
    expect(savePage).not.toHaveBeenCalled();
    vi.mocked(getPage).mockResolvedValue(null);
    expect(await savePageToFolder({ book: '3017', page: '123', relink: spec })).toMatchObject({ success: false });
    expect(savePage).not.toHaveBeenCalled();
  });
});

/* ===================================================================
 *  Sketch lines (v3.24.0, docs/TRANSCRIPT-STRUCTURE-SPEC.md E.4 / E.6)
 * =================================================================== */
describe('savePageToFolder — sketch lines survive every transcript path', () => {
  const written = () => savePage.mock.calls.at(-1)[2];
  /** A stored stroke: a short tick from y0 to y1 at x. */
  const st = (t, x, y0, y1, lineId = null) => ({ id: `s${t}`, startTime: t, endTime: t + 10, lineId, points: [[x, y0], [x + 1, y1]] });
  const SK = { id: 'SK', kind: 'sketch', text: 'Floor plan', indentLevel: 1, parentId: 'A', checked: null, yBounds: null, bounds: { minX: 20, maxX: 31, minY: 50, maxY: 70 } };
  /** Text line A at y 40–43 with ink, a sketch under it (ink y 50–70), text line B at y 80–83. */
  const page = () => ({
    version: '2.0', pageInfo: PAGE_INFO,
    metadata: { lastUpdated: '2026-11-01T00:00:00Z', totalStrokes: 4 },
    transcript: {
      lastTranscribed: '2026-11-01T00:00:00Z',
      lines: [
        { id: 'A', text: 'site visit', indentLevel: 0, parentId: null, checked: null, yBounds: mmBounds(40, 43, 40) },
        { ...SK },
        { id: 'B', text: 'need heater', indentLevel: 0, parentId: null, checked: null, yBounds: mmBounds(80, 83, 40) },
      ]
    },
    strokes: [st(1000, 10, 40, 43, 'A'), st(2000, 20, 50, 70, 'SK'), st(2001, 30, 55, 60, 'SK'), st(3000, 10, 80, 83, 'B')]
  });

  beforeEach(() => {
    getPage.mockReset();
    savePage.mockReset();
    savePage.mockResolvedValue({ path: '/tmp/P42.json' });
  });

  it('a MyScript merge keeps the sketch line in place and never matches its ink to a new line', async () => {
    const doc = page();
    // New ink at y 52–58 (beside the sketch), transcribed as a line spanning the sketch's height.
    doc.strokes.push(st(4000, 60, 52, 58));
    getPage.mockResolvedValue(JSON.parse(JSON.stringify(doc)));
    await savePageToFolder({
      book: '3017', page: 42, activeStrokes: [],
      pageTranscription: { originNcodeY: 50, transcribedStrokeIds: ['4000'], lines: [{ text: 'beside', yBounds: mmBounds(50, 70, 50) }] }
    });
    const out = written();
    expect(out.transcript.lines.map((l) => l.id).slice(0, 3)).toEqual(['A', 'SK', 'B']);
    expect(out.transcript.lines[1]).toMatchObject({ kind: 'sketch', text: 'Floor plan', yBounds: null, checked: null });
    expect(out.strokes.find((s) => s.id === 's2000').lineId).toBe('SK');
    expect(out.strokes.find((s) => s.id === 's2001').lineId).toBe('SK');
    expect(out.strokes.find((s) => s.id === 's4000').lineId).toBe(out.transcript.lines[3].id);
  });

  it('an Edit Transcription result keeps the sketch row; a cleared label reads "Sketch", never a delete', async () => {
    getPage.mockResolvedValue(page());
    await savePageToFolder({
      book: '3017', page: 42, activeStrokes: [],
      pageTranscription: {
        editorBaseIds: ['A', 'SK', 'B'],
        lines: [
          { text: 'site visit', indentLevel: 0, blockUuid: 'A' },
          { text: '   ', indentLevel: 2, blockUuid: 'SK', kind: 'sketch' },
          { text: 'need heater', indentLevel: 0, blockUuid: 'B' },
        ]
      }
    });
    const out = written();
    expect(out.transcript.lines.map((l) => l.id)).toEqual(['A', 'SK', 'B']);
    expect(out.transcript.lines[1]).toMatchObject({ kind: 'sketch', text: 'Sketch', indentLevel: 2, checked: null, yBounds: null });
    expect(out.transcript.lines[1].bounds).toEqual({ minX: 20, maxX: 31, minY: 50, maxY: 70 });
    expect(out.strokes.filter((s) => s.lineId === 'SK')).toHaveLength(2);
  });

  it('a sketch label typed with a task box stays a label, never a task', async () => {
    getPage.mockResolvedValue(page());
    await savePageToFolder({
      book: '3017', page: 42, activeStrokes: [],
      pageTranscription: { editorBaseIds: ['A', 'SK', 'B'], lines: [
        { text: 'site visit', blockUuid: 'A' }, { text: 'TODO plan', indentLevel: 1, blockUuid: 'SK', kind: 'sketch' }, { text: 'need heater', blockUuid: 'B' }
      ] }
    });
    expect(written().transcript.lines[1]).toMatchObject({ text: 'TODO plan', checked: null });
  });

  it('a sketch deleted in the dialog unlinks its ink and never flags it Not text, whatever the ink choice', async () => {
    getPage.mockResolvedValue(page());
    const r = await savePageToFolder({
      book: '3017', page: 42, activeStrokes: [],
      pageTranscription: {
        editorBaseIds: ['A', 'SK', 'B'], deletedLineIds: ['SK'], deletedInk: 'textless',
        lines: [{ text: 'site visit', blockUuid: 'A' }, { text: 'need heater', blockUuid: 'B' }]
      }
    });
    const out = written();
    expect(out.transcript.lines.map((l) => l.id)).toEqual(['A', 'B']);
    expect(out.strokes).toHaveLength(4);   // no stroke is ever deleted
    for (const id of ['s2000', 's2001']) {
      const s = out.strokes.find((x) => x.id === id);
      expect(s.lineId).toBeNull();
      expect(s.textless).toBeUndefined();
    }
    expect(r.textlessIds).toEqual([]);
    expect(r.unlinkedIds.sort()).toEqual(['s2000', 's2001']);
  });

  it('Reset + replace keeps the sketch, re-placed by y under the new line above its ink, its ink still linked', async () => {
    getPage.mockResolvedValue(page());
    await savePageToFolder({
      book: '3017', page: 42, activeStrokes: [],
      pageTranscription: {
        replace: true, originNcodeY: 40, transcribedStrokeIds: ['1000', '3000'],
        lines: [{ text: 'site visit, again', yBounds: mmBounds(40, 43, 40) }, { text: 'need heater', yBounds: mmBounds(80, 83, 40) }]
      }
    });
    const out = written();
    const lines = out.transcript.lines;
    expect(lines.map((l) => l.text)).toEqual(['site visit, again', 'Floor plan', 'need heater']);
    expect(lines[1]).toMatchObject({ id: 'SK', kind: 'sketch', indentLevel: 1, parentId: lines[0].id });
    expect(out.strokes.find((s) => s.id === 's2000').lineId).toBe('SK');
    expect(out.strokes.find((s) => s.id === 's2001').lineId).toBe('SK');
    expect(out.strokes.find((s) => s.id === 's1000').lineId).toBe(lines[0].id);
    expect(out.strokes.find((s) => s.id === 's3000').lineId).toBe(lines[2].id);
  });

  it('recomputes a sketch\'s bounds when one of its strokes is deleted', async () => {
    getPage.mockResolvedValue(page());
    await savePageToFolder({ book: '3017', page: 42, activeStrokes: [], deletedStrokeIds: new Set(['s2000']) });
    expect(written().transcript.lines[1].bounds).toEqual({ minX: 30, maxX: 31, minY: 55, maxY: 60 });
  });
});
