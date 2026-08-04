/**
 * Point Edit Store — the canvas "Edit Points" mode.
 *
 * Point editing is a mode layered on the existing stroke selection: the strokes
 * you have selected become the ones whose individual points are drawn as
 * clickable handles. That keeps the workflow the same as everything else on the
 * canvas (box-select the area, then act) and means the stray point is always
 * judged in place, against the surrounding handwriting.
 *
 * Point identity is `"{strokeIndex}:{pointIndex}"` — an index into the strokes
 * store, not a stable id. Indices are stable for the lifetime of the mode
 * because nothing in this mode adds or removes strokes; the selection subscriber
 * below prunes keys whose stroke leaves the selection, and mode exits if the
 * selection empties entirely (Clear, page-filter change).
 */

import { writable, derived, get } from 'svelte/store';
import { strokes, removeStrokePoints } from './strokes.js';
import { selectedIndices } from './selection.js';
import {
  detectStrayPointsForStrokes,
  groupPointKeys,
  pointKey,
  strokeDots
} from '../lib/point-edit.js';

/**
 * Above this many selected strokes the mode refuses to open: every point of
 * every selected stroke gets a handle, and past a few thousand handles the
 * canvas is unreadable long before it is slow. Point editing is a surgical
 * operation on a handful of strokes.
 */
export const MAX_POINT_EDIT_STROKES = 150;

/** Whether the canvas is in point-edit mode. */
export const pointEditMode = writable(false);

/** Selected point keys, `"strokeIndex:pointIndex"`. */
export const selectedPoints = writable(new Set());

/**
 * The strokes whose points are editable right now: the current selection, in
 * ascending index order. Empty when the mode is off, so consumers can key off
 * this alone.
 */
export const pointEditStrokes = derived(
  [pointEditMode, selectedIndices, strokes],
  ([$mode, $selected, $strokes]) => {
    if (!$mode) return [];
    const entries = [];
    for (const strokeIndex of [...$selected].sort((a, b) => a - b)) {
      const stroke = $strokes[strokeIndex];
      if (stroke) entries.push({ strokeIndex, stroke });
    }
    return entries;
  }
);

/** Total points across the editable strokes. */
export const pointEditPointCount = derived(pointEditStrokes, $entries =>
  $entries.reduce((n, e) => n + strokeDots(e.stroke).length, 0)
);

/**
 * Points that look like capture errors, across the editable strokes. Advisory —
 * the user still confirms the deletion.
 */
export const strayPoints = derived(pointEditStrokes, $entries =>
  detectStrayPointsForStrokes($entries)
);

/** Stray point keys, for the renderer's handle styling. */
export const strayPointKeys = derived(strayPoints, $strays =>
  new Set($strays.map(s => pointKey(s.strokeIndex, s.pointIndex)))
);

export const selectedPointCount = derived(selectedPoints, $sel => $sel.size);
export const hasSelectedPoints = derived(selectedPoints, $sel => $sel.size > 0);

/* -----------------------------------------------------------------
 *  Mode
 * ----------------------------------------------------------------- */

/**
 * Enter point-edit mode for the current stroke selection.
 * @returns {{ok: boolean, reason?: 'no-selection'|'too-many', count?: number}}
 */
export function enterPointEditMode() {
  const selected = get(selectedIndices);
  if (selected.size === 0) return { ok: false, reason: 'no-selection' };
  if (selected.size > MAX_POINT_EDIT_STROKES) {
    return { ok: false, reason: 'too-many', count: selected.size };
  }
  selectedPoints.set(new Set());
  pointEditMode.set(true);
  return { ok: true, count: selected.size };
}

export function exitPointEditMode() {
  pointEditMode.set(false);
  selectedPoints.set(new Set());
}

/** @returns {{ok: boolean, entered: boolean, reason?: string, count?: number}} */
export function togglePointEditMode() {
  if (get(pointEditMode)) {
    exitPointEditMode();
    return { ok: true, entered: false };
  }
  const result = enterPointEditMode();
  return { ...result, entered: result.ok };
}

// Keep the point selection consistent with the stroke selection: a point whose
// stroke is no longer selected has no handle on screen, so leaving it selected
// would let a later Delete act on something invisible.
selectedIndices.subscribe($selected => {
  if (!get(pointEditMode)) return;

  if ($selected.size === 0) {
    exitPointEditMode();
    return;
  }

  const current = get(selectedPoints);
  if (current.size === 0) return;

  let pruned = false;
  const next = new Set();
  for (const key of current) {
    const strokeIndex = Number(String(key).split(':')[0]);
    if ($selected.has(strokeIndex)) next.add(key);
    else pruned = true;
  }
  if (pruned) selectedPoints.set(next);
});

/* -----------------------------------------------------------------
 *  Point selection
 * ----------------------------------------------------------------- */

/**
 * Select, add or remove one point.
 * @param {number} strokeIndex
 * @param {number} pointIndex
 * @param {'replace'|'toggle'|'remove'} [mode]
 */
export function selectPoint(strokeIndex, pointIndex, mode = 'replace') {
  const key = pointKey(strokeIndex, pointIndex);
  selectedPoints.update(sel => {
    if (mode === 'replace') return new Set([key]);
    const next = new Set(sel);
    if (mode === 'remove') next.delete(key);
    else if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
}

/**
 * Select several points at once (box selection, or "select all suspect points").
 * @param {Array<{strokeIndex:number, pointIndex:number}>} points
 * @param {'replace'|'add'|'remove'} [mode]
 */
export function selectPoints(points, mode = 'replace') {
  const keys = (points || []).map(p => pointKey(p.strokeIndex, p.pointIndex));
  selectedPoints.update(sel => {
    if (mode === 'replace') return new Set(keys);
    const next = new Set(sel);
    for (const key of keys) {
      if (mode === 'remove') next.delete(key);
      else next.add(key);
    }
    return next;
  });
}

export function clearPointSelection() {
  selectedPoints.set(new Set());
}

/** Select every detected stray point. */
export function selectStrayPoints() {
  const strays = get(strayPoints);
  selectPoints(strays, 'replace');
  return strays.length;
}

/* -----------------------------------------------------------------
 *  Deletion
 * ----------------------------------------------------------------- */

/**
 * @typedef {Object} PointDeleteResult
 * @property {number} removedPoints
 * @property {number} editedStrokes
 * @property {string[]} editedIds            stroke ids whose geometry changed
 * @property {Array<{strokeIndex:number, remaining:number}>} refused
 *   strokes left untouched because the removal would have dropped them below the
 *   two points needed to draw a line
 */

/**
 * Delete the currently selected points.
 * @returns {PointDeleteResult}
 */
export function deleteSelectedPoints() {
  const keys = get(selectedPoints);
  if (keys.size === 0) {
    return { removedPoints: 0, editedStrokes: 0, editedIds: [], refused: [] };
  }

  const result = removeStrokePoints(groupPointKeys(keys));

  // Point indices shift once points are gone, so any surviving selection would
  // now refer to different points than the user picked.
  clearPointSelection();
  return result;
}

/**
 * Delete every detected stray point in one action — the common case for the
 * origin-dot artifact.
 * @returns {PointDeleteResult}
 */
export function deleteStrayPoints() {
  const strays = get(strayPoints);
  if (strays.length === 0) {
    return { removedPoints: 0, editedStrokes: 0, editedIds: [], refused: [] };
  }

  const edits = new Map();
  for (const { strokeIndex, pointIndex } of strays) {
    if (!edits.has(strokeIndex)) edits.set(strokeIndex, new Set());
    edits.get(strokeIndex).add(pointIndex);
  }

  const result = removeStrokePoints(edits);
  clearPointSelection();
  return result;
}
