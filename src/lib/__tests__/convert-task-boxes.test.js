/**
 * Tests for storage/convert-task-boxes.js — the one-off conversion of pages
 * transcribed while MyScript's task boxes still stayed in the text.
 *
 * What matters: only lines starting with a marker change, an existing state is
 * never overwritten, nothing but text / checked / metadata.lastUpdated moves,
 * and the Library's Ink + text trust test gives the same answer afterwards.
 */

import { describe, it, expect } from 'vitest';
import {
  mightHaveTaskBoxes, planPageConversion, applyPageConversion, summarizeConversion
} from '../storage/convert-task-boxes.js';
import { isTrustworthyTranscript } from '../viewer/ink-text.js';

const line = (id, text, checked = null, extra = {}) => ({
  id, text, indentLevel: 0, parentId: null, checked, yBounds: { minY: 1.6, maxY: 8.6 }, ...extra,
});

const pageDoc = (lines, extra = {}) => ({
  version: '2.0',
  pageInfo: { section: 3, owner: 1012, book: 3017, page: 142 },
  metadata: { lastUpdated: '2026-09-01T10:00:00.000Z', totalStrokes: 0, bounds: {} },
  transcript: { lastTranscribed: '2026-09-01T10:00:00.000Z', lines },
  strokes: [],
  ...extra,
});

describe('mightHaveTaskBoxes', () => {
  it('finds a marker on any line, indented or not', () => {
    expect(mightHaveTaskBoxes('Heading\n  ☐ Call Troy')).toBe(true);
    expect(mightHaveTaskBoxes('TODO ask Jeff')).toBe(true);
  });

  it('is false for plain text, a bare tick and nothing', () => {
    expect(mightHaveTaskBoxes('Heading\n  ✓ Looks fine')).toBe(false);
    expect(mightHaveTaskBoxes('')).toBe(false);
    expect(mightHaveTaskBoxes(null)).toBe(false);
  });
});

describe('planPageConversion', () => {
  it('turns glyph and typed markers into states, leaving other lines out', () => {
    const doc = pageDoc([
      line('h', 'Coordination call'),
      line('a', '☐ Call Troy'),
      line('b', '☑ Check on PO'),
      line('c', 'TODO ask Jeff'),
      line('d', '✓ Looks fine'),
      line('e', 'WAITING Juan will email'),
    ]);
    const { changes, conflicts } = planPageConversion(doc);
    expect(changes).toEqual([
      { lineId: 'a', oldText: '☐ Call Troy', newText: 'Call Troy', checked: false, wasSet: false },
      { lineId: 'b', oldText: '☑ Check on PO', newText: 'Check on PO', checked: true, wasSet: false },
      { lineId: 'c', oldText: 'TODO ask Jeff', newText: 'ask Jeff', checked: false, wasSet: false },
    ]);
    expect(conflicts).toEqual([]);
  });

  it('strips a glyph that agrees with a state already set, keeping the state', () => {
    const { changes } = planPageConversion(pageDoc([line('a', '☑ Check on PO', true)]));
    expect(changes).toEqual([
      { lineId: 'a', oldText: '☑ Check on PO', newText: 'Check on PO', checked: true, wasSet: true },
    ]);
  });

  it('leaves a line whose glyph disagrees with its state alone, as a conflict', () => {
    const { changes, conflicts } = planPageConversion(pageDoc([line('a', '☐ Call Troy', true)]));
    expect(changes).toEqual([]);
    expect(conflicts).toEqual([{ lineId: 'a', text: '☐ Call Troy', checked: true, marker: false }]);
  });

  it('plans nothing for a page with no transcript, no lines or no doc', () => {
    const empty = { changes: [], conflicts: [] };
    expect(planPageConversion(pageDoc([]))).toEqual(empty);
    expect(planPageConversion({ ...pageDoc([]), transcript: undefined })).toEqual(empty);
    expect(planPageConversion(null)).toEqual(empty);
  });

  it('skips a line with no id', () => {
    expect(planPageConversion(pageDoc([line(undefined, '☐ x')])).changes).toEqual([]);
  });
});

describe('applyPageConversion', () => {
  const NOW = '2026-10-22T12:00:00.000Z';

  it('changes only text and checked on planned lines, and bumps lastUpdated only', () => {
    const doc = pageDoc(
      [line('h', 'Heading'), line('a', '☐ Call Troy', null, { indentLevel: 1, parentId: 'h' })],
      { strokes: [{ id: 's1', startTime: 1, endTime: 2, lineId: 'a', points: [[1, 5], [2, 6]] }] }
    );
    const { changes } = planPageConversion(doc);
    const { doc: next, applied, skipped } = applyPageConversion(doc, changes, NOW);

    expect(applied).toBe(1);
    expect(skipped).toBe(0);
    expect(next.transcript.lines).toEqual([
      line('h', 'Heading'),
      line('a', 'Call Troy', false, { indentLevel: 1, parentId: 'h' }),
    ]);
    expect(next.metadata.lastUpdated).toBe(NOW);
    expect(next.transcript.lastTranscribed).toBe(doc.transcript.lastTranscribed);
    expect(next.strokes).toBe(doc.strokes);
    expect(next.pageInfo).toBe(doc.pageInfo);
  });

  it('does not mutate the input doc', () => {
    const doc = pageDoc([line('a', '☐ Call Troy')]);
    const before = JSON.stringify(doc);
    applyPageConversion(doc, planPageConversion(doc).changes, NOW);
    expect(JSON.stringify(doc)).toBe(before);
  });

  it('skips a line edited since the plan, and returns the doc as is when nothing applies', () => {
    const planned = pageDoc([line('a', '☐ Call Troy')]);
    const { changes } = planPageConversion(planned);
    const edited = pageDoc([line('a', '☐ Call Troy tomorrow')]);
    const result = applyPageConversion(edited, changes, NOW);
    expect(result).toEqual({ doc: edited, applied: 0, skipped: 1 });
    expect(result.doc).toBe(edited);
  });

  it('handles no changes', () => {
    const doc = pageDoc([line('a', 'plain')]);
    expect(applyPageConversion(doc, [], NOW)).toEqual({ doc, applied: 0, skipped: 0 });
  });

  it('cannot change whether the Library trusts the page\'s line links', () => {
    // A page matched by the fixed code: its stroke sits on its line's Ncode Y,
    // well clear of the raw millimetre yBounds the pre-fix signature looks for.
    const strokes = [{ id: 's1', startTime: 1, endTime: 2, lineId: 'a', points: [[1, 40], [2, 43]] }];
    const trusted = pageDoc([line('a', '☐ Call Troy')], { strokes });
    const stale = pageDoc([line('a', '☐ Call Troy')], {
      strokes,
      transcript: { lastTranscribed: '2026-05-28T00:00:00.000Z', lines: [line('a', '☐ Call Troy')] },
    });
    for (const doc of [trusted, stale]) {
      const { doc: next } = applyPageConversion(doc, planPageConversion(doc).changes, NOW);
      expect(isTrustworthyTranscript(next)).toBe(isTrustworthyTranscript(doc));
    }
    expect(isTrustworthyTranscript(trusted)).toBe(true);
    expect(isTrustworthyTranscript(stale)).toBe(false);
  });
});

describe('summarizeConversion', () => {
  it('counts lines, pages, TODO / DONE and conflicts, with one row per line', () => {
    const c = (lineId, checked) => ({ lineId, oldText: 'x', newText: 'x', checked, wasSet: false });
    const s = summarizeConversion([
      { book: '3017', pageId: '142', changes: [c('a', false), c('b', true)], conflicts: [] },
      { book: '387', pageId: '29', changes: [], conflicts: [{ lineId: 'z', text: '☐ z', checked: true, marker: false }] },
      { book: '553', pageId: '1', changes: [c('d', true)], conflicts: [] },
    ]);
    expect(s).toMatchObject({ lines: 3, pages: 2, todo: 1, done: 2, conflicts: 1 });
    expect(s.rows.map((r) => `${r.book}/${r.pageId}/${r.lineId}`)).toEqual(['3017/142/a', '3017/142/b', '553/1/d']);
  });

  it('is all zeros for no pages', () => {
    expect(summarizeConversion([])).toEqual({ lines: 0, pages: 0, todo: 0, done: 0, conflicts: 0, rows: [] });
  });
});
