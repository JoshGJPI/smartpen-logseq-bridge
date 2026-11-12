import { describe, it, expect } from 'vitest';
import {
  groupPagesToSave, settledDeletionIndices, describePageSave,
  groupStrokesForTranscription, transcriptionPageKey, countPartlyLoadedPages
} from '../canvas-save-plan.js';

const stroke = (book, page, extra = {}) => ({
  pageInfo: { section: 3, owner: 1012, book, page }, startTime: 1, ...extra
});

describe('groupPagesToSave', () => {
  it('keeps only the selected pages', () => {
    const { pagesToSave } = groupPagesToSave([stroke('388', 1), stroke('388', 2), stroke('388', 1)], ['388-1']);
    expect([...pagesToSave.keys()]).toEqual(['388-1']);
    expect(pagesToSave.get('388-1')).toEqual({ book: '388', page: 1 });
  });

  it('force-includes a move source page and records where its strokes went', () => {
    const moved = stroke('388v2', 5, { movedFrom: { book: '388', page: 5 } });
    const { pagesToSave, moveSources } = groupPagesToSave([moved], ['388v2-5']);
    expect([...pagesToSave.keys()].sort()).toEqual(['388-5', '388v2-5']);
    expect([...moveSources.get('388-5').targets.values()]).toEqual([{ book: '388v2', page: 5 }]);
  });

  it('includes a move source even when nothing was selected', () => {
    const moved = stroke('388v2', 5, { movedFrom: { book: '388', page: 5 } });
    expect([...groupPagesToSave([moved], []).pagesToSave.keys()]).toEqual(['388-5']);
  });

  it('skips strokes without a page and handles empty input', () => {
    expect(groupPagesToSave([{ startTime: 1 }], ['x']).pagesToSave.size).toBe(0);
    expect(groupPagesToSave(null, null).pagesToSave.size).toBe(0);
  });
});

describe('settledDeletionIndices', () => {
  const strokes = [stroke('388', 1), stroke('388', 2), stroke('388', 1), stroke('388', 2)];

  it('returns only marks on saved pages, highest first', () => {
    expect(settledDeletionIndices(strokes, new Set([0, 1, 2]), new Set(['388-1']))).toEqual([2, 0]);
  });

  it('keeps every mark when no page was saved', () => {
    expect(settledDeletionIndices(strokes, new Set([0, 3]), new Set())).toEqual([]);
  });

  it('ignores a mark past the end of the array', () => {
    expect(settledDeletionIndices(strokes, new Set([9]), new Set(['388-1']))).toEqual([]);
  });
});

describe('describePageSave', () => {
  it('lists each kind of change and the total', () => {
    expect(describePageSave('B388/P1', { added: 3, deleted: 1, edited: 2, linesAdded: 1, total: 10 }))
      .toBe('Saved B388/P1: +3 new, 2 edited (points rewritten), -1 deleted, +1 transcript line, 10 strokes total');
  });

  it('takes retimes back out of added and deleted', () => {
    expect(describePageSave('B1/P1', { added: 2, deleted: 2, total: 5 }, { retimed: 2 }))
      .toBe('Saved B1/P1: 2 retimed, 5 strokes total');
  });

  it('notes moves and a transcript change without new lines', () => {
    expect(describePageSave('B1/P1', { transcriptChanged: true, total: 1 }, { movedAway: 4 }))
      .toBe('Saved B1/P1: →4 moved to another volume, transcript updated, 1 stroke total');
  });

  it('with nothing changed says only the total', () => {
    expect(describePageSave('B1/P1', { total: 0 })).toBe('Saved B1/P1: 0 strokes total');
  });
});

describe('groupStrokesForTranscription', () => {
  it('groups by page and sends only unlinked strokes', () => {
    const a = stroke('388', 1);
    const b = stroke('388', 1, { blockUuid: 'line-1' });
    const c = stroke('388v2', 1);
    const groups = groupStrokesForTranscription([a, b, c]);
    const p1 = groups.get('S3/O1012/B388/P1');
    expect(p1.allStrokes).toEqual([a, b]);
    expect(p1.untranscribedStrokes).toEqual([a]);
    expect(groups.get('S3/O1012/B388v2/P1').untranscribedStrokes).toEqual([c]);
  });

  it('keys a stroke without pageInfo as zeros', () => {
    expect([...groupStrokesForTranscription([{ startTime: 1 }]).keys()]).toEqual(['S0/O0/B0/P0']);
    expect(transcriptionPageKey(null)).toBe('S0/O0/B0/P0');
  });
});

describe('countPartlyLoadedPages', () => {
  it('counts distinct pages that have context ink', () => {
    const keys = new Set(['B388/P1', 'B388v2/P2']);
    expect(countPartlyLoadedPages([stroke('388', 1), stroke('388', 1), stroke('388', 3)], keys)).toBe(1);
  });

  it('is zero with no context ink', () => {
    expect(countPartlyLoadedPages([stroke('388', 1)], new Set())).toBe(0);
    expect(countPartlyLoadedPages([stroke('388', 1)], null)).toBe(0);
  });
});
