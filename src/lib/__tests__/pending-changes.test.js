import { describe, it, expect } from 'vitest';
import { computePendingChangesMap } from '$stores/pending-changes.js';

/**
 * computePendingChangesMap is the pure core of the dirty-state diff. It used to
 * read whole stroke arrays off the logseqPages records; now it diffs canvas
 * strokes against a small on-disk stroke-id index. These tests pin that an
 * active canvas stroke counts as an "addition" only when it isn't already on
 * disk — the behaviour that drives the "Save Changes" label and the canvas
 * page-label asterisks.
 */

function stroke(book, page, startTime) {
  return { pageInfo: { book, page }, startTime, dotArray: [] };
}
const idOf = (startTime) => `s${startTime}`;
const onDisk = (entries) => new Map(entries.map(([k, ids]) => [k, new Set(ids)]));

describe('computePendingChangesMap', () => {
  it('returns an empty map when there are no canvas strokes', () => {
    const m = computePendingChangesMap([], new Set(), new Map(), new Set());
    expect(m.size).toBe(0);
  });

  it('treats every active stroke as an addition when the page is unknown on disk', () => {
    const strokes = [stroke(1, 5, 1000), stroke(1, 5, 2000)];
    const m = computePendingChangesMap(strokes, new Set(), new Map(), new Set());
    expect(m.get('B1/P5').additions).toEqual([0, 1]);
    expect(m.get('B1/P5').deletions).toEqual([]);
  });

  it('reports no changes when every active stroke already exists on disk', () => {
    const strokes = [stroke(1, 5, 1000), stroke(1, 5, 2000)];
    const ids = onDisk([['B1/P5', [idOf(1000), idOf(2000)]]]);
    const m = computePendingChangesMap(strokes, new Set(), ids, new Set());
    // No additions and no deletions → the page isn't in the changes map at all.
    expect(m.has('B1/P5')).toBe(false);
  });

  it('flags only the strokes that are not yet on disk as additions', () => {
    const strokes = [stroke(1, 5, 1000), stroke(1, 5, 2000), stroke(1, 5, 3000)];
    const ids = onDisk([['B1/P5', [idOf(1000)]]]); // only the first is saved
    const m = computePendingChangesMap(strokes, new Set(), ids, new Set());
    expect(m.get('B1/P5').additions).toEqual([1, 2]);
  });

  it('records deletions and excludes deleted strokes from additions', () => {
    const strokes = [stroke(1, 5, 1000), stroke(1, 5, 2000)];
    const ids = onDisk([['B1/P5', [idOf(1000), idOf(2000)]]]);
    const deleted = new Set([0]); // delete the first (on-disk) stroke
    const m = computePendingChangesMap(strokes, deleted, ids, new Set());
    expect(m.get('B1/P5').deletions).toEqual([0]);
    expect(m.get('B1/P5').additions).toEqual([]); // stroke 1 is on disk → not an addition
  });

  it('separates pages and reflects isSaved from savedPages', () => {
    const strokes = [stroke(1, 5, 1000), stroke(2, 9, 4000)];
    const m = computePendingChangesMap(strokes, new Set(), new Map(), new Set(['B1/P5']));
    expect(m.get('B1/P5').isSaved).toBe(true);
    expect(m.get('B2/P9').isSaved).toBe(false);
  });

  it('skips strokes without page info', () => {
    const strokes = [{ startTime: 1000, dotArray: [] }, stroke(1, 5, 2000)];
    const m = computePendingChangesMap(strokes, new Set(), new Map(), new Set());
    expect([...m.keys()]).toEqual(['B1/P5']);
    expect(m.get('B1/P5').additions).toEqual([1]); // index 1 is the only valid stroke
  });
});
