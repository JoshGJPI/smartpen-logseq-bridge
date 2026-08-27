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
  strokeToStored, savePageToFolder, planPageMove, finalizePageMoves, transcriptionOriginY
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
    expect(out).toEqual({ transcriptsMoved: 0, pagesDeleted: 0, errors: [] });
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
    expect(out).toEqual({ transcriptsMoved: 0, pagesDeleted: 0, errors: [] });
  });
});
