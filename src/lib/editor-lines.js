/**
 * editor-lines — the Edit Transcription dialog's line operations (merge,
 * split) and the rule for task state when an edited transcript is written
 * back. Pure; TranscriptionEditorModal, PageCard and save-transcript use it.
 *
 * Task state (`checked`, `marker`) is not editable in the dialog or the
 * reader's Edit mode, so it must survive every edit there:
 *   - a merged line takes the state of its first part that is a task,
 *   - the first half of a split keeps the line's state, the second is plain,
 *   - on save, a line whose state the user didn't change takes the state on
 *     disk, so a tick made while the editor was open is not written back.
 */

import { markerField, taskStateOf } from '$lib/tasks.js';

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
  const built = (editedLines || []).map((l) => ({
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
