/**
 * Point-level stroke editing — pure geometry helpers.
 *
 * WHY THIS EXISTS
 *
 * The pen occasionally emits a dot at or near the Ncode origin in the middle of
 * an otherwise sound stroke. The renderer joins consecutive dots, so one bad dot
 * draws two long lines out to the page's top-left corner and back. Deleting the
 * whole stroke loses real handwriting; the fix is to drop the single point.
 *
 * IDENTITY IS NOT RECOMPUTED
 *
 * A stroke's id is `s{startTime}` (see stroke-storage.js) and it is what
 * deduplication, transcript `lineId` links and the LogSeq asset merge all key on.
 * Removing the first or last point therefore does NOT change `startTime` /
 * `endTime` — the stroke is the same stroke, minus a bad sample. `dotType` is
 * re-tagged (first = pen-down, last = pen-up) because it is positional by
 * definition, but nothing downstream of the store reads it for stored strokes.
 *
 * DETECTION IS ADVISORY
 *
 * `detectStrayPoints()` only highlights candidates. Nothing is removed until the
 * user asks, because "far from its neighbours" is a heuristic and a deliberate
 * fast pen movement can look the same.
 */

/**
 * A stroke needs two points to draw a line — the canvas renderer and both SVG
 * paths skip anything shorter. Rather than silently leave an invisible stroke
 * behind, point removal refuses to cross this floor and reports it, so the caller
 * can offer whole-stroke deletion instead.
 */
export const MIN_STROKE_POINTS = 2;

/** Ncode mm within which a point counts as "at the origin". */
export const ORIGIN_TOLERANCE = 0.5;

/**
 * How many times the stroke's typical point spacing a gap must exceed to read as
 * a stray. Generous on purpose: the comparison is against a median, and a fast
 * pen stroke legitimately spaces its dots several times wider than a slow one.
 */
export const DEFAULT_JUMP_FACTOR = 6;

/**
 * A gap must also be this many Ncode mm to read as a stray, not just wide
 * relative to its neighbours.
 *
 * Without an absolute floor the relative test fires on legitimate short strokes:
 * a comma or a flick whose first points are 0.2mm apart and whose tail travels
 * 3mm is a 15× jump by the relative measure, and would be offered up for
 * deletion. A genuine stray sample lands tens of mm away — usually at the origin,
 * ~40mm from where the writing is — so a floor costs nothing real. False
 * positives matter more than missed candidates here, because the panel offers a
 * "Delete all" button; anything the detector misses can still be clicked by hand.
 */
export const MIN_JUMP_DISTANCE = 8;

/** Minimum points needed before the jump test has a meaningful typical spacing. */
const MIN_POINTS_FOR_JUMP_TEST = 4;

/**
 * Read a stroke's points. Store strokes use `dotArray`; the renderer's live
 * capture buffer uses `dots`.
 * @param {Object} stroke
 * @returns {Array<{x:number,y:number,f?:number,timestamp?:number,dotType?:number}>}
 */
export function strokeDots(stroke) {
  return (stroke && (stroke.dotArray || stroke.dots)) || [];
}

/**
 * Stable key for one point, so selections can live in a plain Set.
 * @param {number} strokeIndex - index into the strokes store
 * @param {number} pointIndex - index into that stroke's dotArray
 * @returns {string}
 */
export function pointKey(strokeIndex, pointIndex) {
  return `${strokeIndex}:${pointIndex}`;
}

/**
 * Inverse of pointKey.
 * @param {string} key
 * @returns {{strokeIndex:number, pointIndex:number}|null}
 */
export function parsePointKey(key) {
  const m = /^(\d+):(\d+)$/.exec(String(key));
  if (!m) return null;
  return { strokeIndex: Number(m[1]), pointIndex: Number(m[2]) };
}

/**
 * Group point keys by their stroke.
 * @param {Iterable<string>} keys
 * @returns {Map<number, Set<number>>} strokeIndex → point indices
 */
export function groupPointKeys(keys) {
  const grouped = new Map();
  for (const key of keys || []) {
    const parsed = parsePointKey(key);
    if (!parsed) continue;
    if (!grouped.has(parsed.strokeIndex)) grouped.set(parsed.strokeIndex, new Set());
    grouped.get(parsed.strokeIndex).add(parsed.pointIndex);
  }
  return grouped;
}

function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Median of a numeric array. Used instead of a mean because the whole point is
 * to measure "typical" spacing in a series that contains the outlier we're
 * hunting — a mean would be dragged toward it.
 */
function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Find points in one stroke that look like capture errors.
 *
 * Two independent detectors:
 *
 *   - `origin` — the point sits at (0, 0), or its coordinates aren't finite.
 *     This is the reported failure mode and is not a judgement call.
 *   - `jump` — the point is far from its neighbours, both relative to the
 *     stroke's own typical spacing and in absolute terms (see MIN_JUMP_DISTANCE).
 *     An interior point must be far from BOTH neighbours (it darts away and comes
 *     straight back); an endpoint has only one neighbour to compare against, which
 *     is what catches a stray leading or trailing dot that isn't exactly at the
 *     origin.
 *
 * @param {Object} stroke
 * @param {Object} [options]
 * @param {number} [options.originTolerance]
 * @param {number} [options.jumpFactor]
 * @param {number} [options.minJumpDistance]
 * @returns {Array<{index:number, reason:'origin'|'jump'}>} ascending by index
 */
export function detectStrayPoints(stroke, options = {}) {
  const {
    originTolerance = ORIGIN_TOLERANCE,
    jumpFactor = DEFAULT_JUMP_FACTOR,
    minJumpDistance = MIN_JUMP_DISTANCE
  } = options;

  const dots = strokeDots(stroke);
  const reasons = new Map();

  for (let i = 0; i < dots.length; i++) {
    const d = dots[i];
    const bad =
      !Number.isFinite(d.x) ||
      !Number.isFinite(d.y) ||
      (Math.abs(d.x) <= originTolerance && Math.abs(d.y) <= originTolerance);
    if (bad) reasons.set(i, 'origin');
  }

  if (dots.length >= MIN_POINTS_FOR_JUMP_TEST) {
    // steps[i] is the distance from dot i to dot i+1.
    const steps = [];
    for (let i = 1; i < dots.length; i++) steps.push(distance(dots[i - 1], dots[i]));

    const typical = median(steps.filter(s => s > 0));
    if (typical > 0) {
      const limit = Math.max(typical * jumpFactor, minJumpDistance);
      for (let i = 0; i < dots.length; i++) {
        if (reasons.has(i)) continue;
        const stepIn = i > 0 ? steps[i - 1] : null;
        const stepOut = i < dots.length - 1 ? steps[i] : null;
        const farIn = stepIn === null || stepIn > limit;
        const farOut = stepOut === null || stepOut > limit;
        // Both sides must be far. For an endpoint the missing side is treated as
        // far, so its single real step decides.
        if (farIn && farOut) reasons.set(i, 'jump');
      }
    }
  }

  return [...reasons.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, reason]) => ({ index, reason }));
}

/**
 * Run detectStrayPoints across several strokes.
 * @param {Array<{strokeIndex:number, stroke:Object}>} entries
 * @param {Object} [options] - forwarded to detectStrayPoints
 * @returns {Array<{strokeIndex:number, pointIndex:number, reason:string, dot:Object}>}
 */
export function detectStrayPointsForStrokes(entries, options = {}) {
  const found = [];
  for (const { strokeIndex, stroke } of entries || []) {
    const dots = strokeDots(stroke);
    for (const { index, reason } of detectStrayPoints(stroke, options)) {
      found.push({ strokeIndex, pointIndex: index, reason, dot: dots[index] });
    }
  }
  return found;
}

/**
 * Re-tag positional dotType after a removal: first = pen-down, last = pen-up,
 * the rest pen-move. Only allocates for dots whose tag actually changes, and
 * leaves dots that never carried a dotType alone.
 */
function retagDotTypes(dots) {
  const last = dots.length - 1;
  return dots.map((d, i) => {
    if (d.dotType === undefined) return d;
    const want = i === 0 ? 0 : i === last ? 2 : 1;
    return d.dotType === want ? d : { ...d, dotType: want };
  });
}

/**
 * Remove points from a stroke, returning a new stroke object.
 *
 * Operates on `dotArray` (the store's shape). Derived caches computed from the
 * geometry are dropped: `_nb` (Ncode bounding box, used for viewport culling)
 * and `_sw` (sketch width array) would both otherwise survive the object spread
 * and describe the pre-edit stroke.
 *
 * @param {Object} stroke
 * @param {Set<number>|number[]} pointIndices
 * @returns {{stroke: Object|null, removed: number, remaining: number}}
 *   `stroke` is null when the removal would leave fewer than MIN_STROKE_POINTS —
 *   nothing is changed in that case and the caller should offer to delete the
 *   whole stroke instead.
 */
export function removePointsFromStroke(stroke, pointIndices) {
  const drop = pointIndices instanceof Set ? pointIndices : new Set(pointIndices || []);
  const dots = stroke?.dotArray || [];

  if (drop.size === 0) {
    return { stroke, removed: 0, remaining: dots.length };
  }

  const kept = dots.filter((_, i) => !drop.has(i));
  const removed = dots.length - kept.length;

  if (removed === 0) {
    return { stroke, removed: 0, remaining: dots.length };
  }
  if (kept.length < MIN_STROKE_POINTS) {
    return { stroke: null, removed, remaining: kept.length };
  }

  const next = { ...stroke, dotArray: retagDotTypes(kept) };
  delete next._nb;
  delete next._sw;
  return { stroke: next, removed, remaining: kept.length };
}

/**
 * Format a point for display in the edit panel.
 * @param {Object} dot
 * @returns {string}
 */
export function formatPointCoords(dot) {
  if (!dot) return '—';
  const fmt = (n) => (Number.isFinite(n) ? n.toFixed(2) : String(n));
  return `${fmt(dot.x)}, ${fmt(dot.y)}`;
}
