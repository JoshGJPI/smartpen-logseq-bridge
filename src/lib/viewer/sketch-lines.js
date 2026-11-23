/**
 * sketch-lines — the one write path for sketch lines (v3.24.0,
 * docs/TRANSCRIPT-STRUCTURE-SPEC.md E.3). Format and placement: lib/line-kinds.js.
 *
 * `saveSketchLine(book, pageId, op)` is immediate, like a task tick:
 *   1. refused under the same guards as Relink (stores/page-guards.js
 *      pageGuardState: a Library draft, any transcript editor open on the page,
 *      a pending Editor transcription, a re-transcribe reset) and while a
 *      letter-suffixed page's number is on the canvas (the canvas can't tell
 *      P151b from P151, so its copies couldn't take the links);
 *   2. reads the page, changes the one line and the given strokes' `lineId`
 *      (stroke ids are disk ids, strokeDiskId()), recomputes the line's
 *      `bounds`, and bumps `metadata.lastUpdated` — never
 *      `transcript.lastTranscribed` (a sketch is no MyScript match, and
 *      isTrustworthyTranscript() reads that date);
 *   3. writes through local-store savePage() (atomic in main);
 *   4. brings a page also loaded in the Editor in step
 *      (syncCanvasAfterPageWrite with `links`, so Transcribe skips the sketch's
 *      ink and nothing reads as unsaved), then refreshAfterSave() (scan record,
 *      page cache, thumbnails, the open reader page).
 *
 * Ops (docWithSketch, pure):
 *   create          { strokeIds, label, pressure }  a new line under the nearest
 *                   text line above the ink (placeKindLine); `pressure` sets the
 *                   strokes' `sketch: true` (Pressure ink, decision 6)
 *   rename          { lineId, label }               empty = "Sketch"
 *   add-strokes     { lineId, strokeIds, pressure }
 *   remove-strokes  { lineId, strokeIds }           unlinked, never deleted
 *   remove          { lineId, ink }                 the line goes; lines under it move up
 *                   a level; its strokes are never deleted: with `ink: 'textless'`
 *                   (the default, as for a deleted line) flagged Not text, with
 *                   'retry' only unlinked, so the next Transcribe sends them
 *
 * No stroke is ever deleted, and no point changes. A stroke taken into a sketch
 * loses a "Not text" flag (a textless stroke is in no line); being linked, it is
 * never sent to MyScript anyway.
 *
 * Tested in src/lib/__tests__/sketch-lines.test.js.
 */

import { get } from 'svelte/store';
import { getPage, savePage } from '$lib/storage/local-store.js';
import { refreshAfterSave } from '$lib/storage/refresh.js';
import { pageGuardState, suffixOnCanvas } from '$stores/page-guards.js';
import { syncCanvasAfterPageWrite } from '$stores/textless.js';
import { pageOrientations } from '$stores/orientation.js';
import { rotationFor, normalizeRotation, rotateStoredPoints } from '$lib/page-orientation.js';
import { isTrustworthyTranscript } from './ink-text.js';
import {
  KIND_SKETCH, isKindLine, isSketchLine, sketchLabel, strokeBox, insertKindLine, withKindBounds
} from '$lib/line-kinds.js';
import { plural } from '$lib/plural.js';
import { INK_TEXTLESS, normalizeDeletedInk } from '$lib/deleted-ink.js';

export const SKETCH_OPS = ['create', 'rename', 'add-strokes', 'remove-strokes', 'remove'];

/** An expected refusal (nothing written). */
export class SketchError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SketchError';
    this.code = code;
  }
}

function newLineId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/* ============================================================
 *  Guards
 * ============================================================ */

/**
 * Why a sketch write is refused on this page now, or null. Pure: `s` is
 * pageGuardState() plus `suffixOnCanvas`.
 */
export function sketchRefusal(s, doc) {
  if (s.draft) return `${s.label} has unsaved transcript edits in the Library; save or cancel them first`;
  if (s.editorOpen) return `${s.label} is open in a transcript editor; close it first`;
  if (s.reset) return `${s.label} is reset for re-transcription in the Editor; transcribe and save it (or undo the reset) first`;
  if (s.pendingTranscription) return `${s.label} has an unsaved transcription in the Editor; save or discard it first`;
  if (s.suffixOnCanvas) {
    return `${s.label} is a letter-suffixed page and its page number is loaded in the Editor, which can't tell the two apart; unload it from the Editor first`;
  }
  if (doc === null) return `${s.label} was not found`;
  return null;
}

/* ============================================================
 *  The change (pure)
 * ============================================================ */

const levelOf = (l) => Math.max(0, l.indentLevel || 0);

/** parentId from indents (the nearest earlier line with a smaller indent). */
function reparent(lines) {
  const stack = [];
  return lines.map((l) => {
    const lvl = levelOf(l);
    while (stack.length && stack[stack.length - 1].lvl >= lvl) stack.pop();
    const parentId = stack.length ? stack[stack.length - 1].id : null;
    stack.push({ lvl, id: l.id });
    return (l.parentId ?? null) === parentId ? l : { ...l, parentId };
  });
}

function sketchAt(lines, lineId) {
  const i = lines.findIndex((l) => l && l.id === lineId);
  if (i < 0) throw new SketchError('no-line', 'That sketch is no longer in the page’s transcript.');
  if (!isSketchLine(lines[i])) throw new SketchError('not-sketch', 'That line is not a sketch.');
  return i;
}

/**
 * The PageDoc after one sketch op.
 *
 * @param {object} doc  the PageDoc on disk
 * @param {{ op: string, lineId?: string, strokeIds?: string[], label?: string, pressure?: boolean }} op
 * @param {{ now?: string, newId?: () => string, rotation?: number }} [opts]  `rotation`: the page's
 *   display rotation, so "above" means above as the page is read
 * @returns {{ doc: object, lineId: string, line: object|null, changed: boolean,
 *   links: Object<string, string|null>, sketchIds: string[], textlessCleared: string[], textlessIds: string[],
 *   taken: number, under: number }}  `textlessIds`: the strokes Remove sketch flagged Not text
 *   `links`: each stroke whose link changed → its line now (null = unlinked)
 */
export function docWithSketch(doc, op, { now = new Date().toISOString(), newId = newLineId, rotation = 0 } = {}) {
  if (!doc) throw new SketchError('no-page', 'The page is no longer in the data folder.');
  if (!op || !SKETCH_OPS.includes(op.op)) throw new SketchError('bad-op', `Unknown sketch op: ${op && op.op}`);
  const lines0 = (doc.transcript && Array.isArray(doc.transcript.lines)) ? doc.transcript.lines : [];
  const strokes0 = Array.isArray(doc.strokes) ? doc.strokes : [];
  const want = new Set((op.strokeIds || []).map(String));
  let lines = lines0.slice();
  let lineId = op.lineId || null;
  let under = -1;

  // Which strokes take which link.
  const links = {};
  const sketchIds = [];
  const textlessCleared = [];
  const textlessIds = [];
  let taken = 0;
  const flagRemoved = op.op === 'remove' && normalizeDeletedInk(op.ink) === INK_TEXTLESS;

  if (op.op === 'create' || op.op === 'add-strokes') {
    const present = strokes0.filter((s) => s && want.has(s.id));
    if (!present.length) throw new SketchError('no-strokes', 'None of those strokes are saved on this page; save first.');
  }

  if (op.op === 'create') {
    lineId = newId();
    const inkIds = new Set(strokes0.filter((s) => s && want.has(s.id)).map((s) => s.id));
    // Placed by the links as they were (the taken ink no longer counts for its old line).
    const turned = normalizeRotation(rotation)
      ? strokes0.map((s) => (s ? { id: s.id, lineId: s.lineId ?? null, points: rotateStoredPoints(s.points || [], rotation) } : s))
      : strokes0;
    const line = {
      id: lineId, kind: KIND_SKETCH, text: sketchLabel(op.label), indentLevel: 0, parentId: null,
      checked: null, yBounds: null, bounds: strokeBox(strokes0.filter((s) => s && inkIds.has(s.id)))
    };
    const placed = insertKindLine(lines, line, turned, { inkIds, trusted: isTrustworthyTranscript(doc) });
    lines = placed.lines;
    under = placed.under;
  } else if (op.op === 'rename') {
    const i = sketchAt(lines, lineId);
    const text = sketchLabel(op.label);
    if (text !== lines[i].text) lines[i] = { ...lines[i], text };
  } else if (op.op === 'add-strokes' || op.op === 'remove-strokes') {
    sketchAt(lines, lineId);
  } else if (op.op === 'remove') {
    const i = sketchAt(lines, lineId);
    const lvl = levelOf(lines[i]);
    const next = lines.slice();
    for (let j = i + 1; j < next.length && levelOf(next[j]) > lvl; j++) next[j] = { ...next[j], indentLevel: levelOf(next[j]) - 1 };
    next.splice(i, 1);
    lines = reparent(next);
  }

  const take = op.op === 'create' || op.op === 'add-strokes';
  const newStrokes = strokes0.map((s) => {
    if (!s) return s;
    if (take && want.has(s.id)) {
      let n = s;
      if ((s.lineId || null) !== lineId) { n = { ...n, lineId }; links[s.id] = lineId; taken++; }
      if (s.textless) {
        const { textless, ...rest } = n;
        n = rest;
        textlessCleared.push(s.id);
        if (!(s.id in links)) links[s.id] = lineId;
      }
      if (op.pressure && !s.sketch) { n = { ...n, sketch: true }; sketchIds.push(s.id); }
      return n;
    }
    const drop = (op.op === 'remove-strokes' && want.has(s.id) && s.lineId === lineId) || (op.op === 'remove' && s.lineId === lineId);
    if (drop) {
      links[s.id] = null;
      taken++;
      // Remove sketch: the drawing is left out as Not text unless asked to send it again.
      if (flagRemoved) { textlessIds.push(s.id); return { ...s, lineId: null, textless: true }; }
      return { ...s, lineId: null };
    }
    return s;
  });

  lines = withKindBounds(lines, newStrokes);
  const line = lines.find((l) => l && l.id === lineId) || null;
  const changed = taken > 0 || textlessIds.length > 0 || sketchIds.length > 0 || textlessCleared.length > 0 || lines.length !== lines0.length
    || lines.some((l, i) => l !== lines0[i]);
  return {
    lineId,
    line,
    changed,
    links,
    sketchIds,
    textlessCleared,
    textlessIds,
    taken,
    under,
    doc: changed ? {
      ...doc,
      transcript: { ...(doc.transcript || { lastTranscribed: null }), lines },
      strokes: newStrokes,
      metadata: { ...(doc.metadata || {}), lastUpdated: now }
    } : doc
  };
}

/* ============================================================
 *  Choosing ink (pure)
 * ============================================================ */

/**
 * The Editor's selection as Make sketch targets, one per pen page (E.3:
 * "strokes from several pages make one sketch per page"). Every selected stroke
 * must already be saved as it is: not on disk, retimed, moved to another volume
 * or point-edited without a save → `unsaved` and nothing is made. Strokes marked
 * for deletion (positions in `deletedIndices`) are left out (`marked`).
 *
 * @param {Array} all  the strokes store
 * @param {Iterable<number>} indices  selected positions
 * @param {Map<string, Map<string, object>>} onDisk  onDiskStrokeIds (`B{book}/P{page}` → id → state)
 * @param {Set<number>} [deleted]  deletedIndices: positions marked for deletion
 * @returns {{ ok: boolean, error?: string, unsaved: number, marked: number, pages: Array<{ book: string, pageId: string, ids: string[] }> }}
 */
export function sketchTargets(all, indices, onDisk = new Map(), deleted = new Set()) {
  const positions = [...(indices || [])];
  const marked = positions.filter((i) => deleted && deleted.has(i)).length;
  const picked = positions.filter((i) => !(deleted && deleted.has(i))).map((i) => all && all[i]).filter((s) => s && !s.deleted);
  const onPage = picked.filter((s) => s.pageInfo && s.pageInfo.book != null && s.pageInfo.page != null);
  if (!onPage.length) {
    const error = marked ? 'The selected strokes are marked for deletion; a sketch takes none of them' : 'Select the strokes of the sketch first';
    return { ok: false, error, unsaved: 0, marked, pages: [] };
  }
  const byPage = new Map();
  let unsaved = picked.length - onPage.length;
  for (const s of onPage) {
    const key = `B${s.pageInfo.book}/P${s.pageInfo.page}`;
    const id = `s${s.startTime}`;
    const disk = onDisk && onDisk.get ? onDisk.get(key) : null;
    if (s.retimedFrom || s.movedFrom || s.pointsEdited || !disk || !disk.has(id)) { unsaved++; continue; }
    if (!byPage.has(key)) byPage.set(key, { book: String(s.pageInfo.book), pageId: String(s.pageInfo.page), ids: [] });
    byPage.get(key).ids.push(id);
  }
  if (unsaved) {
    return { ok: false, unsaved, marked, pages: [], error: `${unsaved} of the selected ${plural(picked.length, 'stroke')} ${unsaved === 1 ? 'isn’t' : 'aren’t'} saved yet: Save first` };
  }
  return { ok: true, unsaved: 0, marked, pages: [...byPage.values()] };
}

/** Is every point of a stored stroke inside the box (Ncode)? */
function wholly(s, box) {
  const pts = (s && s.points) || [];
  if (!pts.length) return false;
  return pts.every((p) => p[0] >= box.minX && p[0] <= box.maxX && p[1] >= box.minY && p[1] <= box.maxY);
}

/**
 * What a box drawn in the Library reader picks (E.3, "Mark sketch then drag a
 * box"): strokes wholly inside it. Those in no line (or left out as Not text,
 * or linked to a line that is gone) are taken; those in a text line, or in
 * another sketch, are offered per line with a warning ("14 strokes are in line
 * #16 …"). With `lineId` (Add strokes… to that sketch) its own strokes are left
 * out; with `remove` (Remove strokes…) only its own strokes are picked.
 *
 * @param {object} doc
 * @param {{minX: number, maxX: number, minY: number, maxY: number}} box  Ncode
 * @param {{ lineId?: string|null, remove?: boolean }} [opts]
 * @returns {{ take: string[], inLines: Array<{ lineId: string, n: number, text: string, sketch: boolean, ids: string[] }> }}
 */
export function boxPick(doc, box, { lineId = null, remove = false } = {}) {
  if (!box) return { take: [], inLines: [] };
  const inside = ((doc && doc.strokes) || []).filter((s) => wholly(s, box));
  if (remove) return { take: inside.filter((s) => lineId && s.lineId === lineId).map((s) => s.id), inLines: [] };
  return pickByLine(doc, inside.filter((s) => !(lineId && s.lineId === lineId)));
}

/**
 * The Editor's Make sketch, one page (v3.24.0): the selected strokes (`ids`, on
 * disk) split like the reader's box. Those in no line are taken; those in a text
 * line or another sketch are offered per line with the same warning, left in
 * their line unless the dialog takes them.
 * @returns {{ take: string[], inLines: Array<{ lineId: string, n: number, text: string, sketch: boolean, ids: string[] }> }}
 */
export function selectionPick(doc, ids) {
  const want = new Set(ids || []);
  return pickByLine(doc, ((doc && doc.strokes) || []).filter((s) => s && want.has(s.id)));
}

/** Strokes in no live line (or Not text) taken; the rest grouped by their line, in line order. */
function pickByLine(doc, strokes) {
  const lines = (doc && doc.transcript && doc.transcript.lines) || [];
  const idx = new Map(lines.map((l, i) => [l.id, i]));
  const take = [];
  const groups = new Map();
  for (const s of strokes) {
    const i = s.lineId && !s.textless ? idx.get(s.lineId) : undefined;
    if (i === undefined) { take.push(s.id); continue; }
    if (!groups.has(s.lineId)) {
      const l = lines[i];
      groups.set(s.lineId, { lineId: s.lineId, n: i + 1, text: String(l.text || ''), sketch: isKindLine(l), ids: [] });
    }
    groups.get(s.lineId).ids.push(s.id);
  }
  return { take, inLines: [...groups.values()].sort((a, b) => a.n - b.n) };
}

/** "14 strokes are in line #16 (“26'-9" x 27'-0" …”)" for the box's warning. */
export function inLineWarning(g) {
  const text = g.text.length > 40 ? `${g.text.slice(0, 39)}…` : g.text;
  const what = g.sketch ? `the sketch #${g.n} (“${text}”)` : `line #${g.n} (“${text}”)`;
  return `${g.ids.length} ${plural(g.ids.length, 'stroke')} ${g.ids.length === 1 ? 'is' : 'are'} in ${what}`;
}

/**
 * Where a new sketch would go, for the Make sketch dialog's line ("Goes under
 * #16 …"): the anchor line, or null for the start / the end.
 * @returns {{ n: number, text: string, indentLevel: number } | null}
 */
export function previewPlacement(doc, strokeIds, rotation = 0) {
  const out = docWithSketch(doc, { op: 'create', strokeIds, label: '' }, { newId: () => '\u0000preview', rotation });
  if (out.under < 0) return null;
  const l = doc.transcript.lines[out.under];
  return { n: out.under + 1, text: String(l.text || ''), indentLevel: (l.indentLevel || 0) + 1 };
}

/* ============================================================
 *  The write
 * ============================================================ */

/** The guard flags for a sketch write: Relink's (page-guards.js) plus the suffixed-page rule. */
function guardState(book, pageId) {
  return { ...pageGuardState(book, pageId), suffixOnCanvas: suffixOnCanvas(book, pageId) };
}

/**
 * Make, change or remove one page's sketch line, on disk at once (see the header).
 * @param {string} book  book key
 * @param {string} pageId  incl. any suffix
 * @param {object} op  see docWithSketch
 * @returns {Promise<{ changed: boolean, lineId: string, line: object|null, taken: number }>}
 * @throws {SketchError} a refusal (nothing written), or the write's own error
 */
export async function saveSketchLine(book, pageId, op) {
  const b = String(book);
  const p = String(pageId);
  const before = sketchRefusal(guardState(b, p), undefined);
  if (before) throw new SketchError('refused', before);
  const doc = await getPage(b, p);
  const why = sketchRefusal(guardState(b, p), doc || null);
  if (why) throw new SketchError(doc ? 'refused' : 'no-page', why);

  const out = docWithSketch(doc, op, { rotation: rotationFor(get(pageOrientations), b, p) });
  if (!out.changed) return { changed: false, lineId: out.lineId, line: out.line, taken: 0 };

  // Again: a draft or an editor could have opened while the page was read.
  const late = sketchRefusal(guardState(b, p), out.doc);
  if (late) throw new SketchError('refused', late);
  await savePage(b, p, out.doc);

  // The Editor's copy of this page: links (Transcribe skips the sketch's ink),
  // flags, and the on-disk index, so none of it reads as an unsaved change.
  syncCanvasAfterPageWrite(b, p, {
    strokes: out.doc.strokes, links: out.links, sketchIds: out.sketchIds, textlessCleared: out.textlessCleared,
    textlessIds: out.textlessIds
  });
  await refreshAfterSave([{ book: b, pageId: p }]);
  return { changed: true, lineId: out.lineId, line: out.line, taken: out.taken };
}
