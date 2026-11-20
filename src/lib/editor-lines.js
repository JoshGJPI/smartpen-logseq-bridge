/**
 * editor-lines — the Edit Transcription dialog's line operations (merge,
 * split, delete and its undo history; the Library reader's merge) and the rule for task state when an
 * edited transcript is written back. Pure; TranscriptionEditorModal, PageCard,
 * TranscriptPane and save-transcript use it.
 *
 * Task state (`checked`, `marker`) is not editable in the dialog or the
 * reader's Edit mode, so it must survive every edit there:
 *   - a merged line takes the state of its first part that is a task,
 *   - the first half of a split keeps the line's state, the second is plain,
 *   - on save, a line whose state the user didn't change takes the state on
 *     disk, so a tick made while the editor was open is not written back.
 */

import { markerField, taskStateOf } from '$lib/tasks.js';
import { deleteLines } from '$lib/delete-lines.js';
import { lineHasInk } from '$lib/deleted-ink.js';
import { isKindLine, kindFields, normalizeKindLine } from '$lib/line-kinds.js';

/**
 * `{ checked, marker? }` of the first task among `lines`, else `{}`.
 * @param {Array<{checked?: boolean|null, marker?: string|null}>} lines
 */
export function taskFieldsOf(lines) {
  const t = (lines || []).find((l) => l && (l.checked === true || l.checked === false));
  return t ? { checked: t.checked, ...markerField(t) } : {};
}

/**
 * One dialog line from several (in page order). The first part is the
 * survivor: its id and blockUuid are kept, the others' blocks are deleted.
 * @param {Array<object>} parts  at least two editor lines
 */
export function mergeEditorLines(parts) {
  const allBlockUuids = parts.map((l) => l.blockUuid).filter(Boolean);
  return {
    text: parts.map((l) => l.text).join(' '),
    canonical: parts.map((l) => l.canonical).join(' '),
    yBounds: {
      minY: Math.min(...parts.map((l) => l.yBounds.minY)),
      maxY: Math.max(...parts.map((l) => l.yBounds.maxY))
    },
    mergedLineCount: parts.reduce((sum, l) => sum + (l.mergedLineCount || 1), 0),
    indentLevel: parts[0].indentLevel || 0,
    // Only if every part came from the batch — a merged yBounds spanning a
    // disk line and a fresh one belongs to neither origin.
    fromBatch: parts.every((l) => l.fromBatch),
    blockUuid: parts[0].blockUuid,
    mergedBlockUuids: allBlockUuids,
    blocksToDelete: allBlockUuids.slice(1),
    syncStatus: 'modified',
    id: parts[0].id,
    originalIndex: parts[0].originalIndex,
    userModified: true,
    sourceLines: parts.map((l) => l.originalIndex),
    ...taskFieldsOf(parts)
  };
}

/**
 * The Library reader's Edit mode merge: the lines at `indices` become one, in
 * the first one's place. The first line is the survivor (id, indent); texts
 * are joined with spaces in page order, yBounds span the parts that have
 * them, task state is the first task's (taskFieldsOf). The survivor lists the
 * ids merged into it in `mergedIds` (in-memory only; the save points those
 * lines' strokes at it). Fewer than two valid indices → `lines` unchanged.
 * @template {{id: string, text?: string, yBounds?: {minY: number, maxY: number}|null, mergedIds?: string[]}} T
 * @param {T[]} lines
 * @param {number[]} indices
 * @returns {T[]}
 */
export function mergeTranscriptLines(lines, indices) {
  const idx = [...new Set(indices)].filter((i) => i >= 0 && i < lines.length).sort((a, b) => a - b);
  // A sketch (any kind, v3.24.0) is never merged with text.
  if (idx.length < 2 || idx.some((i) => isKindLine(lines[i]))) return lines;
  const parts = idx.map((i) => lines[i]);
  const bounds = parts.map((l) => l.yBounds).filter(Boolean);
  const { checked, marker, ...first } = parts[0];
  const merged = {
    ...first,
    text: parts.map((l) => (l.text || '').trim()).filter(Boolean).join(' '),
    yBounds: bounds.length
      ? { minY: Math.min(...bounds.map((b) => b.minY)), maxY: Math.max(...bounds.map((b) => b.maxY)) }
      : null,
    checked: null,
    ...taskFieldsOf(parts),
    mergedIds: [...(first.mergedIds || []), ...parts.slice(1).flatMap((l) => [l.id, ...(l.mergedIds || [])])],
  };
  const drop = new Set(idx.slice(1));
  return lines.flatMap((l, i) => (i === idx[0] ? [merged] : drop.has(i) ? [] : [l]));
}

/**
 * A dialog line split in two at the cursor. The first half keeps the line's
 * block and task state; the second is a new plain line.
 * @returns {[object, object]}
 */
export function splitEditorLine(line, text1, text2) {
  const midY = (line.yBounds.minY + line.yBounds.maxY) / 2;
  const line1 = {
    text: text1.trim(),
    canonical: text1.trim(),
    yBounds: { minY: line.yBounds.minY, maxY: midY },
    mergedLineCount: 1,
    indentLevel: line.indentLevel || 0,
    fromBatch: line.fromBatch,
    blockUuid: line.blockUuid,
    syncStatus: line.blockUuid ? 'modified' : (line.syncStatus || 'synced'),
    id: line.id,
    originalIndex: line.originalIndex,
    userModified: true,
    ...taskFieldsOf([line])
  };
  const line2 = {
    text: text2.trim(),
    canonical: text2.trim(),
    yBounds: { minY: midY, maxY: line.yBounds.maxY },
    mergedLineCount: 1,
    indentLevel: line.indentLevel || 0,
    // Halves of a split inherit the parent's coordinate space. 'new' here
    // means "no block yet", which is not the same question.
    fromBatch: line.fromBatch,
    syncStatus: 'new',
    id: `${line.id}-split`,
    originalIndex: line.originalIndex,
    userModified: true
  };
  return [line1, line2];
}

/**
 * Saved lines with the disk's task state wherever the editor didn't change
 * it: a line whose id is on disk and in `base` (the lines the editor opened
 * on) and whose state equals its base state takes the disk line's state.
 * A state the edit did change (a merge onto a plain line) is kept.
 *
 * @template {{id: string, checked?: boolean|null, marker?: string}} T
 * @param {T[]} lines  the lines about to be written
 * @param {Array<{id: string}>} base  the same lines when the editor opened
 * @param {Array<{id: string}>} disk  transcript.lines on disk now
 * @returns {T[]}
 */
export function keepDiskTaskState(lines, base, disk) {
  const baseById = new Map((base || []).filter((l) => l && l.id).map((l) => [l.id, l]));
  const diskById = new Map((disk || []).filter((l) => l && l.id).map((l) => [l.id, l]));
  return (lines || []).map((l) => {
    const b = baseById.get(l.id);
    const d = diskById.get(l.id);
    if (!b || !d || taskStateOf(l) !== taskStateOf(b) || taskStateOf(l) === taskStateOf(d)) return l;
    const { checked, marker, ...rest } = l;
    return { ...rest, checked: d.checked === true || d.checked === false ? d.checked : null, ...markerField(d) };
  });
}

/**
 * The transcript the Editor Pages tab's Edit dialog writes (PageCard): the
 * dialog's lines as TranscriptLines (the dialog's blockUuid is the line id,
 * parentId re-derived from indents), task state from disk where the dialog
 * didn't change it, and where a merged-away line's strokes now point.
 *
 * @param {Array<object>} editedLines  the dialog's result
 * @param {Array<{id: string}>} base  transcript.lines when the dialog opened
 * @param {Array<{id: string}>} disk  transcript.lines on disk now
 * @param {() => string} newId  id for a line new in the dialog
 * @returns {{ lines: Array<object>, lineIdRemap: Map<string, string> }}
 */
export function buildEditedTranscript(editedLines, base, disk, newId) {
  const built = (editedLines || []).map((l) => (isKindLine(l)
    // A sketch row (v3.24.0): kind and box kept, never a task, a cleared label reads "Sketch".
    ? normalizeKindLine({ id: l.blockUuid || newId(), text: (l.text || '').trim(), indentLevel: l.indentLevel || 0, parentId: null, ...kindFields(l) })
    : {
      id: l.blockUuid || newId(),
      text: (l.text || '').trim(),
      indentLevel: l.indentLevel || 0,
      parentId: null,
      checked: l.checked ?? null,
      ...markerField(l),
      yBounds: l.yBounds && (l.yBounds.minY !== 0 || l.yBounds.maxY !== 0)
        ? { minY: l.yBounds.minY, maxY: l.yBounds.maxY }
        : null
    }));
  // parent = nearest preceding line with a lower indentLevel
  for (let i = 0; i < built.length; i++) {
    const lvl = built[i].indentLevel;
    for (let j = i - 1; lvl > 0 && j >= 0; j--) {
      if ((built[j].indentLevel || 0) < lvl) {
        built[i].parentId = built[j].id;
        break;
      }
    }
  }
  // A merge: strokes of the merged-away lines go to the survivor.
  const lineIdRemap = new Map();
  for (const l of editedLines || []) {
    if (Array.isArray(l.blocksToDelete) && l.blockUuid) {
      for (const dead of l.blocksToDelete) {
        if (dead && dead !== l.blockUuid) lineIdRemap.set(dead, l.blockUuid);
      }
    }
  }
  return { lines: keepDiskTaskState(built, base, disk), lineIdRemap };
}

/**
 * The dialog's status for a line: 'new' (no saved counterpart), 'modified'
 * (saved, and changed in the dialog) or 'synced' (saved, unchanged).
 *
 * A line with no saved counterpart stays new however much it is edited:
 * "modified" only means something relative to a copy already on disk.
 *
 * @param {{syncStatus?: string, blockUuid?: string|null, userModified?: boolean}} line
 * @returns {'new'|'modified'|'synced'}
 */
export function editorLineStatus(line) {
  if (line.syncStatus === 'new' || !line.blockUuid) return 'new';
  if (line.syncStatus === 'modified' || line.userModified) return 'modified';
  return 'synced';
}

/**
 * Adjacent pairs that look like one sentence broken across two lines: same
 * indent, the first doesn't end a sentence, the second starts lowercase, and
 * they sit close together on the page. Lines without yBounds are never paired.
 *
 * @param {Array<{text?: string, indentLevel?: number, yBounds?: {minY: number, maxY: number}|null}>} lines
 * @returns {Array<{indices: [number, number], confidence: number}>}
 */
export function detectMergeSuggestions(lines) {
  const suggestions = [];
  for (let i = 0; i < (lines || []).length - 1; i++) {
    const current = lines[i];
    const next = lines[i + 1];
    if (!current?.yBounds || !next?.yBounds || isKindLine(current) || isKindLine(next)) continue;
    const sameLine =
      (current.indentLevel || 0) === (next.indentLevel || 0) &&
      !/[.!?]$/.test(current.text || '') &&
      /^[a-z]/.test(next.text || '') &&
      Math.abs(current.yBounds.maxY - next.yBounds.minY) < 20;
    if (sameLine) suggestions.push({ indices: [i, i + 1], confidence: 0.8 });
  }
  return suggestions;
}

/**
 * The dialog's Delete (v3.20.0): the lines at `indices` deleted
 * (lib/delete-lines.js: children move up a level, or with `block` go too).
 * A line whose indent changed is marked edited, like the dialog's Indent.
 *
 * @param {Array<object>} lines  the dialog's lines
 * @param {number[]} indices
 * @param {{ block?: boolean }} [opts]
 * @returns {{ lines: Array<object>, removed: Array<object> }}
 */
export function deleteEditorLines(lines, indices, opts = {}) {
  const r = deleteLines(lines, indices, opts);
  const moved = new Set(r.outdented);
  return {
    lines: r.lines.map((l, i) => (moved.has(i)
      ? { ...l, userModified: true, ...(l.blockUuid && l.syncStatus === 'synced' ? { syncStatus: 'modified' } : {}) }
      : l)),
    removed: r.removed
  };
}

/**
 * What the save needs to know about the lines deleted in the dialog: the saved
 * line ids (a deleted merged line's absorbed lines too) and, for lines of the
 * run not saved yet that have ink, their yBounds (the save matches their
 * strokes as it matches a new line's). Lines typed in the dialog have no ink
 * and are left out.
 *
 * @param {Array<object>} deleted  dialog lines removed by Delete
 * @returns {{ deletedLineIds: string[], deletedLines: Array<{yBounds: {minY: number, maxY: number}, fromBatch: true}> }}
 */
export function deletedLinesForSave(deleted) {
  const ids = new Set();
  const batch = [];
  for (const l of deleted || []) {
    if (!l) continue;
    for (const id of [l.blockUuid, ...(l.blocksToDelete || [])]) if (id) ids.add(id);
    if (!l.blockUuid && lineHasInk(l)) {
      batch.push({ yBounds: { minY: l.yBounds.minY, maxY: l.yBounds.maxY }, fromBatch: true });
    }
  }
  return { deletedLineIds: [...ids], deletedLines: batch };
}

/**
 * Undo history of the dialog, as plain data so it can be tested: `steps` are
 * JSON copies of `{ lines, deleted }`, `at` the current one.
 * @typedef {{ steps: Array<{lines: Array<object>, deleted: Array<object>}>, at: number }} EditorHistory
 */

/** A history holding only `state`. @returns {EditorHistory} */
export function startHistory(state) {
  return { steps: [JSON.parse(JSON.stringify(state))], at: 0 };
}

/**
 * Record `state` as the next step (drops any redo steps). A state equal to the
 * current step adds nothing, so one Undo is one change.
 * @param {EditorHistory} h
 * @returns {EditorHistory}
 */
export function pushHistory(h, state) {
  const snapshot = JSON.stringify(state);
  if (h.at >= 0 && JSON.stringify(h.steps[h.at]) === snapshot) return h;
  return { steps: [...h.steps.slice(0, h.at + 1), JSON.parse(snapshot)], at: h.at + 1 };
}

/**
 * One step back (-1) or forward (+1): the new history and a copy of the state
 * to show, or null when there is no such step.
 * @param {EditorHistory} h
 * @returns {{ history: EditorHistory, state: {lines: Array<object>, deleted: Array<object>} } | null}
 */
export function stepHistory(h, delta) {
  const at = h.at + delta;
  if (at < 0 || at >= h.steps.length) return null;
  return { history: { ...h, at }, state: JSON.parse(JSON.stringify(h.steps[at])) };
}

/**
 * A saved transcript's lines in the dialog's shape (the Review tab's Edit
 * Structure): the line id is the dialog's `blockUuid`, task state rides along
 * so a merge or split carries it.
 * @param {Array<object>} savedLines  transcript.lines on disk
 * @returns {Array<object>}
 */
export function savedLinesForEditor(savedLines) {
  return (savedLines || []).map((l) => ({
    text: l.text || '',
    canonical: (l.text || '').trim().toLowerCase(),
    yBounds: l.yBounds || { minY: 0, maxY: 0 },
    indentLevel: l.indentLevel || 0,
    blockUuid: l.id,
    checked: l.checked ?? null,
    ...markerField(l),
    // A sketch row (v3.24.0): shown with its thumbnail, label editable, never merged or split.
    ...kindFields(l),
    syncStatus: 'synced'
  }));
}

/**
 * The dialog's opening lines for a run: the saved lines, then the run's lines
 * that aren't already among them (text + Y-overlap), marked new.
 *
 * `fromBatch` marks the lines whose yBounds came from the transcription run
 * being confirmed, so the stroke preview knows which origin to undo. It is not
 * the same as `syncStatus: 'new'`, which only means "has no block yet" and is
 * also set on the second half of a split.
 * @param {Array<object>} existing  savedLinesForEditor()
 * @param {Array<object>} fresh  the run's lines
 * @returns {Array<object>}
 */
export function mergeExistingAndNewLines(existing, fresh) {
  const asNew = (l) => ({ ...l, syncStatus: 'new', fromBatch: true });
  if (!existing || existing.length === 0) return (fresh || []).map(asNew);
  const out = [...existing];
  for (const newLine of fresh || []) {
    const newText = (newLine.text || '').trim().toLowerCase();
    const dup = existing.some((e) => {
      if ((e.canonical || '') !== newText) return false;
      const eY = e.yBounds, nY = newLine.yBounds;
      if (!eY || !nY) return false;
      return !(eY.maxY + 3 < nY.minY || nY.maxY + 3 < eY.minY);
    });
    if (!dup) out.push(asNew(newLine));
  }
  return out;
}

/**
 * The dialog's lines whose text was emptied (v3.20.0: an emptied line is a
 * Delete, decided at Confirm), and the lines as the delete prompt should name
 * them: an emptied line is named by its text when the dialog opened, so a task
 * confirm doesn't read "Delete the task ''?".
 *
 * @param {Array<object>} lines  the dialog's lines
 * @param {Array<object>} opened  the lines the dialog opened on (indexed by `originalIndex`)
 * @returns {{ indices: number[], named: Array<object> }}
 */
export function emptiedLines(lines, opened) {
  const indices = [];
  const named = (lines || []).map((l, i) => {
    // A sketch's cleared label is not a delete (it reads "Sketch", v3.24.0).
    if ((l.text || '').trim() !== '' || isKindLine(l)) return l;
    indices.push(i);
    const was = (opened || [])[l.originalIndex];
    return { ...l, text: (was && was.text) || '' };
  });
  return { indices, named };
}
