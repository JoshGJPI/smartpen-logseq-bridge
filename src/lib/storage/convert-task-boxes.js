/**
 * convert-task-boxes — the one-off conversion of pages transcribed before task
 * boxes were parsed (v3.3.0). Pure: the dialog (`ConvertTaskBoxesDialog`) reads
 * and writes the pages; this decides what changes.
 *
 * Until v3.3.0 `mergeTranscript()` kept MyScript's `☐` / `☑` in the line's text
 * with `checked: null`, and a few lines were typed as `TODO …` / `DONE …`. The
 * conversion moves that marker into `checked` (via `parseTaskMarker()`, the
 * same reading a new transcription gets) and strips it from the text. Nothing
 * else about a line or a page changes: no line is added, removed or reordered,
 * ids, indentation, parents and yBounds stay, strokes are not touched.
 *
 * A line whose `checked` is ALREADY set (the v1 migration, a Library edit, a
 * later tick) keeps it:
 *   - marker agrees with the state (`☐` on a TODO): the glyph is stripped, the
 *     state is untouched;
 *   - marker disagrees (`☐` on a DONE): the line is left exactly as it is and
 *     reported as a conflict. The state was set deliberately and after the ink
 *     was read, so it wins over the glyph; but stripping the glyph would hide
 *     that the two disagreed, so the text keeps it for the user to resolve.
 *
 * `transcript.lastTranscribed` is NOT bumped (the text was not re-recognised),
 * only `metadata.lastUpdated`. `isTrustworthyTranscript()` reads
 * lastTranscribed, line ids and yBounds and the strokes' lineIds and points,
 * none of which change, so the conversion cannot change its answer.
 *
 * Tested in `src/lib/__tests__/convert-task-boxes.test.js`.
 */

import { parseTaskMarker } from '$lib/task-markers.js';

/**
 * Cheap pre-filter on a scan record's `transcriptionText` (lines joined by
 * newlines, indented with spaces), so only pages that can have a marker are
 * read from disk.
 * @param {string|null|undefined} transcriptionText
 * @returns {boolean}
 */
export function mightHaveTaskBoxes(transcriptionText) {
  if (!transcriptionText) return false;
  return transcriptionText.split('\n').some((t) => parseTaskMarker(t).checked !== null);
}

/**
 * @typedef {Object} LineChange
 * @property {string} lineId
 * @property {string} oldText
 * @property {string} newText
 * @property {boolean} checked   the state the line ends with
 * @property {boolean} wasSet    the line already had this state (only the glyph goes)
 *
 * @typedef {Object} LineConflict
 * @property {string} lineId
 * @property {string} text
 * @property {boolean} checked   the line's existing state, kept
 * @property {boolean} marker    what the text's marker says
 */

/**
 * What converting one page would change.
 * @param {{transcript?: {lines?: Array}}|null} doc
 * @returns {{ changes: LineChange[], conflicts: LineConflict[] }}
 */
export function planPageConversion(doc) {
  const changes = [];
  const conflicts = [];
  const lines = (doc && doc.transcript && doc.transcript.lines) || [];
  for (const line of lines) {
    if (!line || !line.id) continue;
    const oldText = typeof line.text === 'string' ? line.text : '';
    const { checked: marker, text } = parseTaskMarker(oldText);
    if (marker === null) continue;
    const existing = line.checked === true || line.checked === false ? line.checked : null;
    if (existing !== null && existing !== marker) {
      conflicts.push({ lineId: line.id, text: oldText, checked: existing, marker });
      continue;
    }
    changes.push({ lineId: line.id, oldText, newText: text, checked: marker, wasSet: existing !== null });
  }
  return { changes, conflicts };
}

/**
 * The page with `changes` applied. A change applies only while the line still
 * holds the text it was planned from, so a page edited between the preview and
 * the confirm is never half-converted from stale text: those lines are skipped
 * and counted.
 *
 * @param {Object} doc   the PageDoc as on disk now
 * @param {LineChange[]} changes
 * @param {string} [now] ISO time for metadata.lastUpdated
 * @returns {{ doc: Object, applied: number, skipped: number }}
 *   `doc` is the input object itself when nothing applied.
 */
export function applyPageConversion(doc, changes, now = new Date().toISOString()) {
  const byId = new Map((changes || []).map((c) => [c.lineId, c]));
  const lines = (doc && doc.transcript && doc.transcript.lines) || [];
  let applied = 0;
  const next = lines.map((line) => {
    const c = line && byId.get(line.id);
    if (!c || line.text !== c.oldText) return line;
    applied++;
    return { ...line, text: c.newText, checked: c.checked };
  });
  const skipped = byId.size - applied;
  if (!applied) return { doc, applied, skipped };
  return {
    doc: {
      ...doc,
      transcript: { ...doc.transcript, lines: next },
      metadata: { ...(doc.metadata || {}), lastUpdated: now },
    },
    applied,
    skipped,
  };
}

/**
 * Preview rows and totals across pages.
 * @param {Array<{ book: string, pageId: string, changes: LineChange[], conflicts: LineConflict[] }>} pagePlans
 * @returns {{ lines: number, pages: number, todo: number, done: number, conflicts: number,
 *             rows: Array<{ book: string, pageId: string } & LineChange> }}
 */
export function summarizeConversion(pagePlans) {
  const rows = [];
  let pages = 0, conflicts = 0;
  for (const p of pagePlans || []) {
    conflicts += p.conflicts.length;
    if (!p.changes.length) continue;
    pages++;
    for (const c of p.changes) rows.push({ book: p.book, pageId: p.pageId, ...c });
  }
  const todo = rows.filter((r) => r.checked === false).length;
  return { lines: rows.length, pages, todo, done: rows.length - todo, conflicts, rows };
}
