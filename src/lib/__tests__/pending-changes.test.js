import { describe, it, expect } from 'vitest';
import { computePendingChangesMap } from '$stores/pending-changes.js';

/**
 * computePendingChangesMap is the pure core of the dirty-state diff. It used to
 * read whole stroke arrays off the savedPages records; now it diffs canvas
 * strokes against a small on-disk stroke-state index. These tests pin that an
 * active canvas stroke counts as an "addition" only when it isn't already on
 * disk, and as a "modification" when it is on disk but its sketch flag has since
 * been toggled — the behaviour that drives the "Save Changes" label, the canvas
 * page-label asterisks and the save dialog's per-page diff.
 */

function stroke(book, page, startTime, extra = {}) {
  return { pageInfo: { book, page }, startTime, dotArray: [], ...extra };
}
const idOf = (startTime) => `s${startTime}`;

// Per-page on-disk state. Each stroke entry is either a bare id (stored with the
// sketch flag off) or an [id, { sketch }] pair.
const onDisk = (entries) => new Map(entries.map(([pageKey, strokeEntries]) => [
  pageKey,
  new Map(strokeEntries.map(e => (
    Array.isArray(e) ? [e[0], { sketch: !!e[1].sketch }] : [e, { sketch: false }]
  )))
]));

describe('computePendingChangesMap', () => {
  it('returns an empty map when there are no canvas strokes', () => {
    const m = computePendingChangesMap([], new Set(), new Map(), new Set());
    expect(m.size).toBe(0);
  });

  it('treats every active stroke as an addition when the page is unknown on disk', () => {
    const strokes = [stroke(1, 5, 1000), stroke(1, 5, 2000)];
    const m = computePendingChangesMap(strokes, new Set(), new Map(), new Set());
    expect(m.get('B1/P5').additions).toEqual([0, 1]);
    expect(m.get('B1/P5').modifications).toEqual([]);
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
    expect(m.get('B1/P5').modifications).toEqual([]);
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

  describe('sketch-flag modifications', () => {
    it('reports a stroke flagged as a sketch after it was saved unflagged', () => {
      const strokes = [stroke(1, 5, 1000, { sketch: true })];
      const ids = onDisk([['B1/P5', [idOf(1000)]]]); // stored with sketch off
      const m = computePendingChangesMap(strokes, new Set(), ids, new Set());
      expect(m.get('B1/P5').modifications).toEqual([0]);
      expect(m.get('B1/P5').additions).toEqual([]);
      expect(m.get('B1/P5').deletions).toEqual([]);
    });

    it('reports a stroke unflagged after it was saved as a sketch', () => {
      const strokes = [stroke(1, 5, 1000, { sketch: false })];
      const ids = onDisk([['B1/P5', [[idOf(1000), { sketch: true }]]]]);
      const m = computePendingChangesMap(strokes, new Set(), ids, new Set());
      expect(m.get('B1/P5').modifications).toEqual([0]);
      expect(m.get('B1/P5').additions).toEqual([]);
    });

    it('treats an absent flag and a false flag as the same state', () => {
      // `sketch` is omitted rather than written false, on disk and on the canvas.
      const strokes = [stroke(1, 5, 1000), stroke(1, 5, 2000, { sketch: false })];
      const ids = onDisk([['B1/P5', [idOf(1000), idOf(2000)]]]);
      const m = computePendingChangesMap(strokes, new Set(), ids, new Set());
      expect(m.has('B1/P5')).toBe(false); // no change at all
    });

    it('reports no change when the flag matches what is on disk', () => {
      const strokes = [stroke(1, 5, 1000, { sketch: true })];
      const ids = onDisk([['B1/P5', [[idOf(1000), { sketch: true }]]]]);
      const m = computePendingChangesMap(strokes, new Set(), ids, new Set());
      expect(m.has('B1/P5')).toBe(false);
    });

    it('counts a new flagged stroke once, as an addition only', () => {
      // Saving it writes the stroke and its flag together — counting it as both
      // an addition and a modification would double-report the same work.
      const strokes = [stroke(1, 5, 3000, { sketch: true })];
      const ids = onDisk([['B1/P5', [idOf(1000)]]]); // 3000 is not on disk
      const m = computePendingChangesMap(strokes, new Set(), ids, new Set());
      expect(m.get('B1/P5').additions).toEqual([0]);
      expect(m.get('B1/P5').modifications).toEqual([]);
    });

    it('reports no modifications when the page is unknown on disk', () => {
      // Nothing to differ from — every stroke is simply an addition.
      const strokes = [stroke(1, 5, 1000, { sketch: true })];
      const m = computePendingChangesMap(strokes, new Set(), new Map(), new Set());
      expect(m.get('B1/P5').additions).toEqual([0]);
      expect(m.get('B1/P5').modifications).toEqual([]);
    });

    it('ignores a flag change on a stroke marked for deletion', () => {
      const strokes = [stroke(1, 5, 1000, { sketch: true })];
      const ids = onDisk([['B1/P5', [idOf(1000)]]]);
      const m = computePendingChangesMap(strokes, new Set([0]), ids, new Set());
      expect(m.get('B1/P5').deletions).toEqual([0]);
      expect(m.get('B1/P5').modifications).toEqual([]);
    });

    it('classifies additions and modifications side by side on one page', () => {
      const strokes = [
        stroke(1, 5, 1000, { sketch: true }), // on disk unflagged → modification
        stroke(1, 5, 2000),                   // on disk, unchanged → neither
        stroke(1, 5, 3000)                    // not on disk → addition
      ];
      const ids = onDisk([['B1/P5', [idOf(1000), idOf(2000)]]]);
      const m = computePendingChangesMap(strokes, new Set(), ids, new Set());
      expect(m.get('B1/P5').modifications).toEqual([0]);
      expect(m.get('B1/P5').additions).toEqual([2]);
    });

    it('puts a page whose only change is a flag toggle into the changes map', () => {
      // The reporting gap this concept closes: without `modifications` the page
      // was absent here, so it got no asterisk and no save-dialog row.
      const strokes = [stroke(7, 12, 1000, { sketch: true })];
      const ids = onDisk([['B7/P12', [idOf(1000)]]]);
      const m = computePendingChangesMap(strokes, new Set(), ids, new Set(['B7/P12']));
      expect(m.has('B7/P12')).toBe(true);
      expect(m.get('B7/P12').isSaved).toBe(true);
    });
  });
});
