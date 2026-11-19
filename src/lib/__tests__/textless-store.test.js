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
