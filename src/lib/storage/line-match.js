/**
 * line-match — which stored strokes a MyScript line covers (moved out of
 * save-page.js in v3.21.0 so Relink's plan, lib/relink-plan.js, uses the very
 * same matching code as the save; tested through save-page.test.js and
 * relink-plan.test.js).
 */
import { yBoundsToNcode } from '$lib/myscript-api.js';

/**
 * How far outside a line's own Y range a stroke may sit and still be counted as
 * part of it, in **Ncode units** (~2.4mm each; a recognised line is 2.4-5 units
 * tall across the saved corpus).
 *
 * MyScript's word boxes wrap the text core, so descenders, a stray i-dot and a
 * comma dropped below the baseline land just outside. This is the same number
 * TranscriptStrokePreview uses for its own "which strokes are this line?"
 * highlight - the two have to agree, or the preview shows one answer while the
 * saved lineId records another.
 */
export const LINE_MATCH_TOLERANCE_NCODE = 1;

/**
 * For each new MyScript line, find the storage-format strokes whose Y range
 * touches the line's. Used to attach lineId to strokes.
 *
 * A line's `yBounds` are MyScript **millimetres** measured from the batch
 * origin; stroke points are raw **Ncode**. They are not the same space, and
 * comparing them directly - as this did until Aug 2026 - links strokes to
 * whichever line happens to collide numerically. `yBoundsToNcode` is the inverse
 * of the transform `convertStrokesToMyScript` applied on the way out.
 *
 * The returned `overlap` is how much of the stroke's Y range falls inside the
 * line's, and is **negative** for a stroke matched only by the tolerance - so
 * ordering by it means "most overlapping, else nearest", which is what settles a
 * stroke that touches two lines.
 *
 * @param {Object} line - { yBounds: {minY, maxY} } in MyScript mm
 * @param {Array} storedStrokes - StoredStroke[]
 * @param {number} originNcodeY - see transcriptionOriginY
 * @param {number} tol - tolerance in Ncode units
 * @returns {Array<{id: string, overlap: number}>}
 */
export function strokesIntersectingLine(line, storedStrokes, originNcodeY, tol = LINE_MATCH_TOLERANCE_NCODE) {
  const range = yBoundsToNcode(line.yBounds, originNcodeY);
  // null covers an absent or unusable yBounds and an origin we could not work
  // out. Assigning nothing is right in both cases: a wrong link is worse than
  // none, since it also marks the stroke as already transcribed.
  if (!range) return [];

  const out = [];
  for (const s of storedStrokes) {
    if (!s.points || s.points.length === 0) continue;
    let minY = Infinity, maxY = -Infinity;
    for (const p of s.points) {
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
    const overlap = Math.min(maxY, range.maxY) - Math.max(minY, range.minY);
    if (overlap >= -tol) out.push({ id: s.id, overlap });
  }
  return out;
}

