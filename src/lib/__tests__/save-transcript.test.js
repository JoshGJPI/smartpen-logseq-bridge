/**
 * Tests for viewer/save-transcript.js — persisting edited transcript lines.
 *
 * Coverage:
 *   - recomputeParentIds (parent assignment by indentLevel)
 *   - saveTranscriptLines (verbatim line write, lineId scrub on deleted lines,
 *     timestamp bump, missing-page guard)
 *
 * getPage / savePage are mocked so no Electron storage backend is needed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/storage/local-store.js', () => ({
  getPage: vi.fn(),
  savePage: vi.fn(),
}));

import { getPage, savePage } from '$lib/storage/local-store.js';
import { recomputeParentIds, saveTranscriptLines } from '../viewer/save-transcript.js';

describe('recomputeParentIds', () => {
  it('assigns each line its nearest shallower ancestor', () => {
    const out = recomputeParentIds([
      { id: 'a', indentLevel: 0 },
      { id: 'b', indentLevel: 1 },
      { id: 'c', indentLevel: 2 },
      { id: 'd', indentLevel: 1 },
      { id: 'e', indentLevel: 0 },
    ]);
    expect(out.map((l) => l.parentId)).toEqual([null, 'a', 'b', 'a', null]);
  });

  it('treats top-level siblings as parentless', () => {
    const out = recomputeParentIds([
      { id: 'a', indentLevel: 0 },
      { id: 'b', indentLevel: 0 },
    ]);
    expect(out.map((l) => l.parentId)).toEqual([null, null]);
  });
});

describe('saveTranscriptLines', () => {
  beforeEach(() => {
    getPage.mockReset();
    savePage.mockReset();
  });

  it('writes edited lines verbatim and scrubs deleted lineIds', async () => {
    getPage.mockResolvedValue({
      version: '2.0',
      pageInfo: { section: 1, owner: 1, book: 3, page: 5 },
      metadata: { lastUpdated: 'old', totalStrokes: 2, bounds: {} },
      transcript: { lastTranscribed: 'old', lines: [{ id: 'L1', text: 'old' }] },
      strokes: [
        { id: 's1', lineId: 'L1', points: [] },
        { id: 's2', lineId: 'L2', points: [] },
      ],
    });
    savePage.mockResolvedValue({ success: true });

    const res = await saveTranscriptLines(3, 5, [
      { id: 'L1', text: 'kept', indentLevel: 0, checked: false },
    ]);

    expect(res.success).toBe(true);
    expect(savePage).toHaveBeenCalledTimes(1);

    const [book, page, doc] = savePage.mock.calls[0];
    expect(book).toBe(3);
    expect(page).toBe(5);

    // Transcript replaced with the edited line (normalised shape).
    expect(doc.transcript.lines).toEqual([
      { id: 'L1', text: 'kept', indentLevel: 0, parentId: null, checked: false, yBounds: null },
    ]);

    // Stroke s1 still points to a surviving line; s2's deleted line is scrubbed.
    const byId = Object.fromEntries(doc.strokes.map((s) => [s.id, s]));
    expect(byId.s1.lineId).toBe('L1');
    expect(byId.s2.lineId).toBeNull();

    // Timestamps bumped.
    expect(doc.transcript.lastTranscribed).not.toBe('old');
    expect(doc.metadata.lastUpdated).not.toBe('old');
  });

  it('throws and does not save when the page is missing', async () => {
    getPage.mockResolvedValue(null);
    await expect(saveTranscriptLines(1, 1, [])).rejects.toThrow(/not found/);
    expect(savePage).not.toHaveBeenCalled();
  });
});
