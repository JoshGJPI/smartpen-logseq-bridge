/**
 * Tests for lib/point-edit.js and the point-removal helper in stores/strokes.js.
 *
 * What matters here:
 *   - detectStrayPoints finds the origin dot that draws a line to the page corner,
 *     and doesn't cry wolf on ordinary handwriting
 *   - removePointsFromStroke keeps the stroke's identity (startTime, and so its
 *     `s{startTime}` id) and every surviving point's pen force, drops the derived
 *     caches, and refuses to leave a stroke with fewer than two points
 *   - removeStrokePoints (store) marks the session dirty, tags edited strokes with
 *     the `pointsEdited` intent marker the save path gates on, and reports the
 *     strokes it refused
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
  MIN_STROKE_POINTS,
  detectStrayPoints,
  detectStrayPointsForStrokes,
  removePointsFromStroke,
  groupPointKeys,
  pointKey,
  parsePointKey,
  formatPointCoords
} from '../point-edit.js';

/** Canvas-format stroke. `dots` are [x, y, f?] triples. */
function makeStroke(dots, extra = {}) {
  return {
    pageInfo: { section: 3, owner: 1012, book: 3017, page: 124 },
    startTime: 1000,
    endTime: 1500,
    dotArray: dots.map(([x, y, f], i) => ({
      x,
      y,
      f: f === undefined ? 300 : f,
      timestamp: 1000 + i,
      dotType: i === 0 ? 0 : i === dots.length - 1 ? 2 : 1
    })),
    ...extra
  };
}

/** A plausible bit of handwriting: evenly spaced points along a curve. */
function smoothStroke(count = 20) {
  const dots = [];
  for (let i = 0; i < count; i++) {
    dots.push([40 + i * 0.4, 50 + Math.sin(i / 3) * 0.8]);
  }
  return makeStroke(dots);
}

describe('detectStrayPoints', () => {
  it('finds an exact (0, 0) point in the middle of a stroke', () => {
    const stroke = smoothStroke(12);
    stroke.dotArray[5] = { x: 0, y: 0, f: 0, timestamp: 1005, dotType: 1 };

    const strays = detectStrayPoints(stroke);
    expect(strays).toHaveLength(1);
    expect(strays[0]).toEqual({ index: 5, reason: 'origin' });
  });

  it('finds an origin point at the very start (the pen-down case)', () => {
    const stroke = smoothStroke(12);
    stroke.dotArray[0] = { x: 0, y: 0, f: 0, timestamp: 1000, dotType: 0 };
    expect(detectStrayPoints(stroke).map(s => s.index)).toEqual([0]);
  });

  it('treats a near-origin point inside the tolerance as at the origin', () => {
    const stroke = smoothStroke(12);
    stroke.dotArray[3] = { x: 0.2, y: 0.4, f: 5, timestamp: 1003, dotType: 1 };
    expect(detectStrayPoints(stroke)[0]).toEqual({ index: 3, reason: 'origin' });
  });

  it('flags a non-finite coordinate', () => {
    const stroke = smoothStroke(12);
    stroke.dotArray[7] = { x: NaN, y: 50, f: 100, timestamp: 1007, dotType: 1 };
    expect(detectStrayPoints(stroke).map(s => s.index)).toEqual([7]);
  });

  it('reports nothing for ordinary handwriting', () => {
    expect(detectStrayPoints(smoothStroke(30))).toEqual([]);
  });

  it('flags an interior point that darts away and comes straight back', () => {
    // Not at the origin, but 40mm off a stroke whose points are 0.4mm apart.
    const stroke = smoothStroke(12);
    stroke.dotArray[6] = { x: 120, y: 12, f: 200, timestamp: 1006, dotType: 1 };

    const strays = detectStrayPoints(stroke);
    expect(strays).toHaveLength(1);
    expect(strays[0]).toEqual({ index: 6, reason: 'jump' });
  });

  it('does not flag an interior point that is merely part of a fast movement', () => {
    // One long step, but the point continues from there rather than returning:
    // that's a fast pen, not a bad sample.
    const stroke = makeStroke([
      [40, 50], [40.4, 50], [40.8, 50], [50, 50], [50.4, 50], [50.8, 50], [51.2, 50]
    ]);
    expect(detectStrayPoints(stroke)).toEqual([]);
  });

  it('does not flag the tail of a short flick stroke', () => {
    // A comma: points 0.2mm apart, then a 3mm tail. That's a 15x jump by the
    // relative measure alone, but 3mm is nowhere near far enough to be a bad
    // sample — and this shape is everywhere in real handwriting.
    const stroke = makeStroke([
      [40, 50], [40.2, 50.2], [40.4, 50.5], [40.5, 50.9], [42.5, 53.2]
    ]);
    expect(detectStrayPoints(stroke)).toEqual([]);
  });

  it('still flags a jump once it clears the absolute floor', () => {
    const stroke = makeStroke([
      [40, 50], [40.2, 50.2], [40.4, 50.5], [40.5, 50.9], [80, 95]
    ]);
    expect(detectStrayPoints(stroke).map(s => s.index)).toEqual([4]);
  });

  it('leaves very short strokes to the origin test alone', () => {
    // Three points give no meaningful "typical" spacing, so the jump test stays
    // out of it — otherwise every short tick mark would be suspect.
    const stroke = makeStroke([[40, 50], [90, 20], [41, 50]]);
    expect(detectStrayPoints(stroke)).toEqual([]);
  });

  it('handles an empty stroke', () => {
    expect(detectStrayPoints({ dotArray: [] })).toEqual([]);
  });

  it('reports the same point once when both detectors would fire', () => {
    // An origin point in an otherwise tight stroke is also a huge jump.
    const stroke = smoothStroke(12);
    stroke.dotArray[4] = { x: 0, y: 0, f: 0, timestamp: 1004, dotType: 1 };
    const strays = detectStrayPoints(stroke);
    expect(strays).toHaveLength(1);
    expect(strays[0].reason).toBe('origin'); // the specific reason wins
  });
});

describe('detectStrayPointsForStrokes', () => {
  it('carries the stroke index and the offending dot through', () => {
    const clean = smoothStroke(10);
    const dirty = smoothStroke(10);
    dirty.dotArray[2] = { x: 0, y: 0, f: 0, timestamp: 1002, dotType: 1 };

    const found = detectStrayPointsForStrokes([
      { strokeIndex: 4, stroke: clean },
      { strokeIndex: 9, stroke: dirty }
    ]);

    expect(found).toHaveLength(1);
    expect(found[0].strokeIndex).toBe(9);
    expect(found[0].pointIndex).toBe(2);
    expect(found[0].dot).toEqual({ x: 0, y: 0, f: 0, timestamp: 1002, dotType: 1 });
  });

  it('returns an empty array for no entries', () => {
    expect(detectStrayPointsForStrokes([])).toEqual([]);
    expect(detectStrayPointsForStrokes(null)).toEqual([]);
  });
});

describe('removePointsFromStroke', () => {
  it('removes the named point and leaves the rest in order', () => {
    const stroke = makeStroke([[1, 1], [0, 0], [3, 3], [4, 4]]);
    const { stroke: next, removed, remaining } = removePointsFromStroke(stroke, [1]);

    expect(removed).toBe(1);
    expect(remaining).toBe(3);
    expect(next.dotArray.map(d => [d.x, d.y])).toEqual([[1, 1], [3, 3], [4, 4]]);
  });

  it('keeps startTime and endTime when the FIRST point goes', () => {
    // The stroke id is `s{startTime}`; re-deriving it would orphan the stroke
    // from its transcript line and re-import it as a duplicate.
    const stroke = makeStroke([[0, 0], [2, 2], [3, 3]]);
    const { stroke: next } = removePointsFromStroke(stroke, [0]);

    expect(next.startTime).toBe(1000);
    expect(next.endTime).toBe(1500);
  });

  it('keeps startTime and endTime when the LAST point goes', () => {
    const stroke = makeStroke([[1, 1], [2, 2], [0, 0]]);
    const { stroke: next } = removePointsFromStroke(stroke, [2]);
    expect(next.startTime).toBe(1000);
    expect(next.endTime).toBe(1500);
  });

  it('preserves each surviving point\'s pen force', () => {
    // Force is what drives sketch thickness; losing it would flatten the line.
    const stroke = makeStroke([[1, 1, 120], [0, 0, 0], [3, 3, 880]]);
    const { stroke: next } = removePointsFromStroke(stroke, [1]);
    expect(next.dotArray.map(d => d.f)).toEqual([120, 880]);
  });

  it('preserves the sketch flag', () => {
    const stroke = makeStroke([[1, 1], [0, 0], [3, 3]], { sketch: true });
    expect(removePointsFromStroke(stroke, [1]).stroke.sketch).toBe(true);
  });

  it('re-tags dotType so the first is pen-down and the last pen-up', () => {
    const stroke = makeStroke([[0, 0], [2, 2], [3, 3], [9, 9]]);
    const { stroke: next } = removePointsFromStroke(stroke, [0, 3]);
    expect(next.dotArray.map(d => d.dotType)).toEqual([0, 2]);
  });

  it('leaves dots that never carried a dotType alone', () => {
    const stroke = { startTime: 1, dotArray: [{ x: 1, y: 1 }, { x: 0, y: 0 }, { x: 3, y: 3 }] };
    const { stroke: next } = removePointsFromStroke(stroke, [1]);
    expect(next.dotArray[0]).not.toHaveProperty('dotType');
  });

  it('drops the derived caches computed from the old geometry', () => {
    const stroke = makeStroke([[1, 1], [0, 0], [3, 3]]);
    stroke._nb = { minX: 0, minY: 0, maxX: 3, maxY: 3 };
    stroke._sw = { key: 'profile', widths: [1, 2, 3] };

    const { stroke: next } = removePointsFromStroke(stroke, [1]);
    expect(next).not.toHaveProperty('_nb');
    expect(next).not.toHaveProperty('_sw');
  });

  it('does not mutate the original stroke', () => {
    const stroke = makeStroke([[1, 1], [0, 0], [3, 3]]);
    removePointsFromStroke(stroke, [1]);
    expect(stroke.dotArray).toHaveLength(3);
  });

  it('refuses a removal that would leave fewer than two points', () => {
    const stroke = makeStroke([[1, 1], [0, 0], [3, 3]]);
    const result = removePointsFromStroke(stroke, [0, 1]);

    expect(result.stroke).toBeNull();
    expect(result.remaining).toBe(1);
    expect(result.remaining).toBeLessThan(MIN_STROKE_POINTS);
  });

  it('is a no-op for an empty index list or an out-of-range index', () => {
    const stroke = makeStroke([[1, 1], [2, 2]]);
    expect(removePointsFromStroke(stroke, []).removed).toBe(0);
    expect(removePointsFromStroke(stroke, [99]).removed).toBe(0);
    expect(removePointsFromStroke(stroke, [99]).stroke).toBe(stroke);
  });

  it('accepts a Set as well as an array', () => {
    const stroke = makeStroke([[1, 1], [0, 0], [3, 3]]);
    expect(removePointsFromStroke(stroke, new Set([1])).removed).toBe(1);
  });
});

describe('point keys', () => {
  it('round-trips a key', () => {
    expect(parsePointKey(pointKey(12, 3))).toEqual({ strokeIndex: 12, pointIndex: 3 });
  });

  it('rejects a malformed key', () => {
    expect(parsePointKey('nope')).toBeNull();
    expect(parsePointKey('1:2:3')).toBeNull();
  });

  it('groups keys by stroke', () => {
    const grouped = groupPointKeys(['4:1', '4:7', '9:0', 'junk']);
    expect([...grouped.keys()]).toEqual([4, 9]);
    expect([...grouped.get(4)]).toEqual([1, 7]);
    expect([...grouped.get(9)]).toEqual([0]);
  });

  it('formats coordinates to 2dp', () => {
    expect(formatPointCoords({ x: 6.5555, y: 37.2 })).toBe('6.56, 37.20');
    expect(formatPointCoords(null)).toBe('—');
  });
});

describe('removeStrokePoints (store)', () => {
  let strokesStore;
  let removeStrokePoints;
  let clearPointEditMarkers;
  let markUnsavedChanges;

  beforeEach(async () => {
    vi.resetModules();
    markUnsavedChanges = vi.fn();
    vi.doMock('$stores/storage.js', () => ({ markUnsavedChanges }));
    // strokes.js imports './storage.js' relative to itself.
    vi.doMock('../../stores/storage.js', () => ({ markUnsavedChanges }));

    const mod = await import('$stores/strokes.js');
    strokesStore = mod.strokes;
    removeStrokePoints = mod.removeStrokePoints;
    clearPointEditMarkers = mod.clearPointEditMarkers;
    strokesStore.set([]);
  });

  it('removes points from the addressed stroke only', () => {
    strokesStore.set([
      makeStroke([[1, 1], [0, 0], [3, 3]]),
      makeStroke([[5, 5], [6, 6], [7, 7]])
    ]);

    const result = removeStrokePoints(new Map([[0, new Set([1])]]));

    expect(result.removedPoints).toBe(1);
    expect(result.editedStrokes).toBe(1);
    expect(result.editedIds).toEqual(['s1000']);
    expect(get(strokesStore)[0].dotArray).toHaveLength(2);
    expect(get(strokesStore)[1].dotArray).toHaveLength(3);
  });

  it('tags the edited stroke with the pointsEdited intent marker', () => {
    // This marker is the ONLY thing that lets a save rewrite stored geometry.
    strokesStore.set([makeStroke([[1, 1], [0, 0], [3, 3]])]);
    removeStrokePoints(new Map([[0, [1]]]));
    expect(get(strokesStore)[0].pointsEdited).toBe(true);
  });

  it('marks the session dirty', () => {
    strokesStore.set([makeStroke([[1, 1], [0, 0], [3, 3]])]);
    removeStrokePoints(new Map([[0, [1]]]));
    expect(markUnsavedChanges).toHaveBeenCalled();
  });

  it('does not mark the session dirty when nothing was removed', () => {
    strokesStore.set([makeStroke([[1, 1], [2, 2]])]);
    const result = removeStrokePoints(new Map([[0, [99]]]));
    expect(result.removedPoints).toBe(0);
    expect(markUnsavedChanges).not.toHaveBeenCalled();
  });

  it('refuses to reduce a stroke below two points and leaves it untouched', () => {
    strokesStore.set([makeStroke([[1, 1], [0, 0], [3, 3]])]);
    const result = removeStrokePoints(new Map([[0, [0, 1]]]));

    expect(result.removedPoints).toBe(0);
    expect(result.refused).toEqual([{ strokeIndex: 0, remaining: 1 }]);
    expect(get(strokesStore)[0].dotArray).toHaveLength(3);
    expect(get(strokesStore)[0]).not.toHaveProperty('pointsEdited');
  });

  it('edits the strokes it can while refusing the ones it cannot', () => {
    strokesStore.set([
      makeStroke([[1, 1], [0, 0], [3, 3], [4, 4]]), // survives
      makeStroke([[5, 5], [0, 0]])                  // would drop to 1 point
    ]);

    const result = removeStrokePoints(new Map([[0, [1]], [1, [1]]]));

    expect(result.removedPoints).toBe(1);
    expect(result.refused).toHaveLength(1);
    expect(get(strokesStore)[0].dotArray).toHaveLength(3);
    expect(get(strokesStore)[1].dotArray).toHaveLength(2);
  });

  it('handles an empty edit map', () => {
    strokesStore.set([makeStroke([[1, 1], [2, 2]])]);
    expect(removeStrokePoints(new Map()).removedPoints).toBe(0);
    expect(removeStrokePoints(null).removedPoints).toBe(0);
  });

  it('clears the intent marker for a saved page only', () => {
    const onPage124 = makeStroke([[1, 1], [0, 0], [3, 3]]);
    const onPage125 = makeStroke([[1, 1], [0, 0], [3, 3]]);
    onPage125.pageInfo = { section: 3, owner: 1012, book: 3017, page: 125 };
    strokesStore.set([onPage124, onPage125]);

    removeStrokePoints(new Map([[0, [1]], [1, [1]]]));
    const cleared = clearPointEditMarkers(3017, 124);

    expect(cleared).toBe(1);
    expect(get(strokesStore)[0]).not.toHaveProperty('pointsEdited');
    expect(get(strokesStore)[1].pointsEdited).toBe(true);
  });

  it('is a no-op when a page has no markers to clear', () => {
    strokesStore.set([makeStroke([[1, 1], [2, 2]])]);
    expect(clearPointEditMarkers(3017, 124)).toBe(0);
  });
});

describe('point-edit store (mode + selection)', () => {
  let mod;
  let strokesStore;
  let selectedIndices;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('../../stores/storage.js', () => ({ markUnsavedChanges: vi.fn() }));

    const strokesMod = await import('$stores/strokes.js');
    const selectionMod = await import('$stores/selection.js');
    mod = await import('$stores/point-edit.js');

    strokesStore = strokesMod.strokes;
    selectedIndices = selectionMod.selectedIndices;

    strokesStore.set([]);
    selectedIndices.set(new Set());
    mod.exitPointEditMode();
  });

  /** Two strokes, the second carrying a stray origin point. */
  function seedCanvas() {
    strokesStore.set([
      makeStroke([[40, 50], [40.4, 50.2], [40.8, 50.4], [41.2, 50.6]]),
      makeStroke([[42, 51], [0, 0], [42.8, 51.4], [43.2, 51.6]])
    ]);
  }

  it('refuses to enter with nothing selected', () => {
    seedCanvas();
    expect(mod.enterPointEditMode()).toEqual({ ok: false, reason: 'no-selection' });
    expect(get(mod.pointEditMode)).toBe(false);
  });

  it('refuses to enter with more strokes than the cap', () => {
    strokesStore.set(Array.from({ length: 200 }, () => makeStroke([[1, 1], [2, 2]])));
    selectedIndices.set(new Set(Array.from({ length: 200 }, (_, i) => i)));

    const result = mod.enterPointEditMode();
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('too-many');
    expect(get(mod.pointEditMode)).toBe(false);
  });

  it('exposes the selected strokes and their total point count', () => {
    seedCanvas();
    selectedIndices.set(new Set([0, 1]));
    mod.enterPointEditMode();

    expect(get(mod.pointEditStrokes).map(e => e.strokeIndex)).toEqual([0, 1]);
    expect(get(mod.pointEditPointCount)).toBe(8);
  });

  it('exposes nothing while the mode is off', () => {
    seedCanvas();
    selectedIndices.set(new Set([0, 1]));
    expect(get(mod.pointEditStrokes)).toEqual([]);
  });

  it('detects the stray point in the selected strokes only', () => {
    seedCanvas();
    selectedIndices.set(new Set([0])); // the clean stroke
    mod.enterPointEditMode();
    expect(get(mod.strayPoints)).toEqual([]);

    selectedIndices.set(new Set([0, 1]));
    const strays = get(mod.strayPoints);
    expect(strays).toHaveLength(1);
    expect(strays[0]).toMatchObject({ strokeIndex: 1, pointIndex: 1, reason: 'origin' });
    expect(get(mod.strayPointKeys).has('1:1')).toBe(true);
  });

  it('drops point keys whose stroke leaves the selection', () => {
    // Otherwise a later Delete would act on a point with no handle on screen.
    seedCanvas();
    selectedIndices.set(new Set([0, 1]));
    mod.enterPointEditMode();
    mod.selectPoints([{ strokeIndex: 0, pointIndex: 1 }, { strokeIndex: 1, pointIndex: 1 }]);
    expect(get(mod.selectedPointCount)).toBe(2);

    selectedIndices.set(new Set([1]));
    expect([...get(mod.selectedPoints)]).toEqual(['1:1']);
  });

  it('leaves the mode when the stroke selection empties', () => {
    seedCanvas();
    selectedIndices.set(new Set([0]));
    mod.enterPointEditMode();

    selectedIndices.set(new Set());
    expect(get(mod.pointEditMode)).toBe(false);
    expect(get(mod.selectedPointCount)).toBe(0);
  });

  it('toggles the mode', () => {
    seedCanvas();
    selectedIndices.set(new Set([0]));

    expect(mod.togglePointEditMode()).toMatchObject({ entered: true });
    expect(get(mod.pointEditMode)).toBe(true);
    expect(mod.togglePointEditMode()).toMatchObject({ entered: false });
    expect(get(mod.pointEditMode)).toBe(false);
  });

  it('selects the stray points on request', () => {
    seedCanvas();
    selectedIndices.set(new Set([0, 1]));
    mod.enterPointEditMode();

    expect(mod.selectStrayPoints()).toBe(1);
    expect([...get(mod.selectedPoints)]).toEqual(['1:1']);
  });

  it('deletes the selected points and clears the point selection', () => {
    // The selection has to go: indices shift, so surviving keys would point at
    // different points than the user picked.
    seedCanvas();
    selectedIndices.set(new Set([0, 1]));
    mod.enterPointEditMode();
    mod.selectPoint(1, 1, 'replace');

    const result = mod.deleteSelectedPoints();

    expect(result.removedPoints).toBe(1);
    expect(result.editedIds).toEqual(['s1000']);
    expect(get(strokesStore)[1].dotArray).toHaveLength(3);
    expect(get(mod.selectedPointCount)).toBe(0);
  });

  it('deletes every stray point in one action', () => {
    seedCanvas();
    selectedIndices.set(new Set([0, 1]));
    mod.enterPointEditMode();

    const result = mod.deleteStrayPoints();

    expect(result.removedPoints).toBe(1);
    expect(get(strokesStore)[1].dotArray.some(d => d.x === 0 && d.y === 0)).toBe(false);
    expect(get(mod.strayPoints)).toEqual([]); // nothing left to flag
  });

  it('does nothing when asked to delete with no points selected', () => {
    seedCanvas();
    selectedIndices.set(new Set([0]));
    mod.enterPointEditMode();

    expect(mod.deleteSelectedPoints().removedPoints).toBe(0);
    expect(get(strokesStore)[0].dotArray).toHaveLength(4);
  });
});

