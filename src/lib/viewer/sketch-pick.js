/**
 * sketch-pick — the reader's Mark sketch pick, stroke by stroke (v3.29.0).
 * Pure: no stores, no IO. SketchMarkLayer holds the state; PageInk draws it.
 *
 * A pick is two sets of stroke ids (disk ids, as in the PageDoc):
 *   chosen   the strokes that go into the sketch (or, in 'remove' mode, out of it)
 *   offered  strokes a box touched that are in a text line or another sketch and
 *            are left there (drawn in a second colour, never taken silently)
 *
 * A box picks strokes wholly inside it, as lib/viewer/sketch-lines.js boxPick:
 * a stroke in no line (or Not text, or linked to a line that is gone) is chosen;
 * one in a line is offered, unless it was already chosen. Ctrl adds a box to
 * the pick, Shift takes a box away, a plain box starts again. A click toggles one
 * stroke in or out of `chosen` (a click is a deliberate pick, so an in-line
 * stroke clicked is taken). Per line, "Take them" / "Leave" move the line's
 * picked strokes between the sets.
 *
 * Modes (stores/sketch-lines.js sketchMark): 'create' (Mark sketch), 'add'
 * (Add strokes… to `lineId`: its own strokes are not pickable) and 'remove'
 * (Remove strokes…: only its own strokes are pickable, and all are chosen).
 */
import { isKindLine } from '../line-kinds.js';
import { plural } from '../plural.js';

/** @returns {{ chosen: Set<string>, offered: Set<string> }} */
export function emptyPick() {
  return { chosen: new Set(), offered: new Set() };
}

function lineIndex(doc) {
  const lines = (doc && doc.transcript && doc.transcript.lines) || [];
  return { lines, idx: new Map(lines.map((l, i) => [l.id, i])) };
}

/** The live line a stroke is in (index into the transcript), or undefined. */
function lineOf(s, idx) {
  return s && s.lineId && !s.textless ? idx.get(s.lineId) : undefined;
}

/** Can this stroke be picked in this mode? */
export function pickable(s, { mode = 'create', lineId = null } = {}) {
  if (!s || !Array.isArray(s.points) || !s.points.length) return false;
  if (mode === 'remove') return !!lineId && s.lineId === lineId;
  if (mode === 'add') return !(lineId && s.lineId === lineId);
  return true;
}

function wholly(s, box) {
  return s.points.every((p) => p[0] >= box.minX && p[0] <= box.maxX && p[1] >= box.minY && p[1] <= box.maxY);
}

/** Ids of the pickable strokes wholly inside `box` (Ncode). */
export function boxIds(doc, box, opts = {}) {
  if (!box) return [];
  return ((doc && doc.strokes) || []).filter((s) => pickable(s, opts) && wholly(s, box)).map((s) => s.id);
}

/**
 * A box's strokes applied to the pick: 'replace' (a plain drag), 'add' (Ctrl)
 * or 'subtract' (Shift).
 */
export function applyBox(pick, doc, ids, how = 'replace', { mode = 'create' } = {}) {
  const chosen = how === 'replace' ? new Set() : new Set(pick.chosen);
  const offered = how === 'replace' ? new Set() : new Set(pick.offered);
  if (how === 'subtract') {
    for (const id of ids) { chosen.delete(id); offered.delete(id); }
    return { chosen, offered };
  }
  const { idx } = lineIndex(doc);
  const byId = new Map(((doc && doc.strokes) || []).map((s) => [s.id, s]));
  for (const id of ids) {
    if (chosen.has(id)) continue;
    const inLine = mode !== 'remove' && lineOf(byId.get(id), idx) !== undefined;
    (inLine ? offered : chosen).add(id);
  }
  return { chosen, offered };
}

/** A click on a stroke: in the sketch if it wasn't, out of the pick altogether if it was. */
export function toggleStroke(pick, id) {
  const chosen = new Set(pick.chosen);
  const offered = new Set(pick.offered);
  if (chosen.has(id)) chosen.delete(id);
  else { chosen.add(id); offered.delete(id); }
  return { chosen, offered };
}

/** A line's picked strokes all taken (`take`) or all left in their line. */
export function setLineTaken(pick, doc, lineId, take) {
  const chosen = new Set(pick.chosen);
  const offered = new Set(pick.offered);
  for (const s of (doc && doc.strokes) || []) {
    if (s.lineId !== lineId || s.textless || !(chosen.has(s.id) || offered.has(s.id))) continue;
    if (take) { chosen.add(s.id); offered.delete(s.id); } else { offered.add(s.id); chosen.delete(s.id); }
  }
  return { chosen, offered };
}

/**
 * The picked strokes that are in lines, grouped per line in line order, for the
 * warnings: `{ lineId, n, text, sketch, ids, taken }` (`taken` = how many of
 * `ids` are chosen).
 */
export function pickGroups(doc, pick, { mode = 'create' } = {}) {
  if (mode === 'remove') return [];
  const { lines, idx } = lineIndex(doc);
  const groups = new Map();
  for (const s of (doc && doc.strokes) || []) {
    const c = pick.chosen.has(s.id);
    if (!c && !pick.offered.has(s.id)) continue;
    const i = lineOf(s, idx);
    if (i === undefined) continue;
    if (!groups.has(s.lineId)) {
      const l = lines[i];
      groups.set(s.lineId, { lineId: s.lineId, n: i + 1, text: String(l.text || ''), sketch: isKindLine(l), ids: [], taken: 0 });
    }
    const g = groups.get(s.lineId);
    g.ids.push(s.id);
    if (c) g.taken++;
  }
  return [...groups.values()].sort((a, b) => a.n - b.n);
}

/** "5 strokes are in line #3 (“Thank You!”)", with how many are taken when it is a mix. */
export function groupWarning(g) {
  const text = g.text.length > 40 ? `${g.text.slice(0, 39)}…` : g.text;
  const what = g.sketch ? `the sketch #${g.n} (“${text}”)` : `line #${g.n} (“${text}”)`;
  const n = g.ids.length;
  const base = `${n} ${plural(n, 'stroke')} ${n === 1 ? 'is' : 'are'} in ${what}`;
  return g.taken > 0 && g.taken < n ? `${base}; ${g.taken} of them taken` : base;
}

/** The chosen ids in page order (the order the sketch's strokes are written). */
export function pickedIds(doc, pick) {
  return ((doc && doc.strokes) || []).filter((s) => pick.chosen.has(s.id)).map((s) => s.id);
}

/**
 * What the page draws over its greyed ink: `taken` (chosen), `offered` (left in
 * their line) and `base` (in 'add' / 'remove' mode, the sketch's other strokes).
 */
export function pickMarks(doc, pick, { mode = 'create', lineId = null } = {}) {
  const taken = [];
  const offered = [];
  const base = [];
  for (const s of (doc && doc.strokes) || []) {
    if (pick.chosen.has(s.id)) taken.push(s);
    else if (pick.offered.has(s.id)) offered.push(s);
    else if (mode !== 'create' && lineId && s.lineId === lineId) base.push(s);
  }
  return { taken, offered, base };
}

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * The pickable stroke nearest a click (Ncode), within `tol` Ncode units, else
 * null. A click on a single-point stroke measures to that point.
 */
export function strokeAt(doc, pt, tol, opts = {}) {
  if (!pt) return null;
  let best = null;
  let bestD = tol;
  for (const s of (doc && doc.strokes) || []) {
    if (!pickable(s, opts)) continue;
    const p = s.points;
    if (p.length === 1) {
      const d = Math.hypot(pt.x - p[0][0], pt.y - p[0][1]);
      if (d <= bestD) { bestD = d; best = s.id; }
      continue;
    }
    for (let i = 1; i < p.length; i++) {
      const d = segDist(pt.x, pt.y, p[i - 1][0], p[i - 1][1], p[i][0], p[i][1]);
      if (d <= bestD) { bestD = d; best = s.id; }
    }
  }
  return best;
}
