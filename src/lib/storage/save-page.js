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
 *     - Update lineId on existing strokes if the in-memory version differs.
 *     - Never infer deletions from count differences.
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

import { getPage, savePage } from './local-store.js';
import { emptyPageDoc, computeBounds, PAGE_DOC_VERSION } from './page-doc.js';
import { noteOnDiskStrokeIds } from '$stores/pending-changes.js';

/* -----------------------------------------------------------------
 *  Stroke shape conversion
 * ----------------------------------------------------------------- */

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Convert a pen-format stroke (with dotArray) to v2 StoredStroke shape.
 * @param {Object} stroke - { startTime, endTime, blockUuid?, dotArray: [{x,y,timestamp}] }
 * @returns {import('./page-doc.js').StoredStroke}
 */
export function strokeToStored(stroke) {
  const points = (stroke.dotArray || []).map(d => {
    const x = round2(d.x);
    const y = round2(d.y);
    if (typeof d.timestamp === 'number') return [x, y, d.timestamp];
    return [x, y];
  });
  return {
    id: `s${stroke.startTime}`,
    startTime: stroke.startTime,
    endTime: stroke.endTime,
    lineId: stroke.blockUuid || stroke.lineId || null,
    points
  };
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
  const lines = [...existingLines];
  const lineIdAssignments = new Map(); // strokeId → new lineId

  if (!myscriptLines || myscriptLines.length === 0) {
    return { lines, lineIdAssignments };
  }

  // Generate IDs upfront so parent linkage by index works
  const newIds = myscriptLines.map(() => randomUUID());

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

    if (isDuplicate(lineRecord, lines)) {
      continue;
    }

    lines.push(lineRecord);

    // Attach lineId to strokes whose Y range overlaps the new line
    const matchingStrokeIds = strokesIntersectingLine(lineRecord, storedStrokes);
    for (const sid of matchingStrokeIds) {
      // Only assign if the stroke doesn't already belong to a line
      lineIdAssignments.set(sid, lineRecord.id);
    }
  }

  // Sort by yBounds.minY (top-to-bottom on the page) for readability
  lines.sort((a, b) => {
    const ay = a.yBounds?.minY ?? 0;
    const by = b.yBounds?.minY ?? 0;
    return ay - by;
  });

  return { lines, lineIdAssignments };
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
    const pageInfo = activeStrokes[0]?.pageInfo
      ? {
          section: activeStrokes[0].pageInfo.section || 0,
          owner: activeStrokes[0].pageInfo.owner || 0,
          book,
          page
        }
      : { section: 0, owner: 0, book, page };

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
    const newById = new Map(newStored.map(s => [s.id, s]));

    // Update lineId on existing strokes if canvas version differs
    merged = merged.map(s => {
      const fresh = newById.get(s.id);
      if (fresh && fresh.lineId && fresh.lineId !== s.lineId) {
        return { ...s, lineId: fresh.lineId };
      }
      return s;
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
      added: 0, deleted: 0, total: 0, lineCount: 0
    };
  }
}
