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

  it('with base: a task state changed on disk after Edit opened is kept, and returned', async () => {
    // Edit opened on TODO / WAITING; meanwhile a was ticked DONE and b made plain.
    getPage.mockResolvedValue({
      version: '2.0', pageInfo: { section: 1, owner: 1, book: 3, page: 5 }, metadata: {},
      transcript: { lines: [{ id: 'a', text: 'a', checked: true }, { id: 'b', text: 'b', checked: null }, { id: 'c', text: 'c', checked: true, marker: 'CANCELLED' }] },
      strokes: []
    });
    savePage.mockResolvedValue({ success: true });
    const base = [{ id: 'a', text: 'a', checked: false }, { id: 'b', text: 'b', checked: false, marker: 'WAITING' }, { id: 'c', text: 'c', checked: true, marker: 'CANCELLED' }];
    const draft = [{ id: 'a', text: 'a edited', checked: false }, { id: 'b', text: 'b', checked: false, marker: 'WAITING' }, { id: 'c', text: 'c', checked: true, marker: 'CANCELLED' }];
    const res = await saveTranscriptLines(3, 5, draft, { base });
    const written = savePage.mock.calls[0][2].transcript.lines;
    expect(written.map((l) => [l.id, l.text, l.checked, l.marker])).toEqual([
      ['a', 'a edited', true, undefined], ['b', 'b', null, undefined], ['c', 'c', true, 'CANCELLED']
    ]);
    expect(res.lines).toEqual(written);
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

  it('carries a WAITING marker, only beside checked: false (v3.4.0)', async () => {
    getPage.mockResolvedValue({
      version: '2.0',
      pageInfo: { section: 1, owner: 1, book: 3, page: 5 },
      metadata: { lastUpdated: 'old', totalStrokes: 0, bounds: {} },
      transcript: { lastTranscribed: 'old', lines: [] },
      strokes: [],
    });
    savePage.mockResolvedValue({ success: true });
    await saveTranscriptLines(3, 5, [
      { id: 'W', text: 'waiting', indentLevel: 0, checked: false, marker: 'WAITING' },
      { id: 'D', text: 'done', indentLevel: 0, checked: true, marker: 'WAITING' },
      { id: 'T', text: 'todo', indentLevel: 0, checked: false },
    ]);
    const lines = savePage.mock.calls[0][2].transcript.lines;
    expect(lines[0]).toEqual({ id: 'W', text: 'waiting', indentLevel: 0, parentId: null, checked: false, marker: 'WAITING', yBounds: null });
    expect(lines[1]).not.toHaveProperty('marker');
    expect(lines[2]).not.toHaveProperty('marker');
  });

  it('carries a CANCELLED marker, only beside checked: true (v3.5.0)', async () => {
    getPage.mockResolvedValue({
      version: '2.0',
      pageInfo: { section: 1, owner: 1, book: 3, page: 5 },
      metadata: { lastUpdated: 'old', totalStrokes: 0, bounds: {} },
      transcript: { lastTranscribed: 'old', lines: [] },
      strokes: [],
    });
    savePage.mockResolvedValue({ success: true });
    await saveTranscriptLines(3, 5, [
      { id: 'C', text: 'dropped', indentLevel: 0, checked: true, marker: 'CANCELLED' },
      { id: 'O', text: 'open', indentLevel: 0, checked: false, marker: 'CANCELLED' },
    ]);
    const lines = savePage.mock.calls[0][2].transcript.lines;
    expect(lines[0]).toEqual({ id: 'C', text: 'dropped', indentLevel: 0, parentId: null, checked: true, marker: 'CANCELLED', yBounds: null });
    expect(lines[1]).not.toHaveProperty('marker');
  });

  it('throws and does not save when the page is missing', async () => {
    getPage.mockResolvedValue(null);
    await expect(saveTranscriptLines(1, 1, [])).rejects.toThrow(/not found/);
    expect(savePage).not.toHaveBeenCalled();
  });
});
