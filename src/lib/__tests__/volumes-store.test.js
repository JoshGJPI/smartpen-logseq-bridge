/**
 * Tests for the volume stores: capture routing (stores/volumes.js) and the
 * reassignment primitives (stores/strokes.js + stores/pending-changes.js).
 *
 * The behaviour that matters most here is §6.2 of docs/VOLUMES-SPEC.md: under
 * append-only, missing-from-canvas never means deleted-on-disk, so reassigning a
 * stroke is a COPY unless the page it left is told to drop it. `movedFrom` is
 * what turns it into a move, and `getMovedAwayStrokeIdsForPage` is what the save
 * path reads.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('$lib/storage/local-store.js', () => ({
  getVolumes: vi.fn(),
  setActiveVolume: vi.fn(),
}));

import { strokes, reassignVolume, clearMovedFromMarkers, addStroke } from '$stores/strokes.js';
import { deletedIndices, getMovedAwayStrokeIdsForPage } from '$stores/pending-changes.js';
import {
  volumeRegistry, activeVolumeFor, applyActiveVolume, volumesForBook
} from '$stores/volumes.js';

function canvasStroke(book, page, startTime, extra = {}) {
  return {
    pageInfo: { section: 3, owner: 1012, book, page },
    startTime,
    endTime: startTime + 100,
    dotArray: [{ x: 1, y: 2, f: 400 }],
    ...extra,
  };
}

beforeEach(() => {
  strokes.set([]);
  deletedIndices.set(new Set());
  volumeRegistry.set({ version: 1, active: {} });
});

describe('activeVolumeFor', () => {
  it('defaults to volume 1 for a book nobody has configured', () => {
    expect(activeVolumeFor(388)).toBe(1);
    expect(activeVolumeFor('388')).toBe(1);
  });

  it('reads the configured volume', () => {
    volumeRegistry.set({ version: 1, active: { 388: 2 } });
    expect(activeVolumeFor(388)).toBe(2);
    expect(activeVolumeFor(999)).toBe(1);
  });

  it('ignores nonsense entries', () => {
    volumeRegistry.set({ version: 1, active: { 388: 0 } });
    expect(activeVolumeFor(388)).toBe(1);
  });
});

describe('applyActiveVolume', () => {
  it('leaves volume-1 capture as a plain book key', () => {
    const out = applyActiveVolume({ section: 3, owner: 1012, book: 388, page: 12 });
    expect(out.book).toBe('388');
    expect(out.volume).toBe(1);
  });

  it('stamps the active volume onto incoming pen data', () => {
    volumeRegistry.set({ version: 1, active: { 388: 2 } });
    const out = applyActiveVolume({ section: 3, owner: 1012, book: 388, page: 12 });
    expect(out.book).toBe('388v2');
    expect(out.ncodeBook).toBe(388);
    expect(out.volume).toBe(2);
  });

  it('routes only the configured book', () => {
    volumeRegistry.set({ version: 1, active: { 388: 2 } });
    expect(applyActiveVolume({ book: 999, page: 1 }).book).toBe('999');
  });

  // Idempotency matters: without it, re-adding an imported volume-2 stroke while
  // the active pointer says volume 1 would silently demote it.
  it('is idempotent — never re-resolves a pageInfo that already has a volume', () => {
    const already = { book: '388v2', ncodeBook: 388, volume: 2, page: 12 };
    expect(applyActiveVolume(already)).toBe(already);
  });

  it('returns the same object when nothing needs changing', () => {
    const pi = { book: 'not-a-book', page: 12 };
    expect(applyActiveVolume(pi)).toBe(pi);
    expect(applyActiveVolume(null)).toBeNull();
  });
});

describe('addStroke routing', () => {
  it('stamps the active volume at the capture boundary', () => {
    volumeRegistry.set({ version: 1, active: { 388: 2 } });
    addStroke({ pageInfo: { section: 3, owner: 1012, book: 388, page: 12 }, startTime: 1000, dotArray: [] });
    expect(get(strokes)[0].pageInfo.book).toBe('388v2');
  });

  it('leaves volume-1 books spelled exactly as before', () => {
    addStroke({ pageInfo: { book: 388, page: 12 }, startTime: 1000, dotArray: [] });
    expect(get(strokes)[0].pageInfo.book).toBe('388');
  });
});

describe('reassignVolume', () => {
  it('rewrites the book key and records where the stroke came from', () => {
    strokes.set([canvasStroke('388', 12, 1000)]);
    const result = reassignVolume([0], 2);

    expect(result.moved).toBe(1);
    expect(result.targets).toEqual(['388v2']);

    const s = get(strokes)[0];
    expect(s.pageInfo.book).toBe('388v2');
    expect(s.pageInfo.volume).toBe(2);
    expect(s.movedFrom).toEqual({ book: '388', page: 12 });
  });

  // The id is what the source page's deletion matches on, so it has to survive.
  it('preserves stroke identity and geometry', () => {
    strokes.set([canvasStroke('388', 12, 1000, { sketch: true })]);
    reassignVolume([0], 2);

    const s = get(strokes)[0];
    expect(s.startTime).toBe(1000);
    expect(s.endTime).toBe(1100);
    expect(s.sketch).toBe(true);
    expect(s.dotArray).toHaveLength(1);
    expect(s.dotArray[0].f).toBe(400);
  });

  // The line it points at belongs to the source page.
  it('clears the transcript link', () => {
    strokes.set([canvasStroke('388', 12, 1000, { blockUuid: 'line-1' })]);
    reassignVolume([0], 2);
    expect(get(strokes)[0].blockUuid).toBeNull();
  });

  it('is a no-op when the stroke is already in the target volume', () => {
    strokes.set([canvasStroke('388v2', 12, 1000)]);
    const result = reassignVolume([0], 2);
    expect(result.moved).toBe(0);
    expect(get(strokes)[0].movedFrom).toBeUndefined();
  });

  it('moves back to volume 1', () => {
    strokes.set([canvasStroke('388v2', 12, 1000)]);
    reassignVolume([0], 1);
    expect(get(strokes)[0].pageInfo.book).toBe('388');
    expect(get(strokes)[0].movedFrom).toEqual({ book: '388v2', page: 12 });
  });

  // Otherwise the deletion would name a page that never held the stroke.
  it('keeps the FIRST origin when a stroke is moved twice before saving', () => {
    strokes.set([canvasStroke('388', 12, 1000)]);
    reassignVolume([0], 2);
    reassignVolume([0], 3);

    const s = get(strokes)[0];
    expect(s.pageInfo.book).toBe('388v3');
    expect(s.movedFrom).toEqual({ book: '388', page: 12 });
  });

  it('only touches the selected strokes', () => {
    strokes.set([canvasStroke('388', 12, 1000), canvasStroke('388', 12, 2000)]);
    reassignVolume([1], 2);

    expect(get(strokes)[0].pageInfo.book).toBe('388');
    expect(get(strokes)[0].movedFrom).toBeUndefined();
    expect(get(strokes)[1].pageInfo.book).toBe('388v2');
  });

  it('accepts a Set and skips unreadable books', () => {
    strokes.set([canvasStroke('388', 12, 1000), canvasStroke('nope', 12, 2000)]);
    const result = reassignVolume(new Set([0, 1]), 2);
    expect(result.moved).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it('refuses an invalid volume', () => {
    strokes.set([canvasStroke('388', 12, 1000)]);
    expect(reassignVolume([0], 0).moved).toBe(0);
    expect(reassignVolume([0], -1).moved).toBe(0);
    expect(get(strokes)[0].pageInfo.book).toBe('388');
  });

  it('does nothing for an empty selection', () => {
    strokes.set([canvasStroke('388', 12, 1000)]);
    expect(reassignVolume([], 2)).toEqual({ moved: 0, skipped: 0, targets: [] });
  });
});

describe('getMovedAwayStrokeIdsForPage', () => {
  it('returns the ids the source page must drop', () => {
    strokes.set([canvasStroke('388', 12, 1000), canvasStroke('388', 12, 2000)]);
    reassignVolume([0], 2);

    const ids = getMovedAwayStrokeIdsForPage('388', 12);
    expect([...ids]).toEqual(['s1000']);
  });

  it('is empty for the target page — nothing left there', () => {
    strokes.set([canvasStroke('388', 12, 1000)]);
    reassignVolume([0], 2);
    expect(getMovedAwayStrokeIdsForPage('388v2', 12).size).toBe(0);
  });

  it('matches a numeric book against a key-carrying marker', () => {
    strokes.set([canvasStroke('388', 12, 1000)]);
    reassignVolume([0], 2);
    expect([...getMovedAwayStrokeIdsForPage(388, 12)]).toEqual(['s1000']);
  });

  it('excludes strokes already marked for deletion', () => {
    strokes.set([canvasStroke('388', 12, 1000)]);
    reassignVolume([0], 2);
    deletedIndices.set(new Set([0]));
    expect(getMovedAwayStrokeIdsForPage('388', 12).size).toBe(0);
  });

  it('is empty when nothing has moved', () => {
    strokes.set([canvasStroke('388', 12, 1000)]);
    expect(getMovedAwayStrokeIdsForPage('388', 12).size).toBe(0);
  });
});

describe('clearMovedFromMarkers', () => {
  it('drops the marker once the source page has been saved', () => {
    strokes.set([canvasStroke('388', 12, 1000)]);
    reassignVolume([0], 2);

    expect(clearMovedFromMarkers('388', 12)).toBe(1);
    expect(get(strokes)[0].movedFrom).toBeUndefined();
    expect(get(strokes)[0].pageInfo.book).toBe('388v2');   // the move itself stands
  });

  it('leaves markers belonging to other pages alone', () => {
    strokes.set([canvasStroke('388', 12, 1000), canvasStroke('388', 13, 2000)]);
    reassignVolume([0, 1], 2);

    expect(clearMovedFromMarkers('388', 12)).toBe(1);
    expect(get(strokes)[0].movedFrom).toBeUndefined();
    expect(get(strokes)[1].movedFrom).toEqual({ book: '388', page: 13 });
  });

  // Cheap pre-check: writing the store unconditionally would republish the whole
  // strokes array once per saved page for the common case of no moves at all.
  it('is a no-op with no matching markers', () => {
    strokes.set([canvasStroke('388', 12, 1000)]);
    const before = get(strokes);
    expect(clearMovedFromMarkers('388', 12)).toBe(0);
    expect(get(strokes)).toBe(before);
  });
});

describe('volumesForBook', () => {
  it('always offers volume 1', () => {
    expect(volumesForBook(388, [])).toEqual([1]);
  });

  it('includes volumes seen on disk and the active one, sorted', () => {
    volumeRegistry.set({ version: 1, active: { 388: 4 } });
    expect(volumesForBook(388, ['388', '388v3', '999v2'])).toEqual([1, 3, 4]);
  });

  it('ignores other books and unparseable keys', () => {
    expect(volumesForBook(388, ['999v5', 'bogus'])).toEqual([1]);
  });
});
