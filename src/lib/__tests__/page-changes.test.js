/**
 * Tests for storage/page-changes.js — the per-page diff preview shown by
 * SaveConfirmDialog.
 *
 * This is a second, independent implementation of the same question
 * `computePendingChangesMap()` answers (the dialog reads the PageDoc off disk
 * rather than the in-memory on-disk-state index), so it needs the same
 * classification: a stroke already stored whose sketch flag has since been
 * toggled is a change, even though the stroke count doesn't move.
 *
 * getPage is mocked so no Electron storage backend is needed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Resolved relative to THIS file so it lands on the same module id that
// page-changes.js's `./local-store.js` resolves to.
vi.mock('../storage/local-store.js', () => ({
  getPage: vi.fn(),
}));

import { getPage } from '../storage/local-store.js';
import { computePageChangesFolder } from '../storage/page-changes.js';

/** Canvas-format stroke (what the dialog passes in). */
function canvasStroke(startTime, extra = {}) {
  return {
    pageInfo: { section: 3, owner: 1012, book: 1, page: 5 },
    startTime,
    endTime: startTime + 100,
    dotArray: [{ x: 1, y: 2, f: 400, timestamp: startTime }],
    ...extra,
  };
}

/** Stored stroke as it appears in a PageDoc. */
function storedStroke(id, extra = {}) {
  return { id, startTime: Number(id.slice(1)), points: [[1, 2, 100, 400]], ...extra };
}

function pageDoc(strokes, transcriptLines = []) {
  return {
    version: '2.0',
    pageInfo: { section: 3, owner: 1012, book: 1, page: 5 },
    metadata: {},
    transcript: { lastTranscribed: null, lines: transcriptLines },
    strokes,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('computePageChangesFolder', () => {
  it('counts every stroke as an addition when the page has no file yet', async () => {
    getPage.mockResolvedValue(null);
    const out = await computePageChangesFolder(1, 5, [canvasStroke(1000), canvasStroke(2000)], null);
    expect(out.strokeAdditions).toBe(2);
    expect(out.strokeModifications).toBe(0);
    expect(out.strokeDeletions).toBe(0);
    expect(out.strokeTotal).toBe(2);
  });

  it('reports nothing when the canvas matches the stored page', async () => {
    getPage.mockResolvedValue(pageDoc([storedStroke('s1000'), storedStroke('s2000')]));
    const out = await computePageChangesFolder(1, 5, [canvasStroke(1000), canvasStroke(2000)], null);
    expect(out.strokeAdditions).toBe(0);
    expect(out.strokeModifications).toBe(0);
  });

  it('counts a sketch flag turned on for a stored stroke as a modification', async () => {
    getPage.mockResolvedValue(pageDoc([storedStroke('s1000')]));
    const out = await computePageChangesFolder(1, 5, [canvasStroke(1000, { sketch: true })], null);
    expect(out.strokeModifications).toBe(1);
    expect(out.strokeAdditions).toBe(0);
    // A flag toggle doesn't change how many strokes the page holds.
    expect(out.strokeTotal).toBe(1);
  });

  it('counts a sketch flag turned off for a stored stroke as a modification', async () => {
    getPage.mockResolvedValue(pageDoc([storedStroke('s1000', { sketch: true })]));
    const out = await computePageChangesFolder(1, 5, [canvasStroke(1000, { sketch: false })], null);
    expect(out.strokeModifications).toBe(1);
  });

  it('treats an absent flag and a false flag as the same state', async () => {
    getPage.mockResolvedValue(pageDoc([storedStroke('s1000')]));
    const out = await computePageChangesFolder(1, 5, [canvasStroke(1000, { sketch: false })], null);
    expect(out.strokeModifications).toBe(0);
  });

  it('counts a new flagged stroke once, as an addition only', async () => {
    getPage.mockResolvedValue(pageDoc([storedStroke('s1000')]));
    const out = await computePageChangesFolder(1, 5, [canvasStroke(3000, { sketch: true })], null);
    expect(out.strokeAdditions).toBe(1);
    expect(out.strokeModifications).toBe(0);
  });

  it('counts additions, modifications and deletions together', async () => {
    getPage.mockResolvedValue(pageDoc([
      storedStroke('s1000'),
      storedStroke('s2000'),
      storedStroke('s4000'),
    ]));
    const out = await computePageChangesFolder(
      1, 5,
      [canvasStroke(1000, { sketch: true }), canvasStroke(2000), canvasStroke(3000)],
      null,
      new Set(['s4000'])
    );
    expect(out.strokeAdditions).toBe(1);      // s3000
    expect(out.strokeModifications).toBe(1);  // s1000 flagged
    expect(out.strokeDeletions).toBe(1);      // s4000
    expect(out.strokeTotal).toBe(3);          // 3 stored - 1 deleted + 1 added
  });

  it('reports a modification count of zero on the error fallback', async () => {
    getPage.mockRejectedValue(new Error('disk gone'));
    const out = await computePageChangesFolder(1, 5, [canvasStroke(1000, { sketch: true })], null);
    expect(out.strokeAdditions).toBe(1);
    expect(out.strokeModifications).toBe(0);
  });

  it('still flags new and changed transcriptions', async () => {
    getPage.mockResolvedValue(pageDoc([storedStroke('s1000')]));
    const fresh = { lines: [{ text: 'hello' }] };
    const out = await computePageChangesFolder(1, 5, [canvasStroke(1000)], fresh);
    expect(out.hasNewTranscription).toBe(true);

    getPage.mockResolvedValue(pageDoc([storedStroke('s1000')], [{ id: 'l1', text: 'old' }]));
    const out2 = await computePageChangesFolder(1, 5, [canvasStroke(1000)], fresh);
    expect(out2.transcriptionChanged).toBe(true);
  });

  describe('point edits', () => {
    /** Canvas stroke with an explicit number of points. */
    const withPoints = (startTime, pointCount, extra = {}) => ({
      pageInfo: { section: 3, owner: 1012, book: 1, page: 5 },
      startTime,
      endTime: startTime + 100,
      dotArray: Array.from({ length: pointCount }, (_, i) => ({ x: i, y: i, f: 400 })),
      ...extra,
    });

    /** Stored stroke with an explicit number of points. */
    const storedWithPoints = (id, pointCount, extra = {}) => ({
      id,
      startTime: Number(id.slice(1)),
      points: Array.from({ length: pointCount }, (_, i) => [i, i, 100 + i, 400]),
      ...extra,
    });

    it('counts a stroke with fewer points than the stored copy as an edit', async () => {
      getPage.mockResolvedValue(pageDoc([storedWithPoints('s1000', 57)]));
      const out = await computePageChangesFolder(1, 5, [withPoints(1000, 56)], null);

      expect(out.strokeEdits).toBe(1);
      expect(out.strokeAdditions).toBe(0);
      expect(out.strokeModifications).toBe(0);
    });

    it('counts nothing once the point counts agree', async () => {
      getPage.mockResolvedValue(pageDoc([storedWithPoints('s1000', 56)]));
      const out = await computePageChangesFolder(1, 5, [withPoints(1000, 56)], null);
      expect(out.strokeEdits).toBe(0);
    });

    it('does not change the stroke total — an edit moves no stroke count', async () => {
      getPage.mockResolvedValue(pageDoc([storedWithPoints('s1000', 57)]));
      const out = await computePageChangesFolder(1, 5, [withPoints(1000, 56)], null);
      expect(out.strokeTotal).toBe(1);
    });

    it('counts a stroke that is both edited and re-flagged once, as an edit', async () => {
      getPage.mockResolvedValue(pageDoc([storedWithPoints('s1000', 57)]));
      const out = await computePageChangesFolder(
        1, 5, [withPoints(1000, 56, { sketch: true })], null
      );
      expect(out.strokeEdits).toBe(1);
      expect(out.strokeModifications).toBe(0);
    });

    it('counts a new stroke as an addition, not an edit', async () => {
      getPage.mockResolvedValue(pageDoc([storedWithPoints('s1000', 57)]));
      const out = await computePageChangesFolder(
        1, 5, [withPoints(2000, 12, { pointsEdited: true })], null
      );
      expect(out.strokeAdditions).toBe(1);
      expect(out.strokeEdits).toBe(0);
    });

    it('reports an edit count of zero on the error fallback', async () => {
      getPage.mockRejectedValue(new Error('disk gone'));
      const out = await computePageChangesFolder(1, 5, [withPoints(1000, 56)], null);
      expect(out.strokeEdits).toBe(0);
    });

    it('separates edits from additions, restyles and deletions on one page', async () => {
      getPage.mockResolvedValue(pageDoc([
        storedWithPoints('s1000', 20),
        storedWithPoints('s2000', 20),
        storedWithPoints('s4000', 20),
      ]));

      const out = await computePageChangesFolder(
        1, 5,
        [
          withPoints(1000, 19),                   // edited
          withPoints(2000, 20, { sketch: true }), // restyled
          withPoints(3000, 20),                   // added
        ],
        null,
        new Set(['s4000'])                        // deleted
      );

      expect(out.strokeEdits).toBe(1);
      expect(out.strokeModifications).toBe(1);
      expect(out.strokeAdditions).toBe(1);
      expect(out.strokeDeletions).toBe(1);
      expect(out.strokeTotal).toBe(3); // 3 stored - 1 deleted + 1 added
    });
  });

  describe('strokeMoves (volume reassignment)', () => {
    it('counts a stored stroke leaving for another volume', async () => {
      getPage.mockResolvedValue(pageDoc([storedStroke('s1000'), storedStroke('s2000')]));
      // The moved stroke is no longer among this page's canvas strokes.
      const out = await computePageChangesFolder(
        '388', 5, [canvasStroke(1000)], null, new Set(), new Set(['s2000'])
      );

      expect(out.strokeMoves).toBe(1);
      expect(out.strokeDeletions).toBe(0);   // nothing destroyed — it lives in the target
      expect(out.strokeAdditions).toBe(0);
      expect(out.strokeTotal).toBe(1);       // 2 stored - 1 moved
    });

    it('handles a whole-page move (every stored stroke leaves)', async () => {
      getPage.mockResolvedValue(pageDoc([storedStroke('s1000'), storedStroke('s2000')]));
      const out = await computePageChangesFolder(
        '388', 5, [], null, new Set(), new Set(['s1000', 's2000'])
      );

      expect(out.strokeMoves).toBe(2);
      expect(out.strokeTotal).toBe(0);
    });

    it('ignores ids that were never on this page', async () => {
      getPage.mockResolvedValue(pageDoc([storedStroke('s1000')]));
      const out = await computePageChangesFolder(
        '388', 5, [canvasStroke(1000)], null, new Set(), new Set(['s9999'])
      );
      expect(out.strokeMoves).toBe(0);
      expect(out.strokeTotal).toBe(1);
    });

    // A stroke can't be both destroyed and relocated; deletion is the stronger
    // claim, and double-counting would make strokeTotal go negative.
    it('counts a stroke that is both deleted and moved only as a deletion', async () => {
      getPage.mockResolvedValue(pageDoc([storedStroke('s1000'), storedStroke('s2000')]));
      const out = await computePageChangesFolder(
        '388', 5, [canvasStroke(1000)], null, new Set(['s2000']), new Set(['s2000'])
      );

      expect(out.strokeDeletions).toBe(1);
      expect(out.strokeMoves).toBe(0);
      expect(out.strokeTotal).toBe(1);
    });

    it('reports zero moves when none were passed (default arg)', async () => {
      getPage.mockResolvedValue(pageDoc([storedStroke('s1000')]));
      const out = await computePageChangesFolder(1, 5, [canvasStroke(1000)], null);
      expect(out.strokeMoves).toBe(0);
    });

    it('reports zero moves in the error fallback', async () => {
      getPage.mockRejectedValue(new Error('disk gone'));
      const out = await computePageChangesFolder(
        '388', 5, [canvasStroke(1000)], null, new Set(), new Set(['s2000'])
      );
      expect(out.strokeMoves).toBe(0);
      expect(out.strokeAdditions).toBe(1);
    });
  });
});
