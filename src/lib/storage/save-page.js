/**
 * Save Page — convert in-memory pen state to a v2 PageDoc and write it.
 *
 * Phase 4: this is the SOLE save path. No LogSeq involvement.
 *
 * Semantics:
 *
 *   Strokes (append-only with explicit deletions):
 *     - Start from the existing PageDoc on disk as the base.
 *     - Remove strokes whose id is in deletedStrokeIds.
 *     - Append new strokes from the canvas (deduplicated by id).
 *     - Update lineId, the sketch flag and the textless flag on existing
 *       strokes if the in-memory version differs (textless only where the
 *       canvas set it true or false; a textless stroke always has lineId null).
 *     - Never infer deletions from count differences.
 *     - ONE exception to immutable geometry: rewrite a stored stroke's `points`
 *       when the canvas copy carries the `pointsEdited` marker, which only
 *       `removeStrokePoints()` / `snapStrokePoints()` in stores/strokes.js
 *       set. See mergeEditedPoints
 *       below for why the marker rather than a count comparison.
 *
 *   Transcript (incremental append):
 *     - If pageTranscription is provided, treat its `lines` as NEW lines (the
 *       ActionBar limits MyScript input to untranscribed strokes only).
 *     - Generate fresh UUIDs for the new lines.
 *     - For each new line, match strokes via Y-bounds overlap and write the
 *       new lineId onto those strokes. The line's yBounds are MyScript
 *       millimetres and have to be converted back to Ncode against the batch's
 *       own origin first - see transcriptionOriginY.
 *     - A page shown rotated (lib/page-orientation.js) was sent to MyScript
 *       turned upright, so its yBounds are in that upright frame. The match
 *       turns a COPY of the stored points the same way (`pageTranscription.rotation`);
 *       stored points are never rewritten.
 *     - Skip duplicate lines whose text+yBounds match an existing line.
 *     - Existing transcript.lines are preserved.
 *
 *   Transcript (confirmed in the Editor's Edit Transcription dialog):
 *     - The dialog opens on the page's saved lines plus the new ones, so its
 *       result is the whole transcript, not new lines. The Review tab records
 *       which saved line ids it was opened with (`editorBaseIds`). A line that
 *       carries a saved id (`blockUuid`) updates that line in place (text,
 *       indent; its id, checked / marker and yBounds stay); a line without one
 *       is new; a saved line the dialog dropped (merged or deleted) is removed,
 *       and strokes linked to a merged-away line follow the survivor
 *       (`mergedBlockPairs`). Saved lines the dialog never saw are kept.
 *     - Lines deleted with the dialog's Delete (v3.20.0) are listed on the
 *       result: `deletedLineIds` (saved lines) and `deletedLines` (lines of the
 *       run not saved yet, with their yBounds). Their ink is unlinked, and with
 *       `deletedInk: 'textless'` (the default) flagged `textless` in the same
 *       write (planTranscript's `textlessIds`, lib/deleted-ink.js).
 *       See applyEditorLines. Before Oct 2026 these lines went through the
 *       append-merge, which appended an edited line beside its original.
 *
 *   Transcript (a page reset for re-transcription, v3.17.0):
 *     - Reset (stores/transcript-reset.js) unlinks a loaded page's ink in
 *       memory; the next transcription of that page carries `replace: true`.
 *       Its lines become the whole transcript: the old lines are dropped (not
 *       kept beside the new ones), strokes whose stored lineId pointed at them
 *       take the new lines' links (every stroke of the page is relinked from
 *       the run, so ink left out of it, such as a drawing, is unlinked), and
 *       task state carries over by text
 *       (carryTaskState). A Reset with no new transcription saved changes
 *       nothing on disk (a null in-memory link never clears a stored one).
 *
 *   Transcript (Relink, v3.21.0, lib/relink.js):
 *     - `relink` (instead of a pageTranscription) carries a MyScript run of the
 *       whole page and the review's decisions. The stored lines are kept
 *       (ids, text, order, indent, parentId, checked, marker); linked lines
 *       take the run's yBounds, every stroke that was sent takes the line whose
 *       MyScript line covers it (or none), taken word fixes and lines added
 *       from leftover ink land in the same write, and `lastTranscribed` is
 *       bumped; a text line left unlinked gets `yBounds: null`. Refused when
 *       the page changed since the run (`stale`) or when no line would be
 *       linked (`noLinks`: the page would read as trustworthy, all ink unlinked).
 *
 *   planTranscript() is the one place that decides the written transcript,
 *   and the save dialog (page-changes.js) asks it too, so "will this save
 *   change the transcript?" has the same answer as the save.
 *
 *   The Pages tab's Edit structure (PageCard.svelte handleSaveEditor) still
 *   rewrites a saved transcript directly with savePage().
 */

import { getPage, savePage, deletePage } from './local-store.js';
import { emptyPageDoc, computeBounds, PAGE_DOC_VERSION } from './page-doc.js';
import { pageInfoForDisk } from '$lib/volumes.js';
import { strokesIntersectingLine } from './line-match.js';
import { normalizeRotation, rotateStoredPoints } from '$lib/page-orientation.js';
import { noteOnDiskStrokeIds } from '$stores/pending-changes.js';
import { parseTaskMarker, stripTaskMarker } from '$lib/task-markers.js';
import { taskStateOf, withTaskState } from '$lib/tasks.js';
import { round2, strokeToStored } from './stroke-format.js';
import { sameInk, shiftStoredStroke } from './duplicate-strokes.js';
import { INK_TEXTLESS, normalizeDeletedInk, withTextless } from '$lib/deleted-ink.js';
import { planRelink } from '$lib/relink-plan.js';

/* -----------------------------------------------------------------
 *  Stroke shape conversion
 * ----------------------------------------------------------------- */

// Moved to stroke-format.js (no imports, so print code can share it); re-exported
// here for the save path's existing callers.
export { round2, strokeToStored };

/* -----------------------------------------------------------------
 *  Transcript merge — Y-bounds matching
 * ----------------------------------------------------------------- */

function randomUUID() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const a = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(a);
  else for (let i = 0; i < 16; i++) a[i] = Math.floor(Math.random() * 256);
  a[6] = (a[6] & 0x0f) | 0x40;
  a[8] = (a[8] & 0x3f) | 0x80;
  const hex = [...a].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

/**
 * Do two Y-bound ranges overlap?
 */
function yBoundsOverlap(a, b, tol = 0) {
  if (!a || !b) return false;
  return !(a.maxY + tol < b.minY || b.maxY + tol < a.minY);
}

/**
 * Ncode Y that a MyScript batch's millimetre coordinates are anchored to.
 *
 * `convertStrokesToMyScript` shifts the batch so the topmost dot **of the
 * strokes it was handed** sits at the request padding, so the origin is the min
 * Y of exactly those strokes - not of the page. That distinction is the whole
 * point here: the ActionBar sends untranscribed strokes only, so on a page being
 * topped up the batch starts partway down and the page's own bounds would be the
 * wrong anchor.
 *
 * `setPageTranscription` measures it at recognition time and records it as
 * `originNcodeY`, which is the value to trust: it was taken from the strokes as
 * they were sent. Older entries (and any built by another path) carry only
 * `transcribedStrokeIds`, so those are re-measured here — bare
 * `String(startTime)` against stored `s{startTime}`.
 *
 * Falls back to every stroke on the page - the whole-page assumption - when the
 * transcription carries neither, or when none of its ids are still present
 * (e.g. the strokes were deleted between recognition and save).
 *
 * @param {Object|null} pageTranscription
 * @param {Array} storedStrokes StoredStroke[]
 * @returns {number} Ncode Y, or Infinity when there is nothing to anchor to
 */
export function transcriptionOriginY(pageTranscription, storedStrokes) {
  const recorded = pageTranscription?.originNcodeY;
  if (Number.isFinite(recorded)) return recorded;

  const raw = pageTranscription?.transcribedStrokeIds;
  let ids = null;
  if (Array.isArray(raw) && raw.length > 0) {
    ids = new Set();
    for (const id of raw) {
      const str = String(id);
      ids.add(str.startsWith('s') ? str : `s${str}`);
    }
  }

  const scan = (only) => {
    let min = Infinity;
    for (const s of storedStrokes || []) {
      if (!s || !Array.isArray(s.points) || s.points.length === 0) continue;
      if (only && !only.has(s.id)) continue;
      for (const p of s.points) {
        if (p[1] < min) min = p[1];
      }
    }
    return min;
  };

  const scoped = ids ? scan(ids) : Infinity;
  return Number.isFinite(scoped) ? scoped : scan(null);
}

/**
 * Skip-duplicate test: does a new MyScript line match an existing line by
 * trimmed-text + Y-bounds overlap?
 *
 * Both operands are MyScript millimetres, so unlike the stroke match this one
 * compares like with like and the 3 is 3mm - under half the ~7mm height of a
 * recognised line, which is the right order for "the same line, recognised
 * again". What it cannot see is that two batches with different origins (a
 * partial re-transcription - see transcriptionOriginY) put the same physical
 * line at different millimetre values, so a re-run over a shifted batch can slip
 * a duplicate past the Y test. The text still has to match exactly, which is
 * what keeps that from being common.
 */
function isDuplicate(newLine, existingLines) {
  // Compared without a leading task box: a line saved before boxes were parsed
  // still holds `☐ Call Troy…` as text, and its re-reading is `Call Troy…`.
  const t = stripTaskMarker(newLine.text);
  if (!t) return false;
  for (const ex of existingLines) {
    if (stripTaskMarker(ex.text) === t && yBoundsOverlap(ex.yBounds, newLine.yBounds, 3)) {
      return true;
    }
  }
  return false;
}

/**
 * Merge new MyScript lines into the existing transcript, preserving existing
 * lines untouched. Returns { lines, lineIdAssignments: Map<strokeId,lineId> }.
 */
function mergeTranscript(existingLines, myscriptLines, storedStrokes, originNcodeY) {
  // Existing lines keep their order untouched — the user (or an earlier
  // transcription) established it, and re-sorting the whole list scrambles it.
  const existing = [...existingLines];
  const lineIdAssignments = new Map(); // strokeId → new lineId

  if (!myscriptLines || myscriptLines.length === 0) {
    return { lines: existing, lineIdAssignments };
  }

  // Generate IDs upfront so parent linkage by index works
  const newIds = myscriptLines.map(() => randomUUID());

  // strokeId -> the overlap that won it its current line. A stroke whose Y range
  // touches two lines (common: ascenders, descenders, anything tall) goes to the
  // line it shares the most with, rather than to whichever line happened to be
  // considered last.
  const bestOverlap = new Map();

  const newLines = [];
  for (let i = 0; i < myscriptLines.length; i++) {
    const ms = myscriptLines[i];
    // A drawn box (☐ / ☑) or a typed TODO / DONE becomes the line's state.
    const { checked, text: parsed } = parseTaskMarker((ms.text || '').trim());
    const text = parsed.trim();

    const lineRecord = {
      id: newIds[i],
      text,
      indentLevel: ms.indentLevel || 0,
      parentId:
        (typeof ms.parent === 'number' && ms.parent >= 0 && ms.parent < newIds.length)
          ? newIds[ms.parent]
          : null,
      checked,
      yBounds: ms.yBounds && (ms.yBounds.minY !== 0 || ms.yBounds.maxY !== 0)
        ? { minY: ms.yBounds.minY, maxY: ms.yBounds.maxY }
        : null
    };

    if (isDuplicate(lineRecord, existing)) {
      continue;
    }

    newLines.push(lineRecord);

    // Attach lineId to strokes whose Y range overlaps the new line
    const matches = strokesIntersectingLine(lineRecord, storedStrokes, originNcodeY);
    for (const { id, overlap } of matches) {
      const held = bestOverlap.get(id);
      if (held === undefined || overlap > held) {
        bestOverlap.set(id, overlap);
        lineIdAssignments.set(id, lineRecord.id);
      }
    }
  }

  // Order the NEW lines among themselves top-to-bottom on the page, then append
  // them after the existing transcript. New transcription always lands at the
  // end rather than being interleaved into the existing lines by Y-position.
  newLines.sort((a, b) => {
    const ay = a.yBounds?.minY ?? 0;
    const by = b.yBounds?.minY ?? 0;
    return ay - by;
  });

  return { lines: [...existing, ...newLines], lineIdAssignments };
}

const sameLine = (a, b) =>
  a.id === b.id && a.text === b.text && (a.indentLevel || 0) === (b.indentLevel || 0)
  && (a.parentId ?? null) === (b.parentId ?? null) && (a.checked ?? null) === (b.checked ?? null)
  && (a.marker ?? null) === (b.marker ?? null);

/** Do two transcripts hold the same lines (ids, text, structure, task state)? */
export function transcriptLinesEqual(a, b) {
  const x = a || [], y = b || [];
  return x.length === y.length && x.every((l, i) => sameLine(l, y[i]));
}

/**
 * Apply the Edit Transcription dialog's result to the saved lines (see the
 * header). Pure; strokes are matched only for lines new in this result.
 *
 * @param {Array} existingLines  transcript.lines on disk
 * @param {Object} pageTranscription  `{ lines, editorBaseIds, mergedBlockPairs, ... }`
 * @returns {{ lines: Array, lineIdAssignments: Map<string,string>, lineIdRemap: Map<string,string> }}
 */
function applyEditorLines(existingLines, pageTranscription, storedStrokes, originNcodeY) {
  const byId = new Map(existingLines.map((l) => [l.id, l]));
  const base = new Set(pageTranscription.editorBaseIds || []);
  const unseen = existingLines.filter((l) => !base.has(l.id));
  const used = new Set();
  const out = [];
  const reparent = new Set(); // ids whose parentId is worked out again from indents
  const lineIdAssignments = new Map();
  const bestOverlap = new Map();

  for (const el of pageTranscription.lines || []) {
    const raw = (el.text || '').trim();
    const indentLevel = Math.max(0, Number(el.indentLevel) || 0);
    const ex = el.blockUuid ? byId.get(el.blockUuid) : null;
    if (ex && !used.has(ex.id)) {
      used.add(ex.id);
      if (!raw) continue; // emptied in the dialog: removed
      if (raw === ex.text && indentLevel === (ex.indentLevel || 0)) {
        out.push(ex);
        continue;
      }
      let next = { ...ex, text: raw, indentLevel };
      // A box typed onto a plain line makes it a task, as on transcription.
      if (raw !== ex.text && ex.checked == null) {
        const parsed = parseTaskMarker(raw);
        if (parsed.checked != null) next = { ...next, text: parsed.text.trim(), checked: parsed.checked };
        // A task merged under this plain line: the merged line keeps its state.
        else if (taskStateOf(el)) next = withTaskState(next, taskStateOf(el));
      }
      if (indentLevel !== (ex.indentLevel || 0)) reparent.add(ex.id);
      out.push(next);
      continue;
    }
    if (!raw) continue;
    const { checked, text } = parseTaskMarker(raw);
    // No box in the text, but a saved task was merged in: keep its state.
    const carried = checked == null && taskStateOf(el) ? withTaskState({}, taskStateOf(el)) : { checked };
    const rec = {
      id: randomUUID(),
      text: text.trim(),
      indentLevel,
      parentId: null,
      ...carried,
      yBounds: el.yBounds && (el.yBounds.minY !== 0 || el.yBounds.maxY !== 0)
        ? { minY: el.yBounds.minY, maxY: el.yBounds.maxY }
        : null
    };
    // Already saved since the dialog opened (a repeat save of the same result):
    // the saved copy is kept below, so don't add it twice.
    if (isDuplicate(rec, unseen)) continue;
    reparent.add(rec.id);
    out.push(rec);
    // Only lines from this transcription run are in its batch's coordinate
    // space; a merge that mixed in a saved line's bounds is not.
    if (el.fromBatch === false) continue;
    for (const { id, overlap } of strokesIntersectingLine(rec, storedStrokes, originNcodeY)) {
      const held = bestOverlap.get(id);
      if (held === undefined || overlap > held) {
        bestOverlap.set(id, overlap);
        lineIdAssignments.set(id, rec.id);
      }
    }
  }

  // Lines of the run deleted in the dialog keep the strokes they cover from
  // the kept lines (most overlap wins, a tie stays with the kept line): that
  // ink was the deleted line's, so it must not end up in a neighbour. Only
  // strokes that were in the batch count: the match is by Y alone, and a
  // sketch beside the line or ink left out of a partial selection is not its
  // ink. With the batch unknown (an older in-memory result) its ink is only
  // kept unlinked, never flagged.
  const sent = sentStrokeIds(pageTranscription);
  const deletedWins = new Set();
  for (const del of pageTranscription.deletedLines || []) {
    if (!del || del.fromBatch === false) continue;
    for (const { id, overlap } of strokesIntersectingLine(del, storedStrokes, originNcodeY)) {
      if (sent && !sent.has(id)) continue;
      const held = bestOverlap.get(id);
      if (held === undefined || overlap > held) {
        bestOverlap.set(id, overlap);
        lineIdAssignments.delete(id);
        deletedWins.add(id);
      }
    }
  }

  // Saved lines the dialog never had (written since it opened): kept, at the end.
  for (const l of existingLines) if (!used.has(l.id) && !base.has(l.id)) out.push(l);

  // parentId: kept unless the line's indent changed, it is new, or its parent is
  // gone or no longer above it (the dialog's Move, v3.17.0).
  const live = new Set(out.map((l) => l.id));
  const above = new Set();
  const lines = out.map((l, i) => {
    const keep = !reparent.has(l.id) && (l.parentId == null || above.has(l.parentId));
    above.add(l.id);
    if (keep) return l;
    let parentId = null;
    for (let j = i - 1; j >= 0 && l.indentLevel > 0; j--) {
      if ((out[j].indentLevel || 0) < l.indentLevel) { parentId = out[j].id; break; }
    }
    return (l.parentId ?? null) === parentId ? l : { ...l, parentId };
  });

  const lineIdRemap = new Map();
  for (const { deletedBlockUuid, survivingBlockUuid } of pageTranscription.mergedBlockPairs || []) {
    if (deletedBlockUuid && live.has(survivingBlockUuid) && !live.has(deletedBlockUuid)) {
      lineIdRemap.set(deletedBlockUuid, survivingBlockUuid);
    }
  }

  // The ink of the deleted lines: strokes linked to a deleted saved line, and
  // strokes won by a deleted line of the run that are linked to no line.
  const deletedSaved = new Set((pageTranscription.deletedLineIds || [])
    .filter((id) => id && !live.has(id) && !lineIdRemap.has(id)));
  const deletedInkIds = new Set();
  const unflaggable = new Set();
  for (const s of storedStrokes || []) {
    if (s.lineId ? deletedSaved.has(s.lineId) : deletedWins.has(s.id)) deletedInkIds.add(s.id);
    if (!s.lineId && !sent && deletedWins.has(s.id)) unflaggable.add(s.id);
  }
  return { lines, lineIdAssignments, lineIdRemap, deletedInkIds, unflaggable };
}

/**
 * The stroke ids a transcription run sent (`s{startTime}`), from the in-memory
 * `transcribedStrokeIds` setPageTranscription records (never on disk), or null
 * when the result doesn't say.
 * @param {Object|null} pageTranscription
 * @returns {Set<string>|null}
 */
export function sentStrokeIds(pageTranscription) {
  const raw = pageTranscription?.transcribedStrokeIds;
  if (!Array.isArray(raw)) return null;
  return new Set(raw.map((id) => (String(id).startsWith('s') ? String(id) : `s${id}`)));
}

/**
 * The transcript a save of `pageTranscription` would write over
 * `existingLines`: the append-merge for a MyScript result, applyEditorLines for
 * a result confirmed in the Edit Transcription dialog. Pure, so the save dialog
 * can ask the same question without writing (pass no strokes).
 *
 * `deletedInkIds` are the strokes of lines deleted in the dialog (none for a
 * MyScript result); `textlessIds` the ones the save flags `textless`: all of
 * them with `deletedInk: 'textless'` (the default), none with 'retry'. Pass
 * strokes with their `lineId` and without textless ones (never matched).
 *
 * With `{ relink }` (a lib/relink.js buildRelinkSpec() result, v3.21.0) the plan
 * is Relink's instead (lib/relink-plan.js): `pageTranscription` is ignored,
 * `lineIdAssignments` covers every sent stroke (null = unlinked) and
 * `textlessIds` the leftover ink marked Not text.
 *
 * @returns {{ lines: Array, changed: boolean, linesAdded: number,
 *   lineIdAssignments: Map<string,string>, lineIdRemap: Map<string,string>,
 *   deletedInkIds: Set<string>, textlessIds: Set<string> }}
 */
export function planTranscript(existingLines, pageTranscription, storedStrokes = [], originNcodeY = null, { relink = null } = {}) {
  const existing = Array.isArray(existingLines) ? existingLines : [];
  // Relink (v3.21.0): a plan kind of its own. The stored lines stay (ids, text,
  // order, structure, task state); only yBounds, stroke links, taken word fixes
  // and lines added from leftover ink change (lib/relink-plan.js).
  if (relink) return planRelink(existing, relink, storedStrokes, originNcodeY);
  const none = {
    lines: existing, changed: false, linesAdded: 0, lineIdAssignments: new Map(), lineIdRemap: new Map(),
    deletedInkIds: new Set(), textlessIds: new Set()
  };
  if (!hasTranscriptToPlan(pageTranscription)) return none;

  const fromEditor = Array.isArray(pageTranscription.editorBaseIds);
  // A page reset for re-transcription (v3.17.0): the new run is the whole
  // transcript, so it merges onto nothing (no line is skipped as a duplicate of
  // the old one) and the old lines go; the dialog path drops them because the
  // Review tab adds their ids to editorBaseIds. Task state follows the text.
  const replace = pageTranscription.replace === true;
  let { lines, lineIdAssignments, lineIdRemap = new Map(), deletedInkIds = new Set(), unflaggable = new Set() } = fromEditor
    ? applyEditorLines(existing, pageTranscription, storedStrokes, originNcodeY)
    : mergeTranscript(replace ? [] : existing, pageTranscription.lines, storedStrokes, originNcodeY);
  if (replace) {
    lines = carryTaskState(existing, lines);
    // The run already saved (the save dialog asking again): the same lines, kept.
    const same = (a, b) => a.text === b.text && (a.indentLevel || 0) === (b.indentLevel || 0)
      && (a.checked ?? null) === (b.checked ?? null) && (a.marker ?? null) === (b.marker ?? null);
    if (!fromEditor && lines.length === existing.length && lines.every((l, i) => same(l, existing[i]))) {
      const toOld = new Map(lines.map((l, i) => [l.id, existing[i].id]));
      lineIdAssignments = new Map([...lineIdAssignments].map(([s, id]) => [s, toOld.get(id) || id]));
      lines = existing;
    }
  }
  const before = new Set(existing.map((l) => l.id));
  return {
    lines,
    replace,
    changed: !transcriptLinesEqual(existing, lines),
    linesAdded: lines.filter((l) => !before.has(l.id)).length,
    lineIdAssignments,
    lineIdRemap,
    deletedInkIds,
    textlessIds: normalizeDeletedInk(pageTranscription.deletedInk) === INK_TEXTLESS
      ? new Set([...deletedInkIds].filter((id) => !unflaggable.has(id)))
      : new Set()
  };
}

/**
 * Is there a transcript for planTranscript / the save to apply? A MyScript
 * result with lines, or any result confirmed in the Edit Transcription dialog,
 * even one with every line deleted (v3.20.0: that empties the transcript).
 * @param {Object|null} pageTranscription
 */
export function hasTranscriptToPlan(pageTranscription) {
  if (!pageTranscription || !Array.isArray(pageTranscription.lines)) return false;
  return pageTranscription.lines.length > 0 || Array.isArray(pageTranscription.editorBaseIds);
}

/**
 * A re-transcription's lines take the task state of the old lines they replace
 * (v3.17.0): matched by text with the task box stripped, case aside, each old
 * line used once. The box the new run read wins where it disagrees on
 * open / closed (the ink is newer than the click); WAITING and CANCELLED, which
 * are never read from ink, carry when it agrees. Old lines still in `lines`
 * (kept, not replaced) carry nothing.
 *
 * @param {Array} oldLines  transcript.lines before
 * @param {Array} lines     the transcript about to be written
 * @returns {Array} `lines`, with state set on the new lines that match
 */
export function carryTaskState(oldLines, lines) {
  const kept = new Set(lines.map((l) => l.id));
  const key = (t) => stripTaskMarker(String(t || '')).trim().toLowerCase();
  const pool = new Map();
  for (const o of oldLines || []) {
    if (kept.has(o.id) || !taskStateOf(o)) continue;
    const k = key(o.text);
    if (!pool.has(k)) pool.set(k, []);
    pool.get(k).push(o);
  }
  if (!pool.size) return lines;
  const before = new Set((oldLines || []).map((o) => o.id));
  return lines.map((l) => {
    if (before.has(l.id)) return l;
    const o = (pool.get(key(l.text)) || []).shift();
    if (!o) return l;
    const mine = taskStateOf(l);
    if (mine && (l.checked === true) !== (o.checked === true)) return l;
    return withTaskState(l, taskStateOf(o));
  });
}

/**
 * Stored strokes as the transcription saw them: turned upright when the page
 * was sent rotated (ActionBar records the rotation on the transcription), so
 * their Y can be compared with the batch's yBounds and origin. A matching-only
 * copy of `{ id, lineId, points }` — never what is written back.
 *
 * @param {Array} storedStrokes
 * @param {number} [rotation]
 * @returns {Array}
 */
export function strokesInTranscriptionFrame(storedStrokes, rotation) {
  if (!normalizeRotation(rotation)) return storedStrokes;
  return storedStrokes.map(s => ({ id: s.id, lineId: s.lineId ?? null, points: rotateStoredPoints(s.points || [], rotation) }));
}

/* -----------------------------------------------------------------
 *  Main save entry point
 * ----------------------------------------------------------------- */

/**
 * @typedef {Object} SavePageInput
 * @property {number} book
 * @property {number} page
 * @property {Object[]} activeStrokes
 * @property {Set<string>} [deletedStrokeIds]
 * @property {Object|null} [pageTranscription]
 */

/**
 * @typedef {Object} SavePageOutput
 * @property {boolean} success
 * @property {number} added
 * @property {number} edited   - stored strokes whose points were rewritten
 * @property {number} deleted
 * @property {number} total
 * @property {number} lineCount
 * @property {number} [linesAdded]
 * @property {string} [path]
 * @property {string} [error]
 */

/**
 * Save a single page to the local data folder.
 * @param {SavePageInput} input
 * @returns {Promise<SavePageOutput>}
 */
export async function savePageToFolder(input) {
  const { book, page, activeStrokes = [], deletedStrokeIds = new Set(), pageTranscription = null, relink = null } = input;

  try {
    // `book` is a BOOK KEY ("388" or "388v2"). On disk it splits back into a
    // numeric `book` plus an optional `volume` (omitted when 1), which is what
    // keeps every pre-volume file byte-identical and validatePageDoc's
    // `typeof book === 'number'` check satisfied.
    const pageInfo = pageInfoForDisk(activeStrokes[0]?.pageInfo, book, page);

    const onDisk = await getPage(book, page);
    // Relink (v3.21.0) was planned from a MyScript run of the page as it was
    // then; a page written since is sent again, never relinked from a stale run.
    if (relink) {
      if (!onDisk) return { success: false, error: 'page not found', added: 0, edited: 0, deleted: 0, total: 0, lineCount: 0 };
      if ((onDisk.metadata?.lastUpdated || null) !== (relink.revision || null)) {
        return { success: false, stale: true, error: 'the page changed since it was sent to MyScript', added: 0, edited: 0, deleted: 0, total: 0, lineCount: 0 };
      }
    }
    const existing = onDisk || emptyPageDoc(pageInfo);
    if (existing.pageInfo) {
      if (!pageInfo.section && existing.pageInfo.section) pageInfo.section = existing.pageInfo.section;
      if (!pageInfo.owner && existing.pageInfo.owner)   pageInfo.owner = existing.pageInfo.owner;
    }

    // ----- Strokes: explicit deletions, then append new -----
    const newStored = activeStrokes.map(strokeToStored);
    const existingStrokes = Array.isArray(existing.strokes) ? existing.strokes : [];

    let merged;
    let deletedCount = 0;
    if (deletedStrokeIds && deletedStrokeIds.size > 0) {
      merged = existingStrokes.filter(s => !deletedStrokeIds.has(s.id));
      deletedCount = existingStrokes.length - merged.length;
    } else {
      merged = [...existingStrokes];
    }

    const existingIds = new Set(merged.map(s => s.id));
    let addedCount = 0;
    let editedCount = 0;
    const newById = new Map(newStored.map(s => [s.id, s]));

    // Ids whose captured geometry the user edited (points deleted or snapped). Derived from
    // the canvas strokes we were handed rather than passed in separately, so the
    // intent travels with the stroke it belongs to and can't be mismatched.
    //
    // Deliberately keyed on the explicit `pointsEdited` marker and NOT on "the
    // canvas copy has fewer points than the stored one". Append-only exists to
    // make partial canvas state incapable of destroying stored data; a count
    // comparison would hand that power to any future code path that filters a
    // dotArray for its own purposes. The marker is set in exactly one place.
    const editedIds = new Set(
      activeStrokes.filter(s => s && s.pointsEdited).map(s => `s${s.startTime}`)
    );

    // "Not text" (v3.20.0), set or cleared on the canvas. Only an explicit
    // true / false is synced: a canvas copy without the key (loaded before a
    // Library delete flagged the stroke) has no say and leaves the disk alone.
    const textlessIntent = new Map(
      activeStrokes.filter(s => s && typeof s.textless === 'boolean').map(s => [`s${s.startTime}`, s.textless])
    );

    // Sync mutable per-stroke state from the canvas onto strokes already on disk:
    // lineId and the sketch and textless flags are annotations the user changes after the fact,
    // and points are rewritten only for explicitly edited strokes.
    // The disk's link of each stroke whose link the canvas changed: a canvas
    // link that turns out not to be a line of the transcript written (a stale
    // copy still pointing at a line deleted or merged elsewhere) gives way to it.
    const diskLinkBeforeSync = new Map();
    merged = merged.map(s => {
      const fresh = newById.get(s.id);
      if (!fresh) return s;

      let next = s;
      if (fresh.lineId && fresh.lineId !== s.lineId) {
        diskLinkBeforeSync.set(s.id, s.lineId ?? null);
        next = { ...next, lineId: fresh.lineId };
      }
      // Two-way: marking and unmarking both have to persist, and `sketch` is
      // absent rather than false when off, so compare as booleans.
      if (!!fresh.sketch !== !!s.sketch) {
        next = { ...next };
        if (fresh.sketch) next.sketch = true;
        else delete next.sketch;
      }
      // Geometry rewrite. `fresh.points` came through strokeToStored, so the
      // surviving points keep their `[x, y, ts|null, force]` shape — a sketch
      // stroke stays a pressure-varying sketch across the edit. Assigning into
      // the existing key keeps `points` in its original position, so the
      // serialized line's key order is unchanged.
      if (editedIds.has(s.id) && Array.isArray(fresh.points)) {
        next = { ...next, points: fresh.points };
        editedCount++;
      }
      if (textlessIntent.has(s.id)) next = withTextless(next, textlessIntent.get(s.id));
      // A textless stroke is in no line, whatever a stale canvas link says.
      if (next.textless && next.lineId != null) next = { ...next, lineId: null };
      return next;
    });

    // Append new strokes. `existingIds` grows as they land, so two canvas
    // strokes with the same start time can never both be written under one id
    // (B1211/P20, 2026-11-11: every later delete / edit by id would hit both).
    // An exact second copy is dropped; a DIFFERENT stroke that shares the time is
    // real ink and lands on the next free millisecond (lib/storage/duplicate-strokes.js).
    // Only strokes new to this page take part: one already on disk, matched by
    // id above, keeps its id and is never re-timed here.
    const appendedById = new Map();
    let reIdedCount = 0;
    for (const s of newStored) {
      if (!existingIds.has(s.id)) {
        merged.push(s);
        existingIds.add(s.id);
        appendedById.set(s.id, s);
        addedCount++;
        continue;
      }
      const twin = appendedById.get(s.id);
      if (!twin || sameInk(twin, s) || !Number.isFinite(s.startTime)) continue;
      let t = s.startTime + 1;
      while (existingIds.has(`s${t}`)) t++;
      const moved = shiftStoredStroke(s, t - s.startTime);
      merged.push(moved);
      existingIds.add(moved.id);
      appendedById.set(moved.id, moved);
      addedCount++;
      reIdedCount++;
    }

    merged.sort((a, b) => (a.startTime || 0) - (b.startTime || 0));

    // ----- Transcript: append-merge, or the Edit Transcription result -----
    let transcript = existing.transcript || { lastTranscribed: null, lines: [] };
    let linesAdded = 0;
    let transcriptChanged = false;
    let textlessIds = new Set();
    let unlinkedIds = new Set();

    if (hasTranscriptToPlan(pageTranscription)) {
      // Textless ink is never matched to a line (it was left out on purpose).
      const frameStrokes = strokesInTranscriptionFrame(merged.filter(s => !s.textless), pageTranscription.rotation);
      const plan = planTranscript(
        transcript.lines || [],
        pageTranscription,
        frameStrokes,
        transcriptionOriginY(pageTranscription, frameStrokes)
      );
      linesAdded = plan.linesAdded;
      transcriptChanged = plan.changed;
      textlessIds = plan.textlessIds;
      unlinkedIds = new Set([...plan.deletedInkIds].filter(id => !textlessIds.has(id)));

      if (plan.changed || plan.lineIdAssignments.size > 0 || textlessIds.size > 0) {
        const planIds = new Set(plan.lines.map(l => l.id));
        merged = merged.map(s => {
          // Ink of a line deleted in the dialog, left out as Not text.
          if (textlessIds.has(s.id)) return withTextless(s, true);
          if (s.textless) return s;
          // A re-transcription relinks the whole page from this run: its old
          // links are what was wrong (a drawing in the batch, 3017/182), even
          // where the text came out the same. The page was loaded whole
          // (stores/transcript-reset.js refuses a partial load).
          if (plan.replace) {
            const id = plan.lineIdAssignments.get(s.id) || null;
            return (s.lineId || null) === id ? s : { ...s, lineId: id };
          }
          // A line merged away in the dialog hands its strokes to the survivor.
          const remapped = s.lineId && plan.lineIdRemap.get(s.lineId);
          if (remapped) return { ...s, lineId: remapped };
          // Already linked to a line that stays — leave it alone. A link to a
          // line this save removes (a re-transcription replacing the old
          // transcript) is no link: the stroke may take a new line.
          if (s.lineId && planIds.has(s.lineId)) return s;
          const newLineId = plan.lineIdAssignments.get(s.id);
          if (newLineId) return { ...s, lineId: newLineId };
          return s;
        });

        transcript = {
          lastTranscribed: new Date().toISOString(),
          lines: plan.lines
        };
      }
    }

    // ----- Relink (v3.21.0): new links for the sent ink, the stored lines kept -----
    let relinked = 0;
    let relinkLinks = null;
    if (relink) {
      const frameStrokes = strokesInTranscriptionFrame(merged.filter(s => !s.textless), relink.rotation);
      const plan = planTranscript(transcript.lines || [], null, frameStrokes, relink.originNcodeY, { relink });
      // Linking no line would only bump lastTranscribed: the page would read as
      // trustworthy with all its ink unlinked, and drop off Relink's list.
      if (!plan.linked) {
        return { success: false, noLinks: true, error: 'no stored line would be linked to ink', added: 0, edited: 0, deleted: 0, total: 0, lineCount: 0 };
      }
      relinkLinks = plan.links;
      linesAdded = plan.linesAdded;
      transcriptChanged = plan.changed;
      textlessIds = plan.textlessIds;
      relinked = plan.linked;
      merged = merged.map(s => {
        if (textlessIds.has(s.id)) return withTextless(s, true);
        if (!plan.lineIdAssignments.has(s.id)) return s;
        const id = plan.lineIdAssignments.get(s.id) || null;
        return (s.lineId || null) === id ? s : { ...s, lineId: id };
      });
      // The links now come from the fixed matching code, which is what
      // isTrustworthyTranscript() reads this date for.
      transcript = { ...transcript, lastTranscribed: new Date().toISOString(), lines: plan.lines };
    }

    // Scrub any dangling lineIds (defensive — e.g. after editor-driven deletes).
    // A dead link the canvas synced in never replaces a live one on disk.
    {
      const liveLineIds = new Set(transcript.lines.map(l => l.id));
      merged = merged.map(s => {
        if (!s.lineId || liveLineIds.has(s.lineId)) return s;
        const before = diskLinkBeforeSync.get(s.id);
        const keep = !s.textless && before && liveLineIds.has(before) ? before : null;
        return { ...s, lineId: keep };
      });
    }

    const doc = {
      version: PAGE_DOC_VERSION,
      pageInfo,
      metadata: {
        lastUpdated: new Date().toISOString(),
        totalStrokes: merged.length,
        bounds: computeBounds(merged)
      },
      transcript,
      strokes: merged
    };

    const result = await savePage(book, page, doc);

    // Refresh the on-disk stroke-id index so pendingChanges reflects the save
    // immediately (just-saved strokes stop counting as additions) without a
    // full rescan. `page` is the integer NCode page used for capture saves,
    // which matches how canvas strokes are grouped in pendingChanges.
    noteOnDiskStrokeIds(book, page, merged);

    return {
      success: true,
      added: addedCount,
      edited: editedCount,
      deleted: deletedCount,
      reIded: reIdedCount,
      total: merged.length,
      lineCount: doc.transcript.lines.length,
      linesAdded,
      transcriptChanged,
      // The ink of lines deleted in the dialog, for the canvas copy
      // (stores/canvas-save.js): flagged textless, or only unlinked.
      textlessIds: [...textlessIds],
      unlinkedIds: [...unlinkedIds],
      ...(relink ? { relinked, strokes: merged, links: relinkLinks } : {}),
      path: result.path
    };
  } catch (err) {
    console.error('[savePageToFolder] failed:', err);
    return {
      success: false,
      error: err.message || String(err),
      added: 0, edited: 0, deleted: 0, total: 0, lineCount: 0
    };
  }
}

/* -----------------------------------------------------------------
 *  Volume moves — tidy up after the strokes have landed
 * ----------------------------------------------------------------- */

/**
 * Pure core of the whole-page move decision.
 *
 * Strokes move because `reassignVolume()` rewrote their pageInfo and the source
 * page's save deleted them by id (see `getMovedAwayStrokeIdsForPage`). Two things
 * that does NOT move on its own:
 *
 *   1. **The transcript.** Lines live in `doc.transcript.lines`, not on strokes,
 *      so moving every stroke off a page leaves the recognised text behind, with
 *      the strokes' lineIds already scrubbed. Nothing links them any more.
 *   2. **The file.** A page emptied of strokes is still written, so it lingers as
 *      a 0-stroke ghost in Saved Pages and Book View.
 *
 * Only carried when the source ends up genuinely empty and exactly one target
 * received its strokes — a partial move is a partial move, and splitting a
 * transcript by guesswork would be worse than leaving it put.
 *
 * @param {{strokeCount: number, lineCount: number}} source  state AFTER the save
 * @param {{lineCount: number}} target                       state AFTER the save
 * @param {number} targetCount how many distinct pages received this page's strokes
 * @returns {{carryTranscript: boolean, deleteSource: boolean}}
 */
export function planPageMove(source, target, targetCount) {
  const sourceEmptyOfStrokes = (source?.strokeCount || 0) === 0;
  const sourceHasTranscript = (source?.lineCount || 0) > 0;
  const targetHasTranscript = (target?.lineCount || 0) > 0;

  // Never overwrite a transcript the target already has — that's real recognised
  // text and the source's claim to it is no stronger.
  const carryTranscript =
    sourceEmptyOfStrokes && sourceHasTranscript && !targetHasTranscript && targetCount === 1;

  const deleteSource = sourceEmptyOfStrokes && (carryTranscript || !sourceHasTranscript);

  return { carryTranscript, deleteSource };
}

/**
 * Run `planPageMove` against disk for each completed move.
 *
 * Called AFTER the per-page saves, so it never races them: by this point the
 * source page has already lost its strokes and the target has already gained
 * them, and both docs on disk are final.
 *
 * Best-effort — a failure here leaves a ghost page, not lost data, so it logs
 * and continues rather than failing the save that already succeeded.
 *
 * `emptied` lists the whole-page moves (the source has no strokes left and
 * fed exactly one target), so page tags, which live outside the PageDoc in
 * `_tags.json`, can follow them (stores/tags.js carryTagsForMoves).
 *
 * @param {Array<{fromBook: string, fromPage: number|string, toBook: string, toPage: number|string}>} moves
 * @returns {Promise<{transcriptsMoved: number, pagesDeleted: number, errors: string[], emptied: Array}>}
 */
export async function finalizePageMoves(moves) {
  const out = { transcriptsMoved: 0, pagesDeleted: 0, errors: [], emptied: [] };
  if (!Array.isArray(moves) || moves.length === 0) return out;

  // How many distinct targets each source fed — a source split across two
  // volumes has no single place for its transcript to follow.
  const targetsPerSource = new Map();
  for (const m of moves) {
    const srcKey = `${m.fromBook}/${m.fromPage}`;
    if (!targetsPerSource.has(srcKey)) targetsPerSource.set(srcKey, new Set());
    targetsPerSource.get(srcKey).add(`${m.toBook}/${m.toPage}`);
  }

  const seen = new Set();
  for (const m of moves) {
    const srcKey = `${m.fromBook}/${m.fromPage}`;
    if (seen.has(srcKey)) continue;
    seen.add(srcKey);

    try {
      const sourceDoc = await getPage(m.fromBook, m.fromPage);
      if (!sourceDoc) continue;

      const sourceState = {
        strokeCount: (sourceDoc.strokes || []).length,
        lineCount: (sourceDoc.transcript?.lines || []).length
      };
      const targetDoc = await getPage(m.toBook, m.toPage);
      const targetState = { lineCount: (targetDoc?.transcript?.lines || []).length };

      const plan = planPageMove(sourceState, targetState, targetsPerSource.get(srcKey).size);
      if (sourceState.strokeCount === 0 && targetsPerSource.get(srcKey).size === 1) {
        out.emptied.push({ fromBook: m.fromBook, fromPage: m.fromPage, toBook: m.toBook, toPage: m.toPage });
      }

      if (plan.carryTranscript && targetDoc) {
        await savePage(m.toBook, m.toPage, {
          ...targetDoc,
          transcript: sourceDoc.transcript,
          metadata: { ...(targetDoc.metadata || {}), lastUpdated: new Date().toISOString() }
        });
        out.transcriptsMoved++;
      }

      if (plan.deleteSource) {
        await deletePage(m.fromBook, m.fromPage);
        out.pagesDeleted++;
      }
    } catch (err) {
      out.errors.push(`${srcKey}: ${err.message || String(err)}`);
    }
  }

  return out;
}
