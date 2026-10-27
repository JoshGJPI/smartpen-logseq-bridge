/**
 * save-transcript — persist inline transcript edits from the Book View back to
 * the PageDoc on disk.
 *
 * Unlike `save-page.js` (which Y-bounds-merges fresh MyScript output into the
 * existing transcript), this writes the user's edited lines verbatim. It:
 *   1. reads the current PageDoc (so we never clobber strokes),
 *   2. recomputes parentId from indentLevel so the hierarchy stays consistent,
 *   3. normalises each line to the TranscriptLine shape, and makes a plain line
 *      a task when a box was typed in front of it (`TODO`, `[ ]`, ☐, `DONE`,
 *      `[x]`, ☑: parseTypedTasks, as the Editor's dialog and transcription do),
 *   4. points a merged-away line's strokes at the line it was merged into, and
 *      scrubs `lineId` on strokes whose line was deleted,
 *   5. bumps timestamps and writes atomically via savePage().
 */

import { getPage, savePage } from '$lib/storage/local-store.js';
import { markerField } from '$lib/tasks.js';
import { keepDiskTaskState } from '$lib/editor-lines.js';
import { parseTaskMarker } from '$lib/task-markers.js';

/**
 * Recompute each line's parentId from its indentLevel: the parent is the
 * nearest preceding line with a strictly smaller indentLevel.
 * @template {{id:string, indentLevel?:number}} T
 * @param {T[]} lines
 * @returns {T[]} new array with parentId set
 */
export function recomputeParentIds(lines) {
  /** @type {{level:number, id:string}[]} */
  const stack = [];
  return lines.map((line) => {
    const level = Math.max(0, line.indentLevel || 0);
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    const parentId = stack.length ? stack[stack.length - 1].id : null;
    stack.push({ level, id: line.id });
    return { ...line, parentId };
  });
}

/**
 * Normalise an editor line into the persisted TranscriptLine shape.
 * @param {Object} line
 * @returns {import('$lib/storage/page-doc.js').TranscriptLine}
 */
function normaliseLine(line) {
  return {
    id: line.id,
    text: typeof line.text === 'string' ? line.text : '',
    indentLevel: Math.max(0, line.indentLevel || 0),
    parentId: line.parentId ?? null,
    checked: line.checked === true || line.checked === false ? line.checked : null,
    ...markerField(line),
    yBounds: line.yBounds ?? null,
  };
}

/**
 * A typed task box makes a plain line a task: a leading `TODO` / `[ ]` / ☐
 * (TODO) or `DONE` / `[x]` / ☑ (DONE) becomes `checked`, and is stripped from
 * the text. Only on lines new in the edit or whose text the edit changed, so a
 * saved line that happens to begin with "TODO" isn't converted by an unrelated
 * edit; a task's own state is never changed. WAITING / CANCELLED are never read
 * from text. Pure (exported for tests).
 * @template {{id: string, text: string, checked: boolean|null}} T
 * @param {T[]} lines  normalised lines
 * @param {Array<{id: string, text?: string}>|null} base  the lines the edit started from
 * @returns {T[]}
 */
export function parseTypedTasks(lines, base) {
  const baseText = new Map((base || []).filter((l) => l && l.id).map((l) => [l.id, l.text || '']));
  return lines.map((l) => {
    if (l.checked != null) return l;
    if (baseText.has(l.id) && baseText.get(l.id) === l.text) return l;
    const parsed = parseTaskMarker(l.text);
    return parsed.checked == null ? l : { ...l, text: parsed.text, checked: parsed.checked };
  });
}

/**
 * Save edited transcript lines for a page.
 * @param {number} book
 * @param {number} page
 * @param {Array<Object>} lines - editor line objects ({id, text, indentLevel, checked, yBounds})
 * @param {{ base?: Array<Object> }} [opts]  `base`: the lines the edit started
 *   from. A line whose task state the edit didn't change takes the state on
 *   disk, so a task change made after Edit was opened is not written back.
 * @returns {Promise<import('$lib/storage/page-doc.js').SaveResult & { lines: Array<Object> }>}
 *   `lines` as written
 */
export async function saveTranscriptLines(book, page, lines, { base = null } = {}) {
  const doc = await getPage(book, page);
  if (!doc) {
    throw new Error(`Cannot save transcript: page B${book}/P${page} not found`);
  }

  let normalised = recomputeParentIds(parseTypedTasks(lines.map(normaliseLine), base));
  if (base) normalised = keepDiskTaskState(normalised, base, doc.transcript?.lines || []);

  // A merged-away line's strokes go to the line it was merged into
  // (mergeTranscriptLines' in-memory mergedIds); any other lineId whose line
  // was deleted is scrubbed.
  const keptIds = new Set(normalised.map((l) => l.id));
  const remap = new Map();
  for (const l of lines) {
    for (const dead of l.mergedIds || []) if (dead !== l.id && !keptIds.has(dead)) remap.set(dead, l.id);
  }
  const strokes = (doc.strokes || []).map((s) => {
    if (!s.lineId || keptIds.has(s.lineId)) return s;
    return { ...s, lineId: remap.get(s.lineId) ?? null };
  });

  const now = new Date().toISOString();
  const next = {
    ...doc,
    strokes,
    transcript: {
      ...(doc.transcript || {}),
      lastTranscribed: now,
      lines: normalised,
    },
    metadata: {
      ...(doc.metadata || {}),
      lastUpdated: now,
    },
  };

  const result = await savePage(book, page, next);
  return result && typeof result === 'object' ? { ...result, lines: normalised } : result;
}
