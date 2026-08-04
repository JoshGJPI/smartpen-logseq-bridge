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
});
