/**
 * transcript-draft.js — the Library reader's Edit draft (TranscriptPane): the
 * working copy of a page's transcript lines and the structural edits on it.
 * Pure: every function returns new arrays and never touches the caller's lines.
 *
 * Task state isn't edited here; it is carried as is (`checked`, plus `marker`
 * through markerField) and the save reconciles it with the disk
 * (save-transcript.js, keepDiskTaskState).
 */

import { markerField } from '$lib/tasks.js';
import { kindFields, isKindLine } from '$lib/line-kinds.js';

export function makeLineId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function blankLine(indentLevel = 0) {
  return { id: makeLineId(), text: '', indentLevel, parentId: null, checked: null, yBounds: null };
}

/** A clean copy of stored lines: known fields only, ids filled in, indent ≥ 0. */
export function cloneLines(src) {
  return (src || []).map((l) => ({
    id: l.id || makeLineId(),
    text: l.text || '',
    indentLevel: Math.max(0, l.indentLevel || 0),
    parentId: l.parentId ?? null,
    checked: l.checked === true || l.checked === false ? l.checked : null,
    ...markerField(l),
    yBounds: l.yBounds ?? null,
    // A sketch line (v3.24.0) stays one: its kind and box ride along.
    ...kindFields(l),
  }));
}

const level = (l) => (l && l.indentLevel) || 0;

/**
 * Indent line i one step, at most one deeper than the line above (the first
 * line stays at 0). null when it can't go deeper.
 */
export function indentAt(draft, i) {
  if (!draft[i]) return null;
  const max = i > 0 ? level(draft[i - 1]) + 1 : 0;
  if (level(draft[i]) >= max) return null;
  return draft.map((l, j) => (j === i ? { ...l, indentLevel: level(l) + 1 } : l));
}

/** Outdent line i one step; null when it is already at the margin. */
export function outdentAt(draft, i) {
  if (!draft[i] || level(draft[i]) <= 0) return null;
  return draft.map((l, j) => (j === i ? { ...l, indentLevel: level(l) - 1 } : l));
}

/** Swap line i with its neighbour (dir -1 up, 1 down); null at an end. */
export function swapAt(draft, i, dir) {
  const j = i + dir;
  if (!draft[i] || j < 0 || j >= draft.length) return null;
  const next = draft.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/**
 * Where the toolbar's Add puts a new line: after the active line's whole
 * subtree (so its children aren't orphaned), as its sibling; at the end, at
 * level 0, when no line is active.
 * @returns {{ at: number, indentLevel: number }}
 */
export function siblingSlot(draft, activeIndex) {
  if (activeIndex < 0 || activeIndex >= draft.length) return { at: draft.length, indentLevel: 0 };
  const lvl = level(draft[activeIndex]);
  let j = activeIndex + 1;
  while (j < draft.length && level(draft[j]) > lvl) j++;
  return { at: j, indentLevel: lvl };
}

/** The draft with `line` inserted at index `at`. */
export function insertAt(draft, at, line) {
  const next = draft.slice();
  next.splice(at, 0, line);
  return next;
}

/** The draft without line i. */
export function removeAt(draft, i) {
  return draft.filter((_, j) => j !== i);
}

/**
 * The lines Merge joins: the ticked ones (two or more), in draft order, else
 * the active line and the one after it. [] when there is nothing to join.
 * @param {Array<{id:string}>} draft
 * @param {Set<string>} selectedIds
 * @param {number} activeIndex
 */
export function mergeIndices(draft, selectedIds, activeIndex) {
  const idx = selectedIds.size >= 2 ? tickedIndices(draft, selectedIds)
    : activeIndex >= 0 && activeIndex < draft.length - 1 ? [activeIndex, activeIndex + 1] : [];
  // A sketch (any kind, v3.24.0) is never merged with text.
  return idx.some((i) => isKindLine(draft[i])) ? [] : idx;
}

/** Indices of the ticked lines, in draft order. */
export function tickedIndices(draft, selectedIds) {
  return draft.map((l, i) => (selectedIds.has(l.id) ? i : -1)).filter((i) => i >= 0);
}

/**
 * Ids of the `base` lines (the saved lines Edit opened on) that the draft
 * deleted: gone from it, and not merged into a line still in it (a merged
 * line's ink follows the survivor, mergeTranscriptLines' `mergedIds`). Their
 * ink is what Library Edit's ink choice is about (v3.20.0).
 * @param {Array<{id: string, mergedIds?: string[]}>} draft
 * @param {Array<{id: string}>} base
 * @returns {string[]}
 */
export function deletedBaseIds(draft, base) {
  const kept = new Set();
  for (const l of draft || []) {
    kept.add(l.id);
    for (const id of l.mergedIds || []) kept.add(id);
  }
  // A deleted sketch's ink follows the same choice (v3.24.0).
  return (base || []).map((l) => l && l.id).filter((id) => id && !kept.has(id));
}
