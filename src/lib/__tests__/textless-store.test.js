/**
 * stores/textless.js — the Editor's Leave out of / Include in transcripts and
 * the canvas copies after a save wrote the ink of deleted lines (v3.20.0,
 * spec A.3). Also: Transcribe's untranscribed count skips textless strokes.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';

describe('textless on the strokes store', () => {
  let strokesMod;
  let storageMod;
  let textless;

  const stroke = (startTime, extra = {}) => ({
    pageInfo: { section: 3, owner: 1012, book: '3017', page: 42 },
    startTime,
    endTime: startTime + 100,
    dotArray: [{ x: 1, y: 2, f: 300 }, { x: 3, y: 4, f: 500 }],
    ...extra,
  });

  beforeEach(async () => {
    localStorage.clear();
    vi.resetModules();
    strokesMod = await import('$stores/strokes.js');
    storageMod = await import('$stores/storage.js');
    textless = await import('$stores/textless.js');
    strokesMod.strokes.set([stroke(1000, { blockUuid: 'L1' }), stroke(2000), stroke(3000, { textless: true })]);
    storageMod.clearUnsavedChanges();
  });

  it('Leave out of transcripts flags the strokes, drops their line link and marks the session unsaved', () => {
    expect(textless.setStrokesTextless(new Set([0, 1, 2]), true)).toBe(2);
    expect(get(strokesMod.strokes).map((s) => [s.textless, s.blockUuid ?? null])).toEqual([
      [true, null], [true, null], [true, null]
    ]);
    expect(get(storageMod.unsavedChanges)).toBe(true);
  });

  it('Include in transcripts sets an explicit false (so the save clears the stored flag) and keeps it unlinked', () => {
    expect(textless.setStrokesTextless([2], false)).toBe(1);
    const s = get(strokesMod.strokes)[2];
    expect(s.textless).toBe(false);
    expect(s.blockUuid).toBeUndefined();
  });

  it('no change: nothing marked unsaved', () => {
    expect(textless.setStrokesTextless([2], true)).toBe(0);
    expect(textless.setStrokesTextless([], true)).toBe(0);
    expect(get(storageMod.unsavedChanges)).toBe(false);
  });

  it('countTextless splits a selection', () => {
    expect(textless.countTextless(get(strokesMod.strokes), [0, 1, 2, 9])).toEqual({ textless: 1, other: 2 });
  });

  it('getUntranscribedStrokes leaves textless strokes out (Transcribe never sends them)', () => {
    expect(strokesMod.getUntranscribedStrokes(get(strokesMod.strokes)).map((s) => s.startTime)).toEqual([2000]);
  });

  it('after a save: the page\'s canvas copies follow the disk, and that is not an unsaved edit', () => {
    strokesMod.strokes.update((all) => [...all, stroke(4000, { blockUuid: 'L2' }), stroke(1000, { pageInfo: { book: '3017', page: 43 }, blockUuid: 'L9' })]);
    const n = textless.applySavedDeletedInk('3017', 42, { textlessIds: ['s1000'], unlinkedIds: ['s4000'] });
    expect(n).toBe(2);
    const all = get(strokesMod.strokes);
    expect(all[0]).toMatchObject({ textless: true, blockUuid: null });
    expect(all[3]).toMatchObject({ blockUuid: null });
    expect(all[3].textless).toBeUndefined();
    expect(all[4]).toMatchObject({ blockUuid: 'L9' });   // same time, another page: untouched
    expect(get(storageMod.unsavedChanges)).toBe(false);
    expect(textless.applySavedDeletedInk('3017', 42, {})).toBe(0);
  });
});

describe('QA fixes: Include before a save, and writes outside the Editor', () => {
  let strokesMod;
  let storageMod;
  let pending;
  let textless;
  const stroke = (startTime, extra = {}) => ({
    pageInfo: { section: 3, owner: 1012, book: '3017', page: 42 }, startTime, endTime: startTime + 100,
    dotArray: [{ x: 1, y: 2, f: 300 }, { x: 3, y: 4, f: 500 }], ...extra,
  });

  beforeEach(async () => {
    localStorage.clear();
    vi.resetModules();
    strokesMod = await import('$stores/strokes.js');
    storageMod = await import('$stores/storage.js');
    pending = await import('$stores/pending-changes.js');
    textless = await import('$stores/textless.js');
    strokesMod.strokes.set([stroke(1000, { blockUuid: 'L1' }), stroke(2000)]);
    storageMod.clearUnsavedChanges();
  });

  it('Leave out then Include before saving puts the link back (the disk still has it)', () => {
    textless.setStrokesTextless([0, 1], true);
    expect(get(strokesMod.strokes)[0]).toMatchObject({ textless: true, blockUuid: null, textlessFrom: 'L1' });
    textless.setStrokesTextless([0, 1], false);
    const [a, b] = get(strokesMod.strokes);
    expect(a.blockUuid).toBe('L1');
    expect(b.blockUuid).toBeNull();
    expect('textlessFrom' in a).toBe(false);
    // Transcribe does not resend the linked stroke.
    expect(strokesMod.getUntranscribedStrokes(get(strokesMod.strokes)).map((s) => s.startTime)).toEqual([2000]);
  });

  it('leaving out twice keeps the first link', () => {
    textless.setStrokesTextless([0], true);
    textless.setStrokesTextless([0], false);
    textless.setStrokesTextless([0], true);
    expect(get(strokesMod.strokes)[0].textlessFrom).toBe('L1');
  });

  it('after a save the kept link is spent: Include then leaves the stroke unlinked', () => {
    textless.setStrokesTextless([0], true);
    expect(textless.clearTextlessMarkers('3017', 42)).toBe(1);
    expect(textless.clearTextlessMarkers('3017', 42)).toBe(0);
    textless.setStrokesTextless([0], false);
    expect(get(strokesMod.strokes)[0]).toMatchObject({ textless: false, blockUuid: null });
  });

  it('a Library Edit / Pages tab write reaches the page on the canvas, and its flags are not a canvas change', () => {
    const written = [{ id: 's1000', lineId: null, textless: true, points: [] }, { id: 's2000', lineId: null, points: [] }];
    strokesMod.strokes.update((all) => [all[0], { ...all[1], blockUuid: 'L2' }]);
    const n = textless.syncCanvasAfterPageWrite('3017', '42', { strokes: written, textlessIds: ['s1000'], unlinkedIds: ['s2000'] });
    expect(n).toBe(2);
    const [a, b] = get(strokesMod.strokes);
    expect(a).toMatchObject({ textless: true, blockUuid: null });
    expect(b.blockUuid).toBeNull();
    expect(get(pending.onDiskStrokeIds).get('B3017/P42').get('s1000').textless).toBe(true);
    expect(get(storageMod.unsavedChanges)).toBe(false);
  });

  it('Relink (v3.21.0) passes the written links: the canvas takes them, a textless id wins, no unsaved change', () => {
    const written = [
      { id: 's1000', lineId: 'L9', points: [] }, { id: 's2000', lineId: null, textless: true, points: [] },
      { id: 's3000', lineId: null, textless: true, points: [] }
    ];
    const n = textless.syncCanvasAfterPageWrite('3017', '42', {
      strokes: written, textlessIds: ['s2000'], links: { s1000: 'L9', s2000: null }
    });
    expect(n).toBe(2);
    expect(get(strokesMod.strokes).map((s) => [s.blockUuid ?? null, s.textless ?? null])).toEqual([
      ['L9', null], [null, true]
    ]);
    expect(get(pending.onDiskStrokeIds).get('B3017/P42').get('s2000').textless).toBe(true);
    expect(get(storageMod.unsavedChanges)).toBe(false);
    // A Map works too, and an unchanged link is no change.
    expect(textless.applySavedDeletedInk('3017', 42, { links: new Map([['s1000', 'L9']]) })).toBe(0);
  });

  it('a page not on the canvas: nothing to do', () => {
    expect(textless.syncCanvasAfterPageWrite('3017', '99', { textlessIds: ['s1000'] })).toBe(0);
    expect(get(strokesMod.strokes)[0].blockUuid).toBe('L1');
  });
});

describe('a sketch write brings a page loaded in the Editor in step (v3.24.0, syncCanvasAfterPageWrite)', () => {
  let strokesMod;
  let storageMod;
  let textless;
  let pending;
  const stroke = (startTime, extra = {}) => ({
    pageInfo: { section: 3, owner: 1012, book: '3017', page: 124 },
    startTime, endTime: startTime + 100, dotArray: [{ x: 1, y: 2, f: 300 }, { x: 3, y: 4, f: 500 }], ...extra
  });

  beforeEach(async () => {
    localStorage.clear();
    vi.resetModules();
    strokesMod = await import('$stores/strokes.js');
    storageMod = await import('$stores/storage.js');
    textless = await import('$stores/textless.js');
    pending = await import('$stores/pending-changes.js');
    strokesMod.strokes.set([stroke(1000), stroke(2000, { textless: true, textlessFrom: null }), stroke(3000, { blockUuid: 'L1' }), stroke(4000)]);
    storageMod.clearUnsavedChanges();
  });

  it('links, Pressure ink and a cleared Not text land on the canvas copies; the on-disk index follows; nothing is unsaved', () => {
    const disk = [
      { id: 's1000', lineId: 'SK', sketch: true, points: [[1, 2], [3, 4]] },
      { id: 's2000', lineId: 'SK', points: [[1, 2], [3, 4]] },
      { id: 's3000', lineId: 'L1', points: [[1, 2], [3, 4]] },
      { id: 's4000', lineId: null, points: [[1, 2], [3, 4]] },
    ];
    const n = textless.syncCanvasAfterPageWrite('3017', '124', {
      strokes: disk, links: { s1000: 'SK', s2000: 'SK' }, sketchIds: ['s1000'], textlessCleared: ['s2000']
    });
    expect(n).toBe(4);
    const [a, b, c, d] = get(strokesMod.strokes);
    expect(a).toMatchObject({ blockUuid: 'SK', sketch: true });
    expect(b.blockUuid).toBe('SK');
    expect('textless' in b || 'textlessFrom' in b).toBe(false);
    expect(c.blockUuid).toBe('L1');
    expect(d.blockUuid).toBeUndefined();
    // Transcribe skips the sketch's ink now.
    expect(strokesMod.getUntranscribedStrokes(get(strokesMod.strokes)).map((s) => s.startTime)).toEqual([4000]);
    // The on-disk index has the new flags, so neither reads as a canvas change.
    const states = get(pending.onDiskStrokeIds).get('B3017/P124');
    expect(states.get('s1000')).toMatchObject({ sketch: true, textless: false });
    expect(get(pending.pendingChanges).get('B3017/P124')?.modifications || []).toEqual([]);
    expect(get(storageMod.unsavedChanges)).toBe(false);
  });

  it('Remove sketch with Not text: the canvas copies are flagged and unlinked, and nothing reads as unsaved', () => {
    strokesMod.strokes.set([stroke(1000, { blockUuid: 'SK' }), stroke(2000, { blockUuid: 'SK' }), stroke(3000, { blockUuid: 'L1' })]);
    const disk = [
      { id: 's1000', lineId: null, textless: true, points: [[1, 2], [3, 4]] },
      { id: 's2000', lineId: null, textless: true, points: [[1, 2], [3, 4]] },
      { id: 's3000', lineId: 'L1', points: [[1, 2], [3, 4]] },
    ];
    textless.syncCanvasAfterPageWrite('3017', '124', { strokes: disk, links: { s1000: null, s2000: null }, textlessIds: ['s1000', 's2000'] });
    const [a, b, c] = get(strokesMod.strokes);
    expect(a).toMatchObject({ textless: true, blockUuid: null });
    expect(b).toMatchObject({ textless: true, blockUuid: null });
    expect(c.blockUuid).toBe('L1');
    // Transcribe never sends them; the disk index agrees, so no modification.
    expect(strokesMod.getUntranscribedStrokes(get(strokesMod.strokes))).toEqual([]);
    expect(get(pending.pendingChanges).get('B3017/P124')?.modifications || []).toEqual([]);
    expect(get(storageMod.unsavedChanges)).toBe(false);
  });

  it('does nothing for a page not on the canvas', () => {
    expect(textless.syncCanvasAfterPageWrite('3017', '125', { links: { s1000: 'SK' }, sketchIds: ['s1000'] })).toBe(0);
    expect(get(strokesMod.strokes)[0].blockUuid).toBeUndefined();
  });
});
