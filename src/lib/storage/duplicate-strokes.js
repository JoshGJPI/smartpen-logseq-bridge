/**
 * duplicate-strokes — strokes on one page that share an id (v3.18.0). Pure: the
 * save (`save-page.js`) and the cleanup dialog (`DuplicateStrokesDialog`) read
 * and write pages; this decides what changes.
 *
 * A stroke's id is `s{startTime}`, and everything that removes or edits a stored
 * stroke finds it by id: a deletion, a point edit or a retime of one copy would
 * hit every copy, and the Editor's load (`mergeCanvasStrokes`) keeps only the
 * first, so the others can't be seen or selected there. Found on B1211/P20
 * (2026-11-11): two DIFFERENT strokes (9 and 8 points, different shapes) with
 * the same start time, saved together from one canvas, because the save's
 * append loop checked new ids against the disk only, not against each other.
 *
 * Two kinds of copy, told apart by their points:
 *   - an exact copy (same points, same end time) is the same ink twice: removed;
 *   - a different stroke is real ink that happens to share the time: kept, under
 *     the first free millisecond after it (start, end and numeric point
 *     timestamps shift together, as `lib/retime.js` does). A 1 ms shift changes
 *     no date anyone can see. The dialog can remove one instead.
 * The FIRST stroke in file order always keeps the id.
 *
 * Tested in `src/lib/__tests__/duplicate-strokes.test.js`.
 */

import { computeBounds } from './page-doc.js';

/** Same ink: same end time and identical point tuples. */
export function sameInk(a, b) {
  if (!a || !b) return false;
  if ((a.endTime ?? null) !== (b.endTime ?? null)) return false;
  const pa = Array.isArray(a.points) ? a.points : [];
  const pb = Array.isArray(b.points) ? b.points : [];
  if (pa.length !== pb.length) return false;
  for (let i = 0; i < pa.length; i++) {
    const x = pa[i], y = pb[i];
    if (!Array.isArray(x) || !Array.isArray(y) || x.length !== y.length) return false;
    for (let k = 0; k < x.length; k++) if (x[k] !== y[k]) return false;
  }
  return true;
}

/** Number of stored strokes beyond the first for each id (0 = clean). */
export function countDuplicateStrokes(strokes) {
  const seen = new Set();
  let n = 0;
  for (const s of strokes || []) {
    if (!s || !s.id) continue;
    if (seen.has(s.id)) n++;
    else seen.add(s.id);
  }
  return n;
}

/**
 * A copy of a stored stroke moved by `deltaMs`: id, start, end and every
 * numeric point timestamp. Null point timestamps, force, sketch and lineId stay.
 */
export function shiftStoredStroke(stroke, deltaMs) {
  const startTime = stroke.startTime + deltaMs;
  const next = { ...stroke, id: `s${startTime}`, startTime };
  if (Number.isFinite(stroke.endTime)) next.endTime = stroke.endTime + deltaMs;
  if (Array.isArray(stroke.points)) {
    next.points = stroke.points.map((p) => (Array.isArray(p) && typeof p[2] === 'number'
      ? [p[0], p[1], p[2] + deltaMs, ...p.slice(3)]
      : p));
  }
  return next;
}

/** The first `s{t}` with t > startTime not in `taken`. */
function freeTime(startTime, taken) {
  let t = startTime + 1;
  while (taken.has(`s${t}`)) t++;
  return t;
}

/**
 * @typedef {Object} DuplicateCopy
 * @property {string} id        the id it shares
 * @property {number} index     its position in `strokes`
 * @property {'remove'|'reid'} action
 * @property {boolean} exact    same ink as the stroke that keeps the id
 * @property {string} [newId]   for 'reid'
 * @property {number} pointCount
 * @property {number} keptPointCount  points on the stroke that keeps the id
 */

/**
 * What cleaning one page's strokes would change. Strokes without a usable
 * start time are left alone (nothing to shift), and so are their copies.
 * @param {Array} strokes  stored strokes, in file order
 * @returns {DuplicateCopy[]}
 */
export function planDuplicateCleanup(strokes) {
  const list = Array.isArray(strokes) ? strokes : [];
  const firstById = new Map();
  const taken = new Set();
  for (const s of list) if (s && s.id) taken.add(s.id);

  const copies = [];
  list.forEach((s, index) => {
    if (!s || !s.id) return;
    const first = firstById.get(s.id);
    if (!first) { firstById.set(s.id, s); return; }
    const exact = sameInk(first, s);
    const base = { id: s.id, index, exact,
      pointCount: (s.points || []).length, keptPointCount: (first.points || []).length };
    if (exact || !Number.isFinite(s.startTime) || `s${s.startTime}` !== s.id) {
      if (!exact) return; // an id that isn't its time: not ours to renumber
      copies.push({ ...base, action: 'remove' });
      return;
    }
    const newId = `s${freeTime(s.startTime, taken)}`;
    taken.add(newId);
    copies.push({ ...base, action: 'reid', newId });
  });
  return copies;
}

/**
 * The strokes with `copies` applied, sorted by start time. A copy applies only
 * while the stroke at its index still has that id, so a page that changed since
 * the preview is never cleaned from a stale plan (re-plan instead).
 *
 * @param {Array} strokes
 * @param {DuplicateCopy[]} copies  each may have its action overridden by the caller
 * @returns {{ strokes: Array, removed: number, reIded: number, skipped: number }}
 */
export function applyDuplicateCleanup(strokes, copies) {
  const list = Array.isArray(strokes) ? strokes : [];
  const byIndex = new Map((copies || []).map((c) => [c.index, c]));
  const taken = new Set(list.map((s) => s && s.id));
  let removed = 0, reIded = 0, skipped = 0;
  const out = [];
  list.forEach((s, index) => {
    const c = byIndex.get(index);
    if (!c) { out.push(s); return; }
    if (!s || s.id !== c.id) { skipped++; out.push(s); return; }
    if (c.action === 'remove') { removed++; return; }
    let t = Number(String(c.newId || '').slice(1));
    if (!Number.isFinite(t) || t <= s.startTime || (taken.has(`s${t}`) && `s${t}` !== s.id)) {
      t = freeTime(s.startTime, taken);
    }
    taken.add(`s${t}`);
    out.push(shiftStoredStroke(s, t - s.startTime));
    reIded++;
  });
  out.sort((a, b) => (a?.startTime || 0) - (b?.startTime || 0));
  return { strokes: out, removed, reIded, skipped };
}

/**
 * Clean one PageDoc: plan + apply, with metadata brought in line. Returns the
 * input object itself when nothing changed.
 * @param {Object} doc
 * @param {DuplicateCopy[]} [copies]  defaults to `planDuplicateCleanup(doc.strokes)`
 * @param {string} [now]
 */
export function cleanPageDoc(doc, copies = null, now = new Date().toISOString()) {
  const strokes = (doc && doc.strokes) || [];
  const plan = copies || planDuplicateCleanup(strokes);
  const r = applyDuplicateCleanup(strokes, plan);
  if (!r.removed && !r.reIded) return { doc, ...r };
  return {
    doc: {
      ...doc,
      metadata: { ...(doc.metadata || {}), lastUpdated: now, totalStrokes: r.strokes.length,
        bounds: computeBounds(r.strokes) },
      strokes: r.strokes,
    },
    ...r,
  };
}
