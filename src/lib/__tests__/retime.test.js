/**
 * Tests for lib/retime.js — shifting strokes in time (v3.6.0) — and the store
 * plumbing that turns a retime into "delete the old id, append the new one"
 * (stores/strokes.js retimeStrokes / clearRetimedMarkers, and the disk-id
 * readers in stores/pending-changes.js).
 *
 * The hazard all of this exists for: a stroke's id is `s{startTime}`, so a
 * retimed stroke saves under a NEW id, and under append-only the old copy stays
 * unless something names it for deletion.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('$lib/storage/local-store.js', () => ({
  getVolumes: vi.fn(),
  setActiveVolume: vi.fn(),
}));

import {
  strokeDiskId, isRetimable, shiftStroke, penPageKey, planRetime, findRetimeCollisions,
  retimeEntries, dropRetimedPenStrokes, formatShift
} from '$lib/retime.js';
import {
  strokes, retimeStrokes, clearRetimedMarkers, clearMovedFromMarkers, reassignVolume
} from '$stores/strokes.js';
import {
  deletedIndices, getDeletedStrokeIdsForPage, getMovedAwayStrokeIdsForPage,
  getRetimedAwayStrokeIdsForPage, computePendingChangesMap
} from '$stores/pending-changes.js';

const DAY = 86400000;

function s(book, page, startTime, extra = {}) {
  return {
    pageInfo: { section: 3, owner: 1012, book, page },
    startTime,
    endTime: startTime + 500,
    dotArray: [
      { x: 1, y: 2, f: 400, timestamp: startTime },
      { x: 2, y: 3, f: 410, timestamp: null },
      { x: 3, y: 4, f: 420, timestamp: startTime + 500 }
    ],
    ...extra
  };
}

beforeEach(() => {
  strokes.set([]);
  deletedIndices.set(new Set());
});

describe('shiftStroke', () => {
  it('moves start, end and numeric point timestamps; leaves the rest alone', () => {
    const before = s('388', 41, 1000, { sketch: true, blockUuid: 'line-1' });
    const after = shiftStroke(before, 5000);
    expect(after.startTime).toBe(6000);
    expect(after.endTime).toBe(6500);
    expect(after.dotArray.map((d) => d.timestamp)).toEqual([6000, null, 6500]);
    expect(after.dotArray.map((d) => [d.x, d.y, d.f])).toEqual(before.dotArray.map((d) => [d.x, d.y, d.f]));
    expect(after.sketch).toBe(true);
    expect(after.blockUuid).toBe('line-1');
    expect(after.pageInfo).toBe(before.pageInfo);
    expect(before.startTime).toBe(1000);   // not mutated
  });

  it('stamps the disk id once and keeps the first one across repeat shifts', () => {
    const once = shiftStroke(s('388', 41, 1000), 5000);
    expect(once.retimedFrom).toEqual({ id: 's1000' });
    const twice = shiftStroke(once, 5000);
    expect(twice.retimedFrom).toEqual({ id: 's1000' });
    expect(strokeDiskId(twice)).toBe('s1000');
  });

  it('drops the marker when shifted back to its disk id', () => {
    const back = shiftStroke(shiftStroke(s('388', 41, 1000), 5000), -5000);
    expect(back.retimedFrom).toBeUndefined();
    expect(strokeDiskId(back)).toBe('s1000');
  });

  it('Δ = 0 is the same stroke', () => {
    const x = s('388', 41, 1000);
    expect(shiftStroke(x, 0)).toBe(x);
  });
});

describe('isRetimable', () => {
  it('needs a page and a real start time, and refuses pasted strokes', () => {
    expect(isRetimable(s('388', 41, 1000))).toBe(true);
    expect(isRetimable(s('388', 41, 1000, { _pasted: true }))).toBe(false);
    expect(isRetimable({ ...s('388', 41, 1000), pageInfo: null })).toBe(false);
    expect(isRetimable(s('388', 41, 0))).toBe(false);
    expect(isRetimable(null)).toBe(false);
  });
});

describe('penPageKey', () => {
  it('is the NCode book and integer page, whatever the volume', () => {
    expect(penPageKey({ book: '388v2', page: 41 })).toBe('388/41');
    expect(penPageKey({ book: 388, page: 41 })).toBe('388/41');
    expect(penPageKey({ book: 'nope', page: 41 })).toBeNull();
  });
});

describe('planRetime', () => {
  const arr = [
    s('388', 41, 10 * DAY),            // 0 selected, earliest
    s('388', 41, 10 * DAY + 60000),    // 1 selected
    s('388', 41, 3 * DAY),             // 2 not selected
    s('388', 42, 10 * DAY + 120000),   // 3 selected
    s('388', 41, 9 * DAY, { _pasted: true })   // 4 selected but pasted
  ];

  it('finds the earliest and latest of the retimable selection', () => {
    const p = planRetime(arr, [0, 1, 3, 4]);
    expect(p.indices).toEqual([0, 1, 3]);
    expect(p.skipped).toBe(1);
    expect(p.earliest).toBe(10 * DAY);
    expect(p.latest).toBe(10 * DAY + 120500);
    expect(p.delta).toBe(0);
  });

  it('works out the shift and each page’s capture days before and after', () => {
    const p = planRetime(arr, [0, 1, 3], 20 * DAY + 3600000);
    expect(p.delta).toBe(10 * DAY + 3600000);
    const p41 = p.pages.find((x) => x.key === 'B388/P41');
    expect(p41.selected).toBe(2);
    expect(p41.total).toBe(4);
    expect(p41.daysBefore.length).toBe(3);   // days 3, 9 (pasted, unselected) and 10
    expect(p41.daysAfter.length).toBe(3);    // days 3, 9 and 20
    expect(p.pages.map((x) => x.key)).toEqual(['B388/P41', 'B388/P42']);
  });

  it('an empty selection plans nothing', () => {
    const p = planRetime(arr, []);
    expect(p.indices).toEqual([]);
    expect(p.earliest).toBeNull();
    expect(p.pages).toEqual([]);
  });
});

describe('findRetimeCollisions', () => {
  it('finds a stroke landing on an unselected stroke’s id', () => {
    const arr = [s('388', 41, 1000), s('388', 41, 2000)];
    expect(findRetimeCollisions(arr, [0], 1000, new Map())).toEqual([{ index: 0, page: 'B388/P41', id: 's2000' }]);
  });

  it('finds a stroke landing on an id only on disk', () => {
    const arr = [s('388', 41, 1000)];
    const disk = new Map([['B388/P41', new Set(['s1000', 's5000'])]]);
    expect(findRetimeCollisions(arr, [0], 4000, disk)).toHaveLength(1);
  });

  it('a selected stroke may land on an id another selected stroke vacates', () => {
    const arr = [s('388', 41, 1000), s('388', 41, 2000)];
    const disk = new Map([['B388/P41', new Set(['s1000', 's2000'])]]);
    expect(findRetimeCollisions(arr, [0, 1], 1000, disk)).toEqual([]);
  });

  it('an id vacated by an earlier unsaved retime is free', () => {
    const arr = [shiftStroke(s('388', 41, 1000), 9000), s('388', 41, 2000)];
    const disk = new Map([['B388/P41', new Set(['s1000', 's2000'])]]);
    expect(findRetimeCollisions(arr, [1], -1000, disk)).toEqual([]);
  });

  it('ids are per page', () => {
    const arr = [s('388', 41, 1000), s('388', 42, 2000)];
    expect(findRetimeCollisions(arr, [0], 1000, new Map())).toEqual([]);
  });
});

describe('retimeEntries / dropRetimedPenStrokes', () => {
  it('records pen page, old id and new id for each retimed stroke', () => {
    const arr = [shiftStroke(s('388v2', 41, 1000), 5000), s('388', 41, 2000)];
    expect(retimeEntries(arr)).toEqual([{ page: '388/41', from: 's1000', to: 's6000' }]);
  });

  it('drops exactly the pen strokes whose id was retimed away on that page', () => {
    const pen = [
      { pageInfo: { book: 388, page: 41 }, startTime: 1000 },
      { pageInfo: { book: 388, page: 41 }, startTime: 2000 },
      { pageInfo: { book: 388, page: 42 }, startTime: 1000 }
    ];
    const { kept, dropped } = dropRetimedPenStrokes(pen, { '388/41': { s1000: 's6000' } });
    expect(dropped).toBe(1);
    expect(kept.map((x) => `${x.pageInfo.page}:${x.startTime}`)).toEqual(['41:2000', '42:1000']);
  });

  it('an empty sidecar keeps everything', () => {
    const pen = [{ pageInfo: { book: 388, page: 41 }, startTime: 1000 }];
    expect(dropRetimedPenStrokes(pen, {})).toEqual({ kept: pen, dropped: 0 });
  });
});

describe('formatShift', () => {
  it('reads as days, hours, minutes, seconds', () => {
    expect(formatShift(11 * DAY + 4 * 3600000 + 53 * 60000 + 12000)).toBe('+11 d 4 h 53 min 12 s');
    expect(formatShift(-3600000)).toBe('−1 h');
    expect(formatShift(0)).toBe('0 s');
    expect(formatShift(1)).toBe('+1 ms');
  });
});

describe('retimeStrokes (store)', () => {
  it('shifts only the given, retimable strokes and keeps their positions', () => {
    strokes.set([s('388', 41, 1000), s('388', 41, 2000), s('388', 41, 3000, { _pasted: true })]);
    const r = retimeStrokes([0, 2], 5000);
    expect(r).toEqual({ retimed: 1, skipped: 1 });
    const out = get(strokes);
    expect(out.map((x) => x.startTime)).toEqual([6000, 2000, 3000]);
    expect(out[0].retimedFrom).toEqual({ id: 's1000' });
  });

  it('a zero shift does nothing', () => {
    strokes.set([s('388', 41, 1000)]);
    expect(retimeStrokes([0], 0).retimed).toBe(0);
    expect(get(strokes)[0].retimedFrom).toBeUndefined();
  });
});

describe('disk ids after a retime', () => {
  it('the save removes the old id (retimed-away)', () => {
    strokes.set([s('388', 41, 1000), s('388', 41, 2000)]);
    retimeStrokes([0], 5000);
    expect([...getRetimedAwayStrokeIdsForPage('388', 41)]).toEqual(['s1000']);
    expect(getRetimedAwayStrokeIdsForPage('388', 42).size).toBe(0);
  });

  // Without strokeDiskId these two would name the NEW id, which isn't on disk,
  // and the old copy would survive the deletion or the move.
  it('deleting a retimed stroke deletes its old id', () => {
    strokes.set([s('388', 41, 1000)]);
    retimeStrokes([0], 5000);
    deletedIndices.set(new Set([0]));
    expect([...getDeletedStrokeIdsForPage('388', 41)]).toEqual(['s1000']);
    // and it isn't also counted as retimed-away
    expect(getRetimedAwayStrokeIdsForPage('388', 41).size).toBe(0);
  });

  it('moving a retimed stroke to another volume moves its old id off the source', () => {
    strokes.set([s('388', 41, 1000)]);
    retimeStrokes([0], 5000);
    reassignVolume([0], 2);
    expect([...getMovedAwayStrokeIdsForPage('388', 41)]).toEqual(['s1000']);
    // the source page's move-away handles it, not the retime path on the target
    expect(getRetimedAwayStrokeIdsForPage('388v2', 41).size).toBe(0);
  });

  it('clearRetimedMarkers clears a saved page only, and leaves moved strokes to the move', () => {
    strokes.set([s('388', 41, 1000), s('388', 42, 2000), s('388', 41, 3000)]);
    retimeStrokes([0, 1, 2], 5000);
    reassignVolume([2], 2);
    expect(clearRetimedMarkers('388', 41)).toBe(1);
    const out = get(strokes);
    expect(out[0].retimedFrom).toBeUndefined();
    expect(out[1].retimedFrom).toEqual({ id: 's2000' });
    expect(out[2].retimedFrom).toEqual({ id: 's3000' });
    clearMovedFromMarkers('388', 41);
    expect(get(strokes)[2].retimedFrom).toBeUndefined();
  });
});

describe('computePendingChangesMap — retimes', () => {
  const onDisk = (key, ids) => new Map([[key, new Map(ids.map((id) => [id, { sketch: false, points: 3 }]))]]);

  it('a retimed stroke whose old id is on disk is a retime, not an addition', () => {
    const arr = [shiftStroke(s('388', 41, 1000), 5000), s('388', 41, 2000)];
    const m = computePendingChangesMap(arr, new Set(), onDisk('B388/P41', ['s1000', 's2000']), new Set());
    expect(m.get('B388/P41').retimes).toEqual([0]);
    expect(m.get('B388/P41').additions).toEqual([]);
  });

  it('a retimed stroke never saved is an addition', () => {
    const arr = [shiftStroke(s('388', 41, 1000), 5000), s('388', 41, 2000)];
    const m = computePendingChangesMap(arr, new Set(), onDisk('B388/P41', ['s2000']), new Set());
    expect(m.get('B388/P41').additions).toEqual([0]);
    expect(m.get('B388/P41').retimes).toEqual([]);
  });

  it('nothing pending once the marker is gone and the new id is on disk', () => {
    const arr = [s('388', 41, 6000)];
    const m = computePendingChangesMap(arr, new Set(), onDisk('B388/P41', ['s6000']), new Set());
    expect(m.has('B388/P41')).toBe(false);
  });
});
