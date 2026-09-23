/**
 * Context Ink — strokes the canvas DRAWS but does not own.
 *
 * A date-range load puts only the strokes captured inside the range into the
 * `strokes` store. The rest of each touched page is loaded too, but lands here
 * instead: it renders halftoned so a day's writing can be read in the place it
 * actually sits on the page, and it is deliberately invisible to everything
 * else. It is not in `strokes`, so:
 *
 *   - Select All, box select and hit-testing never reach it
 *   - it is not in `visibleStrokes`, so it is never saved, exported or
 *     transcribed — the index-keyed stores (`selectedIndices`, `deletedIndices`,
 *     point-edit keys) keep positions into `strokes` alone and cannot be thrown
 *     off by it
 *   - `pages` / `canvasPageKeys` do not see it, which is correct: a page only
 *     ever has context ink because it also has real strokes loaded
 *
 * It IS included in the renderer's page-bounds pass, so a page tile keeps its
 * full size and does not resize as the range changes.
 *
 * Strokes carry an in-memory `contextInk: true` marker. Like `pointsEdited` and
 * `movedFrom` it cannot reach disk — `strokeToStored()` builds stored strokes
 * from a fixed key list — and nothing here ever writes.
 */
import { writable, derived, get } from 'svelte/store';
import { strokes } from './strokes.js';

/** Canvas-format strokes, display only. */
export const contextInk = writable([]);

export const contextInkCount = derived(contextInk, $ink => $ink.length);

export const hasContextInk = derived(contextInk, $ink => $ink.length > 0);

/** Page keys ("B{book}/P{page}") that currently have context ink. */
export const contextInkPageKeys = derived(contextInk, $ink => {
  const keys = new Set();
  for (const s of $ink) {
    const pi = s.pageInfo;
    if (!pi || pi.book === undefined || pi.page === undefined) continue;
    keys.add(`B${pi.book}/P${pi.page}`);
  }
  return keys;
});

function strokeId(stroke) {
  return stroke.id || `s${stroke.startTime}`;
}

/**
 * Merge strokes in as context ink, deduplicated by id.
 *
 * Anything already loaded as a real stroke is dropped: one stroke cannot be
 * both, and the real copy always wins. Without this, widening a range so that a
 * previously-out-of-range stroke comes into it would leave a grey ghost drawn
 * underneath its own live copy.
 */
export function addContextInk(incoming) {
  if (!incoming || incoming.length === 0) return 0;
  const liveIds = new Set(get(strokes).map(strokeId));
  let added = 0;
  contextInk.update(current => {
    const seen = new Set(current.map(strokeId));
    const next = current.filter(s => !liveIds.has(strokeId(s)));
    for (const s of incoming) {
      const id = strokeId(s);
      if (seen.has(id) || liveIds.has(id)) continue;
      seen.add(id);
      next.push(s);
      added++;
    }
    return next;
  });
  return added;
}

/** Drop any context ink whose stroke is now loaded for real. */
export function pruneContextInk() {
  const liveIds = new Set(get(strokes).map(strokeId));
  contextInk.update(current => {
    const next = current.filter(s => !liveIds.has(strokeId(s)));
    return next.length === current.length ? current : next;
  });
}

/**
 * Drop the context ink for one page — called when that page leaves the canvas,
 * so a page with no strokes can never be left with only ghosts.
 * @returns {number} how many strokes were dropped
 */
export function removeContextInkForPage(book, page) {
  const bookKey = String(book);
  const pageNum = Number(page);
  let removed = 0;
  contextInk.update(current => {
    const next = current.filter(s => {
      const pi = s.pageInfo || {};
      const match = String(pi.book) === bookKey && Number(pi.page) === pageNum;
      if (match) removed++;
      return !match;
    });
    return removed === 0 ? current : next;
  });
  return removed;
}

export function clearContextInk() {
  contextInk.set([]);
}
