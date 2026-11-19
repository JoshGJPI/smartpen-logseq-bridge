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
import { noteOnDiskStrokeIds } from './pending-changes.js';

/**
 * Leave strokes out of transcripts (`on`), or take them back in. Leaving out
 * also drops the stroke's line link (`blockUuid`): a textless stroke is in no
 * line. The link is kept in memory as `textlessFrom` (never on disk:
 * strokeToStored's fixed key list) until a save writes the flag
 * (clearTextlessMarkers), so taking it back in before then restores it and the
 * canvas still agrees with the disk; taken back in after a save, it stays
 * unlinked, so the next Transcribe sends it.
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
    if (on) {
      const from = 'textlessFrom' in stroke ? stroke.textlessFrom : (stroke.blockUuid ?? null);
      return { ...stroke, textless: true, blockUuid: null, textlessFrom: from };
    }
    const { textlessFrom, ...rest } = stroke;
    return { ...rest, textless: false, ...('textlessFrom' in stroke ? { blockUuid: textlessFrom } : {}) };
  }));
  if (changed > 0) markUnsavedChanges();
  return changed;
}

/**
 * After a page's save: the flag is on disk, so the links kept for a quick
 * Include (`textlessFrom`) are spent. Not an edit; never marks unsaved.
 * @param {string|number} book
 * @param {string|number} page
 * @returns {number} how many strokes were cleared
 */
export function clearTextlessMarkers(book, page) {
  let n = 0;
  const next = get(strokes).map((s) => {
    const pi = s.pageInfo;
    if (!('textlessFrom' in s) || !pi || String(pi.book) !== String(book) || String(pi.page) !== String(page)) return s;
    n++;
    const { textlessFrom, ...rest } = s;
    return rest;
  });
  if (n > 0) strokes.set(next);
  return n;
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
 * `links` (v3.21.0, Relink) carries the line each stroke was written with
 * (stroke id → line id, null = unlinked); a textless id wins over its link.
 *
 * @param {string|number} book
 * @param {number|string} page
 * @param {{ textlessIds?: string[], unlinkedIds?: string[], links?: Object<string, string|null> }} result
 * @returns {number} how many canvas strokes changed
 */
export function applySavedDeletedInk(book, page, { textlessIds = [], unlinkedIds = [], links = null } = {}) {
  const linkMap = links ? new Map(links instanceof Map ? links : Object.entries(links)) : null;
  if (!textlessIds.length && !unlinkedIds.length && !(linkMap && linkMap.size)) return 0;
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
    if (linkMap && linkMap.has(id)) {
      const link = linkMap.get(id) || null;
      if ((s.blockUuid || null) === link) return s;
      changed++;
      return { ...s, blockUuid: link };
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

/**
 * After a write that bypasses the Editor's save (Library Edit, the Pages tab's
 * Edit structure), bring a page also loaded on the canvas in line with what was
 * written: the deleted lines' ink flagged or unlinked there too (so Transcribe
 * sends "Transcribe again" ink, and skips Not text), and the on-disk state
 * index refreshed, so a flag the disk now has doesn't read as a canvas change.
 * Does nothing for a page that isn't on the canvas. Relink (v3.21.0) passes
 * `links`, the line each sent stroke was written with. `page` is matched as the
 * canvas keys it (the integer NCode page), so a letter-suffixed page can't be
 * told from its integer page here: Relink refuses one while it is on the canvas.
 *
 * @param {string|number} book
 * @param {string|number} page
 * @param {{ strokes?: Array, textlessIds?: string[], unlinkedIds?: string[], links?: Object }} written
 * @returns {number} how many canvas strokes changed
 */
export function syncCanvasAfterPageWrite(book, page, written = {}) {
  const onCanvas = get(strokes).some((s) => s.pageInfo
    && String(s.pageInfo.book) === String(book) && String(s.pageInfo.page) === String(page));
  if (!onCanvas) return 0;
  const n = applySavedDeletedInk(book, page, written);
  if (Array.isArray(written.strokes)) noteOnDiskStrokeIds(book, page, written.strokes);
  return n;
}
