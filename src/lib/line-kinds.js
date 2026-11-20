/**
 * line-kinds — transcript lines that are not text (v3.24.0,
 * docs/TRANSCRIPT-STRUCTURE-SPEC.md Phase E). Pure: no stores, no IO.
 *
 * A line with a `kind` is a placeholder for something on the page that is not
 * handwriting to read. Today the only kind is `"sketch"` (E.2):
 *
 *   { id, kind: "sketch", text: "stair section", indentLevel, parentId,
 *     checked: null, yBounds: null, bounds: { minX, maxX, minY, maxY } }
 *
 * - `text` is the label ("Sketch" when none is given), so an older build shows
 *   the line as plain text with that label.
 * - `bounds` is the Ncode box of its strokes, recomputed whenever they change
 *   (withKindBounds); `yBounds` stays null: a kind line never takes part in
 *   MyScript matching.
 * - Never a task: `checked` is always null, no `marker`.
 * - Its strokes link to it by `lineId`, like text, so Transcribe never sends them.
 *
 * Any other `kind` (E.7) is read the same way: shown, kept, never matched to
 * MyScript, never edited as text. kindFields() carries `kind` and `bounds`
 * through every path that copies a line.
 *
 * The scan's text and summary (buildSketchSummary, lineScanText) are MIRRORED in
 * electron/task-summary.cjs; change both (task-summary.test.js runs both).
 *
 * Tested in src/lib/__tests__/line-kinds.test.js.
 */

export const KIND_SKETCH = 'sketch';
/** A sketch's label when none is given (decision 6). */
export const SKETCH_DEFAULT_LABEL = 'Sketch';
/** At most this many sketches per page in the scan record (E.5: scalar-small). */
export const SKETCH_SUMMARY_MAX = 20;
/** A sketch label in the scan summary is clipped to this. */
export const SKETCH_LABEL_MAX = 80;

/** A line that is not plain text (any `kind`, E.7). */
export const isKindLine = (l) => !!(l && typeof l === 'object' && typeof l.kind === 'string' && l.kind);
/** A sketch line. */
export const isSketchLine = (l) => isKindLine(l) && l.kind === KIND_SKETCH;

/** A label as stored: one line, trimmed, "Sketch" when empty. */
export function sketchLabel(raw) {
  const t = typeof raw === 'string' ? raw.replace(/\s*[\r\n]+\s*/g, ' ').trim() : '';
  return t || SKETCH_DEFAULT_LABEL;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function validBounds(b) {
  return !!b && typeof b === 'object' && ['minX', 'maxX', 'minY', 'maxY'].every((k) => Number.isFinite(b[k]));
}

/**
 * `{ kind, bounds }` of a line to carry onto a copy of it (spread it in), or `{}`
 * for a text line. Use it wherever a line is rebuilt from known fields
 * (cloneLines, the save's normaliseLine, the dialog's lines), as markerField()
 * is used for task markers.
 */
export function kindFields(l) {
  if (!isKindLine(l)) return {};
  return { kind: l.kind, ...(l.bounds === null || validBounds(l.bounds) ? { bounds: l.bounds ? { ...l.bounds } : null } : {}) };
}

/**
 * A kind line normalised as stored: never a task, no yBounds, a sketch's empty
 * label falls back to "Sketch". A text line is returned as it is.
 */
export function normalizeKindLine(l) {
  if (!isKindLine(l)) return l;
  const { marker, ...rest } = l;
  return {
    ...rest,
    text: l.kind === KIND_SKETCH ? sketchLabel(l.text) : (typeof l.text === 'string' ? l.text : ''),
    checked: null,
    yBounds: null
  };
}

/** The Ncode box of some stored strokes (`points`), rounded, or null. */
export function strokeBox(strokes) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const s of strokes || []) {
    for (const p of (s && s.points) || []) {
      if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
  }
  if (!(minX <= maxX)) return null;
  return { minX: round2(minX), maxX: round2(maxX), minY: round2(minY), maxY: round2(maxY) };
}

const sameBounds = (a, b) => (!a && !b) || (validBounds(a) && validBounds(b)
  && a.minX === b.minX && a.maxX === b.maxX && a.minY === b.minY && a.maxY === b.maxY);

/**
 * Sketch lines with `bounds` recomputed from the strokes linked to them (E.2);
 * a sketch with no strokes left has `bounds: null`. Other lines (and other
 * kinds) unchanged; returns `lines` itself when nothing changed.
 * @param {Array<object>} lines
 * @param {Array<{lineId?: string|null, points?: Array}>} strokes  stored strokes
 */
export function withKindBounds(lines, strokes) {
  if (!Array.isArray(lines) || !lines.some(isSketchLine)) return lines;
  const by = new Map();
  for (const s of strokes || []) {
    if (!s || !s.lineId) continue;
    if (!by.has(s.lineId)) by.set(s.lineId, []);
    by.get(s.lineId).push(s);
  }
  let changed = false;
  const out = lines.map((l) => {
    if (!isSketchLine(l)) return l;
    const b = strokeBox(by.get(l.id));
    if (sameBounds(b, l.bounds) && 'bounds' in l) return l;
    changed = true;
    return { ...l, bounds: b };
  });
  return changed ? out : lines;
}

/**
 * The ids of the kind lines among `lines`.
 * @returns {Set<string>}
 */
export function kindLineIds(lines) {
  return new Set((lines || []).filter(isKindLine).map((l) => l.id).filter(Boolean));
}

/**
 * `ids` without the ids of kind lines among `lines`: the deleted lines whose
 * ink an ink choice (Not text / transcribe again) is about. A deleted sketch's
 * ink is only unlinked, as Remove sketch does.
 */
export function withoutKindIds(ids, lines) {
  const kinds = kindLineIds(lines);
  return (ids || []).filter((id) => !kinds.has(id));
}

/* ============================================================
 *  Text forms
 * ============================================================ */

/**
 * A line as the scan's `transcriptionText` writes it (E.5): a sketch as
 * `[sketch] label`, another kind as `[kind] text`, a text line as its text.
 * Leading spaces of the text are dropped (the indent says the level).
 * MIRRORED by electron/task-summary.cjs lineScanText().
 */
export function lineScanText(l) {
  const text = String((l && l.text) || '').replace(/^ +/, '');
  if (!isKindLine(l)) return text;
  return `[${l.kind}] ${l.kind === KIND_SKETCH ? sketchLabel(text) : text}`;
}

/** A kind line as markdown / copy writes it: `[sketch: Floor plan]`. */
export function kindMarkdownText(l) {
  return `[${l.kind}: ${l.kind === KIND_SKETCH ? sketchLabel(l.text) : String(l.text || '')}]`;
}

/* ============================================================
 *  Scan summary (E.5)
 * ============================================================ */

/**
 * The scan record's `sketches`: `[{ id, label, lineIndex }]`, the page's sketch
 * lines in order, at most SKETCH_SUMMARY_MAX, labels clipped. `lineIndex` is
 * the line's place in transcript.lines (and so in `transcriptionText`).
 * MIRRORED by electron/task-summary.cjs buildSketchSummary().
 */
export function buildSketchSummary(lines) {
  const out = [];
  if (!Array.isArray(lines)) return out;
  for (let i = 0; i < lines.length && out.length < SKETCH_SUMMARY_MAX; i++) {
    const l = lines[i];
    if (!isSketchLine(l) || typeof l.id !== 'string' || !l.id) continue;
    out.push({ id: l.id, label: clip(sketchLabel(l.text), SKETCH_LABEL_MAX), lineIndex: i });
  }
  return out;
}

function clip(s, max) {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** A record's `sketches` as the renderer keeps them (older mains: none). */
export function normalizeSketchSummary(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((s) => s && typeof s.id === 'string' && s.id && Number.isInteger(s.lineIndex) && s.lineIndex >= 0)
    .slice(0, SKETCH_SUMMARY_MAX)
    .map((s) => ({ id: s.id, label: typeof s.label === 'string' && s.label ? s.label : SKETCH_DEFAULT_LABEL, lineIndex: s.lineIndex }));
}

/* ============================================================
 *  Placement (E.2)
 * ============================================================ */

function topOf(strokes) {
  let min = Infinity;
  for (const s of strokes || []) for (const p of (s && s.points) || []) if (p && Number.isFinite(p[1]) && p[1] < min) min = p[1];
  return min;
}

const levelOf = (l) => Math.max(0, Math.floor(Number(l && l.indentLevel) || 0));

/**
 * Where a new kind line goes (E.2): under the nearest text line above its ink,
 * by that line's linked ink, at that line's indent + 1. After the line come
 * its deeper lines whose ink starts above the sketch, so sketches under one
 * line stay in page order. On a page whose links can't be trusted, or with no
 * ink to go by, the line goes at the end at level 0; with no text line above
 * it, at the start.
 *
 * Strokes are in the frame the page is read in (turned upright for a rotated
 * page by the caller).
 *
 * @param {Array<object>} lines  the transcript (the new line not in it)
 * @param {Array<{id: string, lineId?: string|null, points: Array}>} strokes
 * @param {{ inkIds: Set<string>, trusted: boolean, lineIdOf?: (s: object) => string|null }} opts
 *   `inkIds`: the new line's strokes; `lineIdOf`: a stroke's line (default its lineId)
 * @returns {{ at: number, indentLevel: number, parentId: string|null, under: number }}  `under`: the
 *   anchor line's index, -1 for none
 */
export function placeKindLine(lines, strokes, { inkIds, trusted, lineIdOf = (s) => s.lineId || null }) {
  const list = Array.isArray(lines) ? lines : [];
  const end = { at: list.length, indentLevel: 0, parentId: null, under: -1 };
  const mine = (strokes || []).filter((s) => s && inkIds && inkIds.has(s.id));
  const top = topOf(mine);
  if (!trusted || !Number.isFinite(top)) return end;

  const byLine = new Map();
  for (const s of strokes || []) {
    if (!s || (inkIds && inkIds.has(s.id))) continue;
    const id = lineIdOf(s);
    if (!id) continue;
    if (!byLine.has(id)) byLine.set(id, []);
    byLine.get(id).push(s);
  }
  const lineTop = (l) => topOf(byLine.get(l.id));

  let anchor = -1;
  let best = -Infinity;
  list.forEach((l, i) => {
    if (isKindLine(l)) return;
    const t = topOf(byLine.get(l.id));
    if (Number.isFinite(t) && t <= top && t >= best) { best = t; anchor = i; }
  });
  if (anchor < 0) return { at: 0, indentLevel: 0, parentId: null, under: -1 };

  const lvl = levelOf(list[anchor]);
  let at = anchor + 1;
  while (at < list.length && levelOf(list[at]) > lvl) {
    const t = lineTop(list[at]);
    if (!(Number.isFinite(t) && t < top)) break;
    at++;
  }
  return { at, indentLevel: lvl + 1, parentId: list[anchor].id || null, under: anchor };
}

/**
 * `line` inserted into `lines` where placeKindLine() puts it.
 * @returns {{ lines: Array<object>, at: number, under: number }}
 */
export function insertKindLine(lines, line, strokes, opts) {
  const p = placeKindLine(lines, strokes, opts);
  const next = (lines || []).slice();
  next.splice(p.at, 0, { ...line, indentLevel: p.indentLevel, parentId: p.parentId });
  return { lines: next, at: p.at, under: p.under };
}

/**
 * A re-transcription's transcript with the old transcript's kind lines put back
 * (E.4, Reset + replace): each kind line of `oldLines` missing from `lines` is
 * re-placed by y against the new lines' links, in the old order.
 *
 * @param {Array<object>} oldLines  transcript.lines before
 * @param {Array<object>} lines  the new transcript
 * @param {Array<object>} strokes  stored strokes (in the reading frame)
 * @param {(s: object) => string|null} lineIdOf  a stroke's line after the save
 * @returns {Array<object>}
 */
export function reinsertKindLines(oldLines, lines, strokes, lineIdOf) {
  const have = new Set((lines || []).map((l) => l && l.id));
  let out = lines || [];
  for (const k of (oldLines || []).filter(isKindLine)) {
    if (have.has(k.id)) continue;
    const inkIds = new Set((strokes || []).filter((s) => s && s.lineId === k.id).map((s) => s.id));
    out = insertKindLine(out, k, strokes, { inkIds, trusted: true, lineIdOf }).lines;
    have.add(k.id);
  }
  return out;
}
