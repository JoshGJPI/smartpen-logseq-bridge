/**
 * relink-plan — the transcript and stroke links a Relink writes (v3.21.0,
 * spec B.3). save-page.js `planTranscript(…, { relink })` returns this, and
 * `savePageToFolder({ relink })` applies it in one `savePage()`.
 *
 * What it changes, exactly:
 *   - a linked line's `yBounds` (MyScript's, from the relink run) and, when the
 *     review took a word fix, its `text`; a text line left unlinked (no ink,
 *     Don't link) gets `yBounds: null` (its old ones were never re-measured);
 *   - each SENT stroke's `lineId`: the stored line whose MyScript line covers it
 *     most (`strokesIntersectingLine` with the run's batch origin, the fixed
 *     matching code), else null. Every MyScript line competes for strokes, so
 *     ink left over keeps its own strokes rather than handing them to a
 *     neighbour through the tolerance;
 *   - ink left over the review chose "Not text" for: those strokes' ids in
 *     `textlessIds`; "Add as new line": a new line (MyScript's text, a new id,
 *     a typed task box read as on transcription), placed by y.
 *
 * Never: line ids, text other than a taken fix, order, indent, parentId,
 * checked, marker, kind lines, strokes not sent (textless ones, a kind line's
 * ink), points, the sketch flag. So no task state needs carrying.
 *
 * Pure. Tested in `src/lib/__tests__/relink-plan.test.js` and save-page.test.js.
 */
import { strokesIntersectingLine } from './storage/line-match.js';
import { parseTaskMarker } from './task-markers.js';

function newLineId() {
  return globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

const usable = (yb) => !!yb && Number.isFinite(yb.minY) && Number.isFinite(yb.maxY) && !(yb.minY === 0 && yb.maxY === 0);

const sameLineFields = (a, b) => a.id === b.id && a.text === b.text && (a.indentLevel || 0) === (b.indentLevel || 0)
  && (a.parentId ?? null) === (b.parentId ?? null) && (a.checked ?? null) === (b.checked ?? null)
  && (a.marker ?? null) === (b.marker ?? null);

/**
 * @param {Array} existingLines  transcript.lines on disk
 * @param {Object} relink        lib/relink.js buildRelinkSpec()
 * @param {Array} storedStrokes  strokes in the run's frame (turned upright like the batch), `{ id, lineId, points }`
 * @param {number} originNcodeY  the run's batch origin (min Y of the sent, turned strokes)
 * @param {{ newId?: () => string }} [opts]
 * @returns {{ lines: Array, relink: true, changed: boolean, linesAdded: number,
 *   lineIdAssignments: Map<string, string|null>, lineIdRemap: Map, deletedInkIds: Set, textlessIds: Set<string>,
 *   linked: number }}
 */
export function planRelink(existingLines, relink, storedStrokes = [], originNcodeY = null, { newId = newLineId } = {}) {
  const existing = Array.isArray(existingLines) ? existingLines : [];
  const ms = (relink && relink.myscriptLines) || [];
  const byId = new Map(existing.map((l) => [l.id, l]));
  const kindIds = new Set(existing.filter((l) => l && l.kind).map((l) => l.id));

  // Owner of each MyScript line: a stored line, a new line, Not text, or nothing.
  const owner = ms.map(() => ({ type: 'leave' }));
  const linkOf = new Map(); // lineId → ms index
  for (const { lineId, ms: j } of (relink && relink.links) || []) {
    const l = byId.get(lineId);
    if (!l || l.kind || !ms[j] || !usable(ms[j].yBounds) || linkOf.has(lineId) || owner[j].type !== 'leave') continue;
    owner[j] = { type: 'line', lineId };
    linkOf.set(lineId, j);
  }
  const added = new Map(); // ms index → new line record
  for (const j of (relink && relink.add) || []) {
    if (!ms[j] || owner[j].type !== 'leave') continue;
    const { checked, text } = parseTaskMarker(String(ms[j].text || '').trim());
    if (!text.trim()) continue;
    const rec = { id: newId(), text: text.trim(), indentLevel: 0, parentId: null, checked, yBounds: usable(ms[j].yBounds) ? { minY: ms[j].yBounds.minY, maxY: ms[j].yBounds.maxY } : null };
    owner[j] = { type: 'line', lineId: rec.id };
    added.set(j, rec);
  }
  for (const j of (relink && relink.textless) || []) {
    if (ms[j] && owner[j].type === 'leave') owner[j] = { type: 'textless' };
  }

  // Strokes: only those sent, never one linked to a kind line.
  const sent = new Set((relink && relink.sent) || []);
  const candidates = (storedStrokes || []).filter((s) => s && sent.has(s.id) && !(s.lineId && kindIds.has(s.lineId)));
  const best = new Map(); // stroke id → { overlap, j }
  ms.forEach((line, j) => {
    if (!usable(line.yBounds)) return;
    for (const { id, overlap } of strokesIntersectingLine(line, candidates, originNcodeY)) {
      const held = best.get(id);
      if (!held || overlap > held.overlap) best.set(id, { overlap, j });
    }
  });
  const lineIdAssignments = new Map();
  const textlessIds = new Set();
  for (const s of candidates) {
    const won = best.get(s.id);
    const o = won ? owner[won.j] : null;
    if (o && o.type === 'textless') {
      textlessIds.add(s.id);
      lineIdAssignments.set(s.id, null);
    } else {
      lineIdAssignments.set(s.id, o && o.type === 'line' ? o.lineId : null);
    }
  }

  // Lines: the linked ones take MyScript's yBounds (and a taken fix). A text line
  // left unlinked loses its yBounds: they came from the pre-fix batch, and on a page
  // that now reads as trustworthy they would look like a measured position (the
  // merge's duplicate check compares them). Kind lines stay as they are.
  const texts = (relink && relink.texts) || {};
  let lines = existing.map((l) => {
    if (!linkOf.has(l.id)) return l.kind || l.yBounds == null ? l : { ...l, yBounds: null };
    const yb = ms[linkOf.get(l.id)].yBounds;
    const next = { ...l, yBounds: { minY: yb.minY, maxY: yb.maxY } };
    const t = texts[l.id];
    if (typeof t === 'string' && t.trim() && t !== l.text) next.text = t;
    return next;
  });
  lines = placeNewLines(lines, added, linkOf, ms.length);

  const before = new Set(existing.map((l) => l.id));
  return {
    lines,
    relink: true,
    changed: lines.length !== existing.length || lines.some((l, i) => !sameLineFields(l, existing[i])),
    linesAdded: lines.filter((l) => !before.has(l.id)).length,
    linked: linkOf.size,
    lineIdAssignments,
    // For the canvas copy (stores/textless.js syncCanvasAfterPageWrite `links`).
    links: Object.fromEntries(lineIdAssignments),
    lineIdRemap: new Map(),
    deletedInkIds: new Set(),
    textlessIds
  };
}

/**
 * Insert "Add as new line" lines by y: after the stored line linked to the
 * nearest MyScript line above (as its first child when that line has children,
 * else as its sibling), else before the line linked to the nearest one below,
 * else at the end. No existing line's indent or parent changes.
 */
function placeNewLines(lines, added, linkOf, msCount) {
  if (!added.size) return lines;
  const lineAtMs = new Map([...linkOf].map(([id, j]) => [j, id]));
  const after = new Map(), before = new Map(), atEnd = [];
  for (const [j, rec] of [...added].sort((a, b) => a[0] - b[0])) {
    let anchor = null;
    for (let k = j - 1; k >= 0 && anchor === null; k--) if (lineAtMs.has(k)) anchor = lineAtMs.get(k);
    if (anchor !== null) { push(after, anchor, rec); continue; }
    for (let k = j + 1; k < msCount && anchor === null; k++) if (lineAtMs.has(k)) anchor = lineAtMs.get(k);
    if (anchor !== null) push(before, anchor, rec);
    else atEnd.push(rec);
  }
  const out = [];
  lines.forEach((l, i) => {
    for (const rec of before.get(l.id) || []) out.push({ ...rec, indentLevel: l.indentLevel || 0, parentId: l.parentId ?? null });
    out.push(l);
    const next = lines[i + 1];
    const childOf = next && (next.indentLevel || 0) > (l.indentLevel || 0);
    for (const rec of after.get(l.id) || []) {
      out.push(childOf
        ? { ...rec, indentLevel: (l.indentLevel || 0) + 1, parentId: l.id }
        : { ...rec, indentLevel: l.indentLevel || 0, parentId: l.parentId ?? null });
    }
  });
  return [...out, ...atEnd];
}

function push(map, key, v) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(v);
}
