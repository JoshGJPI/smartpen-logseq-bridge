/**
 * Save Page — convert in-memory pen state to a v2 PageDoc and write it.
 *
 * Phase 4: this is the SOLE save path. No LogSeq involvement.
 *
 * Semantics:
 *
 *   Strokes (append-only with explicit deletions):
 *     - Start from the existing PageDoc on disk as the base.
 *     - Remove strokes whose id is in deletedStrokeIds.
 *     - Append new strokes from the canvas (deduplicated by id).
 *     - Update lineId and the sketch flag on existing strokes if the in-memory
 *       version differs.
 *     - Never infer deletions from count differences.
 *     - ONE exception to immutable geometry: rewrite a stored stroke's `points`
 *       when the canvas copy carries the `pointsEdited` marker, which only
 *       `removeStrokePoints()` in stores/strokes.js sets. See mergeEditedPoints
 *       below for why the marker rather than a count comparison.
 *
 *   Transcript (incremental append):
 *     - If pageTranscription is provided, treat its `lines` as NEW lines (the
 *       ActionBar limits MyScript input to untranscribed strokes only).
 *     - Generate fresh UUIDs for the new lines.
 *     - For each new line, match strokes via Y-bounds overlap and write the
 *       new lineId onto those strokes.
 *     - Skip duplicate lines whose text+yBounds match an existing line.
 *     - Existing transcript.lines are preserved.
 *
 *   Editor-driven full transcript rewrites bypass this module and call
 *   savePage() directly (see PageCard.svelte handleSaveEditor).
 */

import { getPage, savePage, deletePage } from './local-store.js';
import { emptyPageDoc, computeBounds, PAGE_DOC_VERSION } from './page-doc.js';
import { pageInfoForDisk } from '$lib/volumes.js';
import { noteOnDiskStrokeIds } from '$stores/pending-changes.js';

/* -----------------------------------------------------------------
 *  Stroke shape conversion
 * ----------------------------------------------------------------- */

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Convert a pen-format stroke (with dotArray) to v2 StoredStroke shape.
 *
 * Point tuples are variable length — `[x, y]`, `[x, y, ts]`, or
 * `[x, y, ts|null, force]` — so that pressure can ride along without disturbing
 * files or readers that predate it. Force is written whenever the dot has one,
 * regardless of whether the stroke is flagged as a sketch: see the StoredStroke
 * typedef for why that has to be unconditional.
 *
 * @param {Object} stroke - { startTime, endTime, blockUuid?, sketch?, dotArray: [{x,y,f?,timestamp?}] }
 * @returns {import('./page-doc.js').StoredStroke}
 */
export function strokeToStored(stroke) {
  const points = (stroke.dotArray || []).map(d => {
    const x = round2(d.x);
    const y = round2(d.y);
    const hasTs = typeof d.timestamp === 'number';
    // Pen force arrives as a 16-bit integer; keep it integral so the extra
    // column costs ~4 characters per point rather than a full float.
    const f = (d.f === null || d.f === undefined || typeof d.f === 'boolean')
      ? NaN
      : Number(d.f);
    if (!Number.isFinite(f)) {
      return hasTs ? [x, y, d.timestamp] : [x, y];
    }
    // Force must keep a fixed index, so an unrecorded timestamp becomes an
    // explicit null placeholder rather than shifting force into slot 2.
    return [x, y, hasTs ? d.timestamp : null, Math.round(f)];
  });

  const stored = {
    id: `s${stroke.startTime}`,
    startTime: stroke.startTime,
    endTime: stroke.endTime,
    lineId: stroke.blockUuid || stroke.lineId || null
  };
  // Omitted when false so handwriting pages serialize exactly as they did before
  // sketch strokes existed.
  if (stroke.sketch) stored.sketch = true;
  stored.points = points;
  return stored;
}

/* -----------------------------------------------------------------
 *  Transcript merge — Y-bounds matching
 * ----------------------------------------------------------------- */

function randomUUID() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const a = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(a);
  else for (let i = 0; i < 16; i++) a[i] = Math.floor(Math.random() * 256);
  a[6] = (a[6] & 0x0f) | 0x40;
  a[8] = (a[8] & 0x3f) | 0x80;
  const hex = [...a].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

/**
 * Do two Y-bound ranges overlap?
 */
function yBoundsOverlap(a, b, tol = 0) {
  if (!a || !b) return false;
  return !(a.maxY + tol < b.minY || b.maxY + tol < a.minY);
}

/**
 * For each new MyScript line, find the storage-format stroke IDs whose Y range
 * touches the line's Y range. Used to attach lineId to strokes.
 *
 * @param {Object} line - { yBounds: {minY, maxY} }
 * @param {Array} storedStrokes - StoredStroke[]
 * @param {number} tol - tolerance in pen-unit (default 5)
 * @returns {string[]} matching stroke ids
 */
function strokesIntersectingLine(line, storedStrokes, tol = 5) {
  if (!line.yBounds) return [];
  const lineMin = line.yBounds.minY - tol;
  const lineMax = line.yBounds.maxY + tol;
  const out = [];
  for (const s of storedStrokes) {
    if (!s.points || s.points.length === 0) continue;
    // Compute stroke Y bounds
    let minY = Infinity, maxY = -Infinity;
    for (const p of s.points) {
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
    if (yBoundsOverlap({ minY, maxY }, { minY: lineMin, maxY: lineMax })) {
      out.push(s.id);
    }
  }
  return out;
}

/**
 * Skip-duplicate test: does a new MyScript line match an existing line by
 * trimmed-text + Y-bounds overlap?
 */
function isDuplicate(newLine, existingLines) {
  const t = (newLine.text || '').trim();
  if (!t) return false;
  for (const ex of existingLines) {
    if ((ex.text || '').trim() === t && yBoundsOverlap(ex.yBounds, newLine.yBounds, 3)) {
      return true;
    }
  }
  return false;
}

/**
 * Merge new MyScript lines into the existing transcript, preserving existing
 * lines untouched. Returns { lines, lineIdAssignments: Map<strokeId,lineId> }.
 */
function mergeTranscript(existingLines, myscriptLines, storedStrokes) {
  // Existing lines keep their order untouched — the user (or an earlier
  // transcription) established it, and re-sorting the whole list scrambles it.
  const existing = [...existingLines];
  const lineIdAssignments = new Map(); // strokeId → new lineId

  if (!myscriptLines || myscriptLines.length === 0) {
    return { lines: existing, lineIdAssignments };
  }

  // Generate IDs upfront so parent linkage by index works
  const newIds = myscriptLines.map(() => randomUUID());

  const newLines = [];
  for (let i = 0; i < myscriptLines.length; i++) {
    const ms = myscriptLines[i];
    const text = (ms.text || '').trim();

    const lineRecord = {
      id: newIds[i],
      text,
      indentLevel: ms.indentLevel || 0,
      parentId:
        (typeof ms.parent === 'number' && ms.parent >= 0 && ms.parent < newIds.length)
          ? newIds[ms.parent]
          : null,
      checked: null,
      yBounds: ms.yBounds && (ms.yBounds.minY !== 0 || ms.yBounds.maxY !== 0)
        ? { minY: ms.yBounds.minY, maxY: ms.yBounds.maxY }
        : null
    };

    if (isDuplicate(lineRecord, existing)) {
      continue;
    }

    newLines.push(lineRecord);

    // Attach lineId to strokes whose Y range overlaps the new line
    const matchingStrokeIds = strokesIntersectingLine(lineRecord, storedStrokes);
    for (const sid of matchingStrokeIds) {
      // Only assign if the stroke doesn't already belong to a line
      lineIdAssignments.set(sid, lineRecord.id);
    }
  }

  // Order the NEW lines among themselves top-to-bottom on the page, then append
  // them after the existing transcript. New transcription always lands at the
  // end rather than being interleaved into the existing lines by Y-position.
  newLines.sort((a, b) => {
    const ay = a.yBounds?.minY ?? 0;
    const by = b.yBounds?.minY ?? 0;
    return ay - by;
  });

  return { lines: [...existing, ...newLines], lineIdAssignments };
}

/* -----------------------------------------------------------------
 *  Main save entry point
 * ----------------------------------------------------------------- */

/**
 * @typedef {Object} SavePageInput
 * @property {number} book
 * @property {number} page
 * @property {Object[]} activeStrokes
 * @property {Set<string>} [deletedStrokeIds]
 * @property {Object|null} [pageTranscription]
 */

/**
 * @typedef {Object} SavePageOutput
 * @property {boolean} success
 * @property {number} added
 * @property {number} edited   - stored strokes whose points were rewritten
 * @property {number} deleted
 * @property {number} total
 * @property {number} lineCount
 * @property {number} [linesAdded]
 * @property {string} [path]
 * @property {string} [error]
 */

/**
 * Save a single page to the local data folder.
 * @param {SavePageInput} input
 * @returns {Promise<SavePageOutput>}
 */
export async function savePageToFolder(input) {
  const { book, page, activeStrokes = [], deletedStrokeIds = new Set(), pageTranscription = null } = input;

  try {
    // `book` is a BOOK KEY ("388" or "388v2"). On disk it splits back into a
    // numeric `book` plus an optional `volume` (omitted when 1), which is what
    // keeps every pre-volume file byte-identical and validatePageDoc's
    // `typeof book === 'number'` check satisfied.
    const pageInfo = pageInfoForDisk(activeStrokes[0]?.pageInfo, book, page);

    const existing = (await getPage(book, page)) || emptyPageDoc(pageInfo);
    if (existing.pageInfo) {
      if (!pageInfo.section && existing.pageInfo.section) pageInfo.section = existing.pageInfo.section;
      if (!pageInfo.owner && existing.pageInfo.owner)   pageInfo.owner = existing.pageInfo.owner;
    }

    // ----- Strokes: explicit deletions, then append new -----
    const newStored = activeStrokes.map(strokeToStored);
    const existingStrokes = Array.isArray(existing.strokes) ? existing.strokes : [];

    let merged;
    let deletedCount = 0;
    if (deletedStrokeIds && deletedStrokeIds.size > 0) {
      merged = existingStrokes.filter(s => !deletedStrokeIds.has(s.id));
      deletedCount = existingStrokes.length - merged.length;
    } else {
      merged = [...existingStrokes];
    }

    const existingIds = new Set(merged.map(s => s.id));
    let addedCount = 0;
    let editedCount = 0;
    const newById = new Map(newStored.map(s => [s.id, s]));

    // Ids whose captured geometry the user edited (points deleted). Derived from
    // the canvas strokes we were handed rather than passed in separately, so the
    // intent travels with the stroke it belongs to and can't be mismatched.
    //
    // Deliberately keyed on the explicit `pointsEdited` marker and NOT on "the
    // canvas copy has fewer points than the stored one". Append-only exists to
    // make partial canvas state incapable of destroying stored data; a count
    // comparison would hand that power to any future code path that filters a
    // dotArray for its own purposes. The marker is set in exactly one place.
    const editedIds = new Set(
      activeStrokes.filter(s => s && s.pointsEdited).map(s => `s${s.startTime}`)
    );

    // Sync mutable per-stroke state from the canvas onto strokes already on disk:
    // lineId and the sketch flag are annotations the user changes after the fact,
    // and points are rewritten only for explicitly edited strokes.
    merged = merged.map(s => {
      const fresh = newById.get(s.id);
      if (!fresh) return s;

      let next = s;
      if (fresh.lineId && fresh.lineId !== s.lineId) {
        next = { ...next, lineId: fresh.lineId };
      }
      // Two-way: marking and unmarking both have to persist, and `sketch` is
      // absent rather than false when off, so compare as booleans.
      if (!!fresh.sketch !== !!s.sketch) {
        next = { ...next };
        if (fresh.sketch) next.sketch = true;
        else delete next.sketch;
      }
      // Geometry rewrite. `fresh.points` came through strokeToStored, so the
      // surviving points keep their `[x, y, ts|null, force]` shape — a sketch
      // stroke stays a pressure-varying sketch across the edit. Assigning into
      // the existing key keeps `points` in its original position, so the
      // serialized line's key order is unchanged.
      if (editedIds.has(s.id) && Array.isArray(fresh.points)) {
        next = { ...next, points: fresh.points };
        editedCount++;
      }
      return next;
    });

    for (const s of newStored) {
      if (!existingIds.has(s.id)) {
        merged.push(s);
        addedCount++;
      }
    }

    merged.sort((a, b) => (a.startTime || 0) - (b.startTime || 0));

    // ----- Transcript: append-merge -----
    let transcript = existing.transcript || { lastTranscribed: null, lines: [] };
    let linesAdded = 0;

    if (pageTranscription && Array.isArray(pageTranscription.lines) && pageTranscription.lines.length > 0) {
      const before = transcript.lines.length;
      const { lines, lineIdAssignments } = mergeTranscript(
        transcript.lines || [],
        pageTranscription.lines,
        merged
      );
      linesAdded = lines.length - before;

      if (linesAdded > 0 || lineIdAssignments.size > 0) {
        // Attach new lineIds to strokes that didn't already have one
        merged = merged.map(s => {
          if (s.lineId) return s; // already linked — leave it alone
          const newLineId = lineIdAssignments.get(s.id);
          if (newLineId) return { ...s, lineId: newLineId };
          return s;
        });

        transcript = {
          lastTranscribed: new Date().toISOString(),
          lines
        };
      }
    }

    // Scrub any dangling lineIds (defensive — e.g. after editor-driven deletes)
    {
      const liveLineIds = new Set(transcript.lines.map(l => l.id));
      merged = merged.map(s => (s.lineId && !liveLineIds.has(s.lineId)) ? { ...s, lineId: null } : s);
    }

    const doc = {
      version: PAGE_DOC_VERSION,
      pageInfo,
      metadata: {
        lastUpdated: new Date().toISOString(),
        totalStrokes: merged.length,
        bounds: computeBounds(merged)
      },
      transcript,
      strokes: merged
    };

    const result = await savePage(book, page, doc);

    // Refresh the on-disk stroke-id index so pendingChanges reflects the save
    // immediately (just-saved strokes stop counting as additions) without a
    // full rescan. `page` is the integer NCode page used for capture saves,
    // which matches how canvas strokes are grouped in pendingChanges.
    noteOnDiskStrokeIds(book, page, merged);

    return {
      success: true,
      added: addedCount,
      edited: editedCount,
      deleted: deletedCount,
      total: merged.length,
      lineCount: doc.transcript.lines.length,
      linesAdded,
      path: result.path
    };
  } catch (err) {
    console.error('[savePageToFolder] failed:', err);
    return {
      success: false,
      error: err.message || String(err),
      added: 0, edited: 0, deleted: 0, total: 0, lineCount: 0
    };
  }
}

/* -----------------------------------------------------------------
 *  Volume moves — tidy up after the strokes have landed
 * ----------------------------------------------------------------- */

/**
 * Pure core of the whole-page move decision.
 *
 * Strokes move because `reassignVolume()` rewrote their pageInfo and the source
 * page's save deleted them by id (see `getMovedAwayStrokeIdsForPage`). Two things
 * that does NOT move on its own:
 *
 *   1. **The transcript.** Lines live in `doc.transcript.lines`, not on strokes,
 *      so moving every stroke off a page leaves the recognised text behind, with
 *      the strokes' lineIds already scrubbed. Nothing links them any more.
 *   2. **The file.** A page emptied of strokes is still written, so it lingers as
 *      a 0-stroke ghost in Saved Pages and Book View.
 *
 * Only carried when the source ends up genuinely empty and exactly one target
 * received its strokes — a partial move is a partial move, and splitting a
 * transcript by guesswork would be worse than leaving it put.
 *
 * @param {{strokeCount: number, lineCount: number}} source  state AFTER the save
 * @param {{lineCount: number}} target                       state AFTER the save
 * @param {number} targetCount how many distinct pages received this page's strokes
 * @returns {{carryTranscript: boolean, deleteSource: boolean}}
 */
export function planPageMove(source, target, targetCount) {
  const sourceEmptyOfStrokes = (source?.strokeCount || 0) === 0;
  const sourceHasTranscript = (source?.lineCount || 0) > 0;
  const targetHasTranscript = (target?.lineCount || 0) > 0;

  // Never overwrite a transcript the target already has — that's real recognised
  // text and the source's claim to it is no stronger.
  const carryTranscript =
    sourceEmptyOfStrokes && sourceHasTranscript && !targetHasTranscript && targetCount === 1;

  const deleteSource = sourceEmptyOfStrokes && (carryTranscript || !sourceHasTranscript);

  return { carryTranscript, deleteSource };
}

/**
 * Run `planPageMove` against disk for each completed move.
 *
 * Called AFTER the per-page saves, so it never races them: by this point the
 * source page has already lost its strokes and the target has already gained
 * them, and both docs on disk are final.
 *
 * Best-effort — a failure here leaves a ghost page, not lost data, so it logs
 * and continues rather than failing the save that already succeeded.
 *
 * @param {Array<{fromBook: string, fromPage: number|string, toBook: string, toPage: number|string}>} moves
 * @returns {Promise<{transcriptsMoved: number, pagesDeleted: number, errors: string[]}>}
 */
export async function finalizePageMoves(moves) {
  const out = { transcriptsMoved: 0, pagesDeleted: 0, errors: [] };
  if (!Array.isArray(moves) || moves.length === 0) return out;

  // How many distinct targets each source fed — a source split across two
  // volumes has no single place for its transcript to follow.
  const targetsPerSource = new Map();
  for (const m of moves) {
    const srcKey = `${m.fromBook}/${m.fromPage}`;
    if (!targetsPerSource.has(srcKey)) targetsPerSource.set(srcKey, new Set());
    targetsPerSource.get(srcKey).add(`${m.toBook}/${m.toPage}`);
  }

  const seen = new Set();
  for (const m of moves) {
    const srcKey = `${m.fromBook}/${m.fromPage}`;
    if (seen.has(srcKey)) continue;
    seen.add(srcKey);

    try {
      const sourceDoc = await getPage(m.fromBook, m.fromPage);
      if (!sourceDoc) continue;

      const sourceState = {
        strokeCount: (sourceDoc.strokes || []).length,
        lineCount: (sourceDoc.transcript?.lines || []).length
      };
      const targetDoc = await getPage(m.toBook, m.toPage);
      const targetState = { lineCount: (targetDoc?.transcript?.lines || []).length };

      const plan = planPageMove(sourceState, targetState, targetsPerSource.get(srcKey).size);

      if (plan.carryTranscript && targetDoc) {
        await savePage(m.toBook, m.toPage, {
          ...targetDoc,
          transcript: sourceDoc.transcript,
          metadata: { ...(targetDoc.metadata || {}), lastUpdated: new Date().toISOString() }
        });
        out.transcriptsMoved++;
      }

      if (plan.deleteSource) {
        await deletePage(m.fromBook, m.fromPage);
        out.pagesDeleted++;
      }
    } catch (err) {
      out.errors.push(`${srcKey}: ${err.message || String(err)}`);
    }
  }

  return out;
}
