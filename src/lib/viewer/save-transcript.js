/**
 * save-transcript — persist inline transcript edits from the Book View back to
 * the PageDoc on disk.
 *
 * Unlike `save-page.js` (which Y-bounds-merges fresh MyScript output into the
 * existing transcript), this writes the user's edited lines verbatim. It:
 *   1. reads the current PageDoc (so we never clobber strokes),
 *   2. recomputes parentId from indentLevel so the hierarchy stays consistent,
 *   3. normalises each line to the TranscriptLine shape,
 *   4. scrubs `lineId` on strokes whose line was deleted,
 *   5. bumps timestamps and writes atomically via savePage().
 */

import { getPage, savePage } from '$lib/storage/local-store.js';

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
    yBounds: line.yBounds ?? null,
  };
}

/**
 * Save edited transcript lines for a page.
 * @param {number} book
 * @param {number} page
 * @param {Array<Object>} lines - editor line objects ({id, text, indentLevel, checked, yBounds})
 * @returns {Promise<import('$lib/storage/page-doc.js').SaveResult>}
 */
export async function saveTranscriptLines(book, page, lines) {
  const doc = await getPage(book, page);
  if (!doc) {
    throw new Error(`Cannot save transcript: page B${book}/P${page} not found`);
  }

  const normalised = recomputeParentIds(lines.map(normaliseLine));

  // Scrub dangling lineId references on strokes whose line was deleted.
  const keptIds = new Set(normalised.map((l) => l.id));
  const strokes = (doc.strokes || []).map((s) =>
    s.lineId && !keptIds.has(s.lineId) ? { ...s, lineId: null } : s
  );

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

  return savePage(book, page, next);
}
