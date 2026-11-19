/**
 * textless — the "Not text" flag on canvas strokes (v3.20.0,
 * docs/TRANSCRIPT-STRUCTURE-SPEC.md A.3): a textless stroke is left out of
 * transcripts, so Transcribe never sends it (lib/canvas-save-plan.js
 * groupStrokesForTranscription) and it is in no line.
 *
 * On the canvas the flag is three-way: `true` (left out), `false` (taken back
 * in on the canvas) or absent (the canvas has no say). Only true / false is
 * saved and counted as a change (save-page.js, pendingChanges,
 * page-changes.js), so a page loaded before a Library delete flagged its ink
 * can't clear the flag by being saved.
 */
import { get } from 'svelte/store';
import { strokes } from './strokes.js';
import { markUnsavedChanges } from './storage.js';

/**
 * Leave strokes out of transcripts (`on`), or take them back in. Leaving out
 * also drops the stroke's line link (`blockUuid`): a textless stroke is in no
 * line. Taking back in leaves it unlinked, so the next Transcribe sends it.
 * Marks the session dirty when anything changed (the flag lives in the PageDoc).
 *
 * @param {number[]|Set<number>} indices  positions in the strokes store
 * @param {boolean} on
 * @returns {number} how many strokes changed
 */
export function setStrokesTextless(indices, on) {
  const target = indices instanceof Set ? indices : new Set(indices || []);
  if (target.size === 0) return 0;
  let changed = 0;
  strokes.update((all) => all.map((stroke, index) => {
    if (!target.has(index)) return stroke;
    if ((stroke.textless === true) === !!on) return stroke;
    changed++;
    return on ? { ...stroke, textless: true, blockUuid: null } : { ...stroke, textless: false };
  }));
  if (changed > 0) markUnsavedChanges();
  return changed;
}

/**
 * How many of `indices` are textless, and how many are not.
 * @param {Array} all  the strokes store's value
 * @param {Iterable<number>} indices
 * @returns {{ textless: number, other: number }}
 */
export function countTextless(all, indices) {
  let textless = 0;
  let other = 0;
  for (const i of indices || []) {
    const s = all[i];
    if (!s) continue;
    if (s.textless === true) textless++;
    else other++;
  }
  return { textless, other };
}

/**
 * After a save wrote the ink of deleted transcript lines (save-page.js
 * `textlessIds` / `unlinkedIds`), bring the canvas copies of that page in
 * line: textless ones flagged and unlinked, the others only unlinked (so the
 * next Transcribe sends them). Not an edit: the disk already has it, so this
 * never marks the session dirty.
 *
 * @param {string|number} book
 * @param {number|string} page
 * @param {{ textlessIds?: string[], unlinkedIds?: string[] }} result
 * @returns {number} how many canvas strokes changed
 */
export function applySavedDeletedInk(book, page, { textlessIds = [], unlinkedIds = [] } = {}) {
  if (!textlessIds.length && !unlinkedIds.length) return 0;
  const flag = new Set(textlessIds);
  const unlink = new Set(unlinkedIds);
  let changed = 0;
  const all = get(strokes);
  const next = all.map((s) => {
    const pi = s.pageInfo;
    if (!pi || String(pi.book) !== String(book) || String(pi.page) !== String(page)) return s;
    const id = `s${s.startTime}`;
    if (flag.has(id)) {
      if (s.textless === true && !s.blockUuid) return s;
      changed++;
      return { ...s, textless: true, blockUuid: null };
    }
    if (unlink.has(id) && s.blockUuid) {
      changed++;
      return { ...s, blockUuid: null };
    }
    return s;
  });
  if (changed > 0) strokes.set(next);
  return changed;
}
