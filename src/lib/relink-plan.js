/**
 * relink-plan — the transcript and stroke links a Relink writes (v3.21.0,
 * spec B.3). save-page.js `planTranscript(…, { relink })` returns this, and
 * `savePageToFolder({ relink })` applies it in one `savePage()`.
 *
 * What it changes, exactly:
 *   - a linked line's `yBounds` (MyScript's, from the relink run; the union when it
 *     takes several MyScript lines: a line merged by hand, or "Add to #N") and, when the
 *     review took a word fix, its `text`; a text line left unlinked (no ink,
 *     Don't link) gets `yBounds: null` (its old ones were never re-measured);
 *   - each SENT stroke's `lineId`: the stored line whose MyScript line covers it
 *     most (each MyScript line competes on its own; all of a line's MyScript lines
 *     give their strokes to it) (`strokesIntersectingLine` with the run's batch origin, the fixed
 *     matching code), else null. Every MyScript line competes for strokes, so
 *     ink left over keeps its own strokes rather than handing them to a
 *     neighbour through the tolerance;
 *   - ink left over the review chose "Not text" for: those strokes' ids in
 *     `textlessIds`; "Add as new line": a new line (MyScript's text, a new id,
 *     a typed task box read as on transcription), placed by y; "Make sketch"
 *     (v3.24.0): one sketch line for every row marked so (`relink.sketch`), its
 *     ink linked to it, placed by y under the line above (lib/line-kinds.js).
 *
 *   - decorative ink the run held back (`relink.heldBack`, lib/relink.js
 *     holdBackDecorative): unlinked always, and flagged Not text (`textlessIds`)
 *     while `relink.heldBackTextless`. Never left with an old link: the old
 *     links on these pages are wrong, and the page reads as trustworthy after.
 *
 * Strokes not sent and not held back (Relink selection, v3.21.0, the Editor's
 * pass over the selected strokes) depend on the page as it was (`trusted`,
 * isTrustworthyTranscript of the page on disk before this save):
 *   - untrustworthy: unlinked (their links are the pre-fix ones), and a text line
 *     this pass doesn't link gets `yBounds: null` as above;
 *   - trustworthy (a second pass, e.g. a table's other column): they keep their
 *     links, and a line this pass doesn't link keeps its `yBounds` while some of
 *     that kept ink still links to it (otherwise null, as above).
 * The reader's Relink sends every stroke but textless, kind-line and held-back
 * ones, so this changes nothing there.
 *
 * Never: line ids, text other than a taken fix, order, indent, parentId,
 * checked, marker, existing kind lines, a kind line's ink, textless strokes,
 * points, the sketch flag. So no task state needs carrying.
 *
 * Pure. Tested in `src/lib/__tests__/relink-plan.test.js` and save-page.test.js.
 */
import { bestLineOfStrokes, strokesInTranscriptionFrame } from './storage/line-match.js';
import { parseTaskMarker } from './task-markers.js';
import { KIND_SKETCH, SKETCH_DEFAULT_LABEL, insertKindLine } from './line-kinds.js';

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
 * @param {{ newId?: () => string, trusted?: boolean }} [opts]  trusted: the page was trustworthy before this save
 * @returns {{ lines: Array, relink: true, changed: boolean, linesAdded: number,
 *   lineIdAssignments: Map<string, string|null>, lineIdRemap: Map, deletedInkIds: Set, textlessIds: Set<string>,
 *   linked: number }}
 */
export function planRelink(existingLines, relink, storedStrokes = [], originNcodeY = null, { newId = newLineId, trusted = false } = {}) {
  const existing = Array.isArray(existingLines) ? existingLines : [];
  const ms = (relink && relink.myscriptLines) || [];
  const kindIds = new Set(existing.filter((l) => l && l.kind).map((l) => l.id));

  // Owner of each MyScript line: a stored line, a new line, Not text, or nothing.
  const owner = ms.map(() => ({ type: 'leave' }));
  // lineId → the MyScript line indices it takes (a line merged by hand takes several)
  const linkOf = linksOf(existing, relink, ms, owner);
  const added = newLineRecords(ms, relink, owner, newId);
  for (const j of (relink && relink.textless) || []) {
    if (ms[j] && owner[j].type === 'leave') owner[j] = { type: 'textless' };
  }
  // Make sketch (v3.24.0): one sketch line takes every MyScript line marked so.
  const sketchJs = ((relink && relink.sketch) || []).filter((j) => ms[j] && owner[j].type === 'leave');
  const sketchLine = sketchJs.length ? {
    id: newId(), kind: KIND_SKETCH, text: SKETCH_DEFAULT_LABEL, indentLevel: 0, parentId: null, checked: null, yBounds: null, bounds: null
  } : null;
  for (const j of sketchJs) owner[j] = { type: 'line', lineId: sketchLine.id };

  // Strokes: only those sent, never one linked to a kind line.
  const sent = new Set((relink && relink.sent) || []);
  const candidates = relinkCandidates(storedStrokes, kindIds, sent);
  const best = bestLineOfStrokes(ms, candidates, originNcodeY);
  const lineIdAssignments = new Map();
  const textlessIds = new Set();
  for (const s of candidates) {
    const j = best.get(s.id);
    const o = j != null ? owner[j] : null;
    if (o && o.type === 'textless') {
      textlessIds.add(s.id);
      lineIdAssignments.set(s.id, null);
    } else {
      lineIdAssignments.set(s.id, o && o.type === 'line' ? o.lineId : null);
    }
  }
  // Ink not sent: held back (never keeps a link), or outside a selection pass.
  const held = new Set((relink && relink.heldBack) || []);
  const flagHeld = !!(relink && relink.heldBackTextless);
  const keptOwners = new Set(); // lines that keep ink from an earlier pass (trusted pages only)
  for (const s of storedStrokes || []) {
    if (!s || sent.has(s.id) || (s.lineId && kindIds.has(s.lineId))) continue;
    if (held.has(s.id)) {
      lineIdAssignments.set(s.id, null);
      if (flagHeld) textlessIds.add(s.id);
    } else if (!trusted) {
      if (s.lineId) lineIdAssignments.set(s.id, null);
    } else if (s.lineId) keptOwners.add(s.lineId);
  }

  // Lines: the linked ones take MyScript's yBounds (and a taken fix). A text line
  // left unlinked loses its yBounds: they came from the pre-fix batch, and on a page
  // that now reads as trustworthy they would look like a measured position (the
  // merge's duplicate check compares them). Kind lines stay as they are, and so
  // does a line keeping ink from an earlier pass on a trustworthy page.
  const texts = (relink && relink.texts) || {};
  let lines = existing.map((l) => {
    if (!linkOf.has(l.id)) return l.kind || l.yBounds == null || keptOwners.has(l.id) ? l : { ...l, yBounds: null };
    // The union of its MyScript lines' bounds.
    const bs = linkOf.get(l.id).map((j) => ms[j].yBounds);
    const next = { ...l, yBounds: { minY: Math.min(...bs.map((b) => b.minY)), maxY: Math.max(...bs.map((b) => b.maxY)) } };
    const t = texts[l.id];
    if (typeof t === 'string' && t.trim() && t !== l.text) next.text = t;
    return next;
  });
  lines = placeNewLines(lines, added, linkOf, ms.length);
  if (sketchLine) {
    const inkIds = new Set([...lineIdAssignments].filter(([, id]) => id === sketchLine.id).map(([s]) => s));
    if (inkIds.size) {
      const lineIdOf = (s) => (lineIdAssignments.has(s.id) ? lineIdAssignments.get(s.id) : s.lineId || null);
      lines = insertKindLine(lines, sketchLine, storedStrokes, { inkIds, trusted: true, lineIdOf }).lines;
    }
  }

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
 * The review's new lines (`relink.add`): each entry a MyScript line index (the
 * reading as is), or (v3.30.0) `{ ms: [j…], text?, indent? }`: one line taking
 * several MyScript lines (merged in the review), the text the review typed (else the
 * readings joined) and an indent. A typed task box is read as on transcription.
 * Marks `owner`. @returns {Map<number, Object>} first MyScript index → the line record
 */
function newLineRecords(ms, relink, owner, newId) {
  const added = new Map();
  for (const entry of (relink && relink.add) || []) {
    const js = (typeof entry === 'number' ? [entry] : (entry && entry.ms) || []).filter((j) => ms[j] && owner[j].type === 'leave');
    if (!js.length) continue;
    const typed = entry && typeof entry.text === 'string' && entry.text.trim() ? entry.text : null;
    const { checked, text } = parseTaskMarker(String(typed ?? js.map((j) => String(ms[j].text || '').trim()).join(' ')).trim());
    if (!text.trim()) continue;
    const bs = js.map((j) => ms[j].yBounds).filter(usable);
    const rec = {
      id: newId(), text: text.trim(), indentLevel: 0, parentId: null, checked,
      yBounds: bs.length ? { minY: Math.min(...bs.map((b) => b.minY)), maxY: Math.max(...bs.map((b) => b.maxY)) } : null
    };
    const indent = entry && Number.isInteger(entry.indent) && entry.indent >= 0 ? entry.indent : null;
    for (const j of js) owner[j] = { type: 'line', lineId: rec.id };
    added.set(js[0], { rec, indent });
  }
  return added;
}

/**
 * Where the new lines would go and at what indent, for the review (v3.30.0): the
 * same placement the save makes, from the spec alone (no strokes needed).
 * @returns {Map<number, { indentLevel: number, max: number }>} first MyScript index → its indent, and the
 *   deepest it may go (one deeper than the line before it)
 */
export function newLinePreview(existingLines, relink) {
  const existing = Array.isArray(existingLines) ? existingLines : [];
  const ms = (relink && relink.myscriptLines) || [];
  const owner = ms.map(() => ({ type: 'leave' }));
  const linkOf = linksOf(existing, relink, ms, owner);
  const added = newLineRecords(ms, relink, owner, () => '~preview-new');
  const ids = new Map();
  let k = 0;
  for (const [j, a] of added) { a.rec = { ...a.rec, id: `~preview-new${k++}` }; ids.set(a.rec.id, j); }
  const lines = placeNewLines(existing, added, linkOf, ms.length);
  const out = new Map();
  lines.forEach((l, i) => {
    if (!ids.has(l.id)) return;
    out.set(ids.get(l.id), { indentLevel: l.indentLevel || 0, max: i > 0 ? (lines[i - 1].indentLevel || 0) + 1 : 0 });
  });
  return out;
}

/** The stored lines the spec links, each to its usable MyScript lines; marks `owner`. */
function linksOf(existing, relink, ms, owner) {
  const byId = new Map(existing.map((l) => [l.id, l]));
  const linkOf = new Map();
  for (const { lineId, ms: raw } of (relink && relink.links) || []) {
    const l = byId.get(lineId);
    if (!l || l.kind || linkOf.has(lineId)) continue;
    const js = (Array.isArray(raw) ? raw : [raw]).filter((j) => ms[j] && usable(ms[j].yBounds) && owner[j].type === 'leave');
    if (!js.length) continue;
    for (const j of js) owner[j] = { type: 'line', lineId };
    linkOf.set(lineId, js);
  }
  return linkOf;
}

/**
 * Insert "Add as new line" lines by y: after the stored line linked to the
 * nearest MyScript line above (as its first child when that line has children,
 * else as its sibling), else before the line linked to the nearest one below,
 * else at the end. No existing line's indent or parent changes.
 */
function placeNewLines(lines, added, linkOf, msCount) {
  if (!added.size) return lines;
  const lineAtMs = new Map([...linkOf].flatMap(([id, js]) => js.map((j) => [j, id])));
  const after = new Map(), before = new Map(), atEnd = [];
  for (const [j, rec] of [...added].sort((a, b) => a[0] - b[0]).map(([k, a]) => [k, { ...a.rec, _indent: a.indent }])) {
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
  return withTypedIndents([...out, ...atEnd]);
}

/**
 * A new line's indent set in the review (v3.30.0): taken, at most one deeper than
 * the line before it, its parent the nearest line above with a smaller indent.
 * Only new lines change; `_indent` never reaches disk.
 */
function withTypedIndents(lines) {
  const out = [];
  for (const l of lines) {
    if (!l || !('_indent' in l)) { out.push(l); continue; }
    const { _indent, ...rec } = l;
    if (_indent == null) { out.push(rec); continue; }
    const prev = out[out.length - 1];
    const indentLevel = Math.max(0, Math.min(_indent, prev ? (prev.indentLevel || 0) + 1 : 0));
    let parentId = null;
    for (let k = out.length - 1; k >= 0; k--) if ((out[k].indentLevel || 0) < indentLevel) { parentId = out[k].id; break; }
    out.push({ ...rec, indentLevel, parentId });
  }
  return out;
}

/** The strokes a relink matches: sent, never textless, never linked to a kind line (plan and preview alike). */
function relinkCandidates(strokes, kindIds, sent) {
  return (strokes || []).filter((s) => s && s.textless !== true && sent.has(s.id) && !(s.lineId && kindIds.has(s.lineId)));
}

function push(map, key, v) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(v);
}

/**
 * The review's ink preview (v3.27.0): which stored strokes each MyScript line of
 * a run takes, by the very rule the save uses (`planRelink`: sent strokes in the
 * run's frame, never textless or linked to a kind line, each to its best line).
 *
 * @param {{ strokes?: Array, transcript?: { lines?: Array } }} doc  the PageDoc
 * @param {{ lines: Array, sent?: string[], heldBack?: string[], rotation?: number, originNcodeY?: number }} run
 * @returns {{ byMs: string[][], heldBack: string[], unread: string[] }}  byMs[j]: stroke ids of MyScript line j;
 *   unread: sent strokes no line touches (the save leaves them unlinked)
 */
export function relinkInk(doc, run) {
  const ms = (run && run.lines) || [];
  const kindIds = new Set(((doc && doc.transcript && doc.transcript.lines) || []).filter((l) => l && l.kind).map((l) => l.id));
  const candidates = relinkCandidates(doc && doc.strokes, kindIds, new Set((run && run.sent) || []));
  // As the save does: textless ink is never matched, and the rest is turned into the run's frame.
  const best = bestLineOfStrokes(ms, strokesInTranscriptionFrame(candidates, run && run.rotation), run && run.originNcodeY);
  const byMs = ms.map(() => []);
  const unread = [];
  for (const s of candidates) {
    const j = best.get(s.id);
    if (j != null) byMs[j].push(s.id);
    else unread.push(s.id);
  }
  return { byMs, heldBack: [...((run && run.heldBack) || [])], unread };
}
