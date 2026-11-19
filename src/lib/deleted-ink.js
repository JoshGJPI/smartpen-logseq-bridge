/**
 * deleted-ink — what happens to the ink of transcript lines deleted by hand
 * (v3.20.0, docs/TRANSCRIPT-STRUCTURE-SPEC.md Phase A), and the stored stroke
 * flag `textless` ("Not text": left out of transcripts, never sent to MyScript).
 *
 * The Edit Transcription dialog and Library Edit ask once per save:
 *   'textless' (default)  the ink is Not text: flagged, unlinked, never sent again
 *   'retry'               the ink is only unlinked, so the next Transcribe sends it
 * Either way no stroke is deleted.
 *
 * Pure: every function returns new objects. Used by save-page.js (the Review
 * tab's save), save-transcript.js (Library Edit) and PageCard (Pages tab).
 */

export const INK_TEXTLESS = 'textless';
export const INK_RETRY = 'retry';

/** The choice as stored on a transcription / passed to a save; anything else reads as the default. */
export function normalizeDeletedInk(v) {
  return v === INK_RETRY ? INK_RETRY : INK_TEXTLESS;
}

/**
 * A stored stroke with `textless` set or cleared. Set: `textless: true` and
 * `lineId: null` (a textless stroke is never in a line). Cleared: the key is
 * removed (absent, not false, like `sketch`); the stroke stays unlinked.
 * Returns the same object when nothing changes.
 * @template {{textless?: boolean, lineId?: string|null}} T
 * @param {T} stroke
 * @param {boolean} on
 * @returns {T}
 */
export function withTextless(stroke, on) {
  if (on) {
    if (stroke.textless === true && stroke.lineId == null) return stroke;
    return { ...stroke, lineId: null, textless: true };
  }
  if (!('textless' in stroke)) return stroke;
  const { textless, ...rest } = stroke;
  return /** @type {T} */ (rest);
}

/**
 * Settle the ink of deleted lines on stored strokes: a stroke linked to one of
 * `lineIds`, or listed in `strokeIds` (ink of a line that was never saved),
 * loses its link, and with 'textless' is flagged. A stroke linked to a line
 * that is not deleted is never touched.
 *
 * @param {Array<{id: string, lineId?: string|null}>} strokes  stored strokes
 * @param {{ lineIds?: Iterable<string>, strokeIds?: Iterable<string>, mode?: string }} opts
 * @returns {{ strokes: Array, textless: string[], unlinked: string[] }}
 *   `textless` / `unlinked`: ids of the strokes settled each way
 */
export function settleDeletedInk(strokes, { lineIds = [], strokeIds = [], mode } = {}) {
  const lines = new Set(lineIds);
  const ids = new Set(strokeIds);
  const flag = normalizeDeletedInk(mode) === INK_TEXTLESS;
  const textless = [];
  const unlinked = [];
  const out = (strokes || []).map((s) => {
    const mine = (s.lineId && lines.has(s.lineId)) || (!s.lineId && ids.has(s.id));
    if (!mine) return s;
    if (flag) {
      textless.push(s.id);
      return withTextless(s, true);
    }
    unlinked.push(s.id);
    return s.lineId == null ? s : { ...s, lineId: null };
  });
  return { strokes: out, textless, unlinked };
}

/**
 * Does a dialog / draft line have ink to ask about? A saved line (its strokes
 * may be linked to it) or a line from a transcription run not yet saved (its
 * strokes were sent). A line typed by hand has none.
 * @param {{blockUuid?: string|null, fromBatch?: boolean, yBounds?: {minY: number, maxY: number}|null}} line
 */
export function lineHasInk(line) {
  if (!line) return false;
  if (line.blockUuid) return true;
  const y = line.yBounds;
  return line.fromBatch === true && !!y && (y.minY !== 0 || y.maxY !== 0);
}

/**
 * Stored strokes after a transcript edit that writes the page directly
 * (Library Edit, the Pages tab's Edit structure): a merged-away line's
 * strokes go to the line it was merged into (`remap`), the ink of the
 * `deletedLineIds` is settled (flagged with 'textless', else unlinked), and any
 * other link to a line that is gone is dropped. No stroke is removed.
 *
 * @param {Array<{id: string, lineId?: string|null}>} strokes
 * @param {{ liveIds: Set<string>, remap?: Map<string, string>,
 *   deletedLineIds?: Iterable<string>, deletedInk?: string|null }} opts
 * @returns {{ strokes: Array, textless: string[], unlinked: string[] }}
 *   `textless` / `unlinked`: ids of strokes this edit flagged / only unlinked
 *   (for the canvas copies, stores/textless.js syncCanvasAfterPageWrite)
 */
export function relinkAfterEdit(strokes, { liveIds, remap = new Map(), deletedLineIds = [], deletedInk = null }) {
  const dead = [...deletedLineIds].filter((id) => id && !liveIds.has(id) && !remap.has(id));
  const settled = deletedInk === INK_TEXTLESS
    ? settleDeletedInk(strokes || [], { lineIds: dead, mode: INK_TEXTLESS })
    : { strokes: strokes || [], textless: [] };
  const unlinked = [];
  const out = settled.strokes.map((s) => {
    let lineId = s.lineId;
    if (lineId && remap.has(lineId)) lineId = remap.get(lineId);
    if (lineId && !liveIds.has(lineId)) lineId = null;
    if (lineId === s.lineId) return s;
    if (lineId === null) unlinked.push(s.id);
    return { ...s, lineId };
  });
  return { strokes: out, textless: settled.textless, unlinked };
}

/**
 * Ids of the lines that have ink linked to them, from a page's stored strokes
 * (Library Edit's ink choice counts only deleted lines that had ink).
 * @param {Array<{lineId?: string|null}>} strokes
 * @returns {Set<string>}
 */
export function linkedLineIds(strokes) {
  const out = new Set();
  for (const s of strokes || []) if (s && s.lineId) out.add(s.lineId);
  return out;
}
