/**
 * Compute the per-page change preview shown by SaveConfirmDialog.
 *
 * v2.0 folder-backed replacement for logseq-api.js computePageChanges().
 *
 * Returns: { strokeAdditions, strokeEdits, strokeModifications, strokeDeletions,
 *            strokeMoves, strokeTotal, hasNewTranscription, transcriptionChanged }
 *
 * This is a SECOND implementation of the question `pendingChanges` answers, run
 * against the PageDoc on disk rather than the in-memory on-disk state index, so
 * the two have to stay on the same rules. See computePendingChangesMap.
 */

import { getPage } from './local-store.js';

function getStrokeId(s) {
  return s.id || (s.startTime ? `s${s.startTime}` : null);
}

/**
 * Has this canvas stroke's geometry been edited relative to the stored copy?
 *
 * Point editing only ever deletes points, so a differing count is the whole
 * test. This is the same rule `computePendingChangesMap()` uses, deliberately —
 * an unknown count on either side reports no edit rather than guessing.
 *
 * Note this reads actual state rather than the `pointsEdited` intent marker that
 * gates the *write* in save-page.js: for a preview, "what will change on disk" is
 * the honest question, and reading it from the file catches a mismatch the marker
 * would hide.
 */
function isPointEdited(canvasStroke, stored) {
  const canvasPoints = Array.isArray(canvasStroke.dotArray) ? canvasStroke.dotArray.length : null;
  const storedPoints = Array.isArray(stored.points) ? stored.points.length : null;
  return canvasPoints != null && storedPoints != null && canvasPoints !== storedPoints;
}

/**
 * @param {number} book
 * @param {number} page
 * @param {Array} activeStrokes      - Pen-format strokes (with dotArray)
 * @param {Object|null} transcription - Fresh MyScript output for this page, or null
 * @param {Set<string>} [deletedStrokeIds]
 * @param {Set<string>} [movedAwayStrokeIds] - ids leaving for another volume
 */
export async function computePageChangesFolder(
  book, page, activeStrokes, transcription,
  deletedStrokeIds = new Set(), movedAwayStrokeIds = new Set()
) {
  try {
    const existing = await getPage(book, page);

    let strokeAdditions = 0;
    let strokeEdits = 0;
    let strokeModifications = 0;
    let strokeDeletions = 0;
    let strokeMoves = 0;
    let strokeTotal = activeStrokes.length;

    if (!existing || !existing.strokes) {
      strokeAdditions = activeStrokes.length;
    } else {
      const existingById = new Map(
        existing.strokes.filter(s => s.id).map(s => [s.id, s])
      );
      for (const s of activeStrokes) {
        const id = getStrokeId(s);
        if (!id) continue;
        const stored = existingById.get(id);
        if (!stored) {
          strokeAdditions++;
        } else if (isPointEdited(s, stored)) {
          // Already on disk, but the user deleted points from it. The save
          // rewrites the stored stroke's geometry — the one case where captured
          // data is overwritten — so it gets its own category and its own
          // warning, not the flag bucket.
          strokeEdits++;
        } else if (!!s.sketch !== !!stored.sketch) {
          // Already on disk, but the sketch flag was toggled since. The save
          // syncs the flag onto the stored stroke, so it is a real change —
          // it just doesn't alter the stroke count.
          strokeModifications++;
        }
      }
      if (deletedStrokeIds.size > 0) {
        for (const id of deletedStrokeIds) {
          if (existingById.has(id)) strokeDeletions++;
        }
      }
      // Strokes this page loses to another volume. Counted apart from deletions
      // because nothing is destroyed — the stroke lives on in the target volume —
      // but the page's own count drops just the same.
      if (movedAwayStrokeIds.size > 0) {
        for (const id of movedAwayStrokeIds) {
          if (existingById.has(id) && !deletedStrokeIds.has(id)) strokeMoves++;
        }
      }
      strokeTotal = existing.strokes.length - strokeDeletions - strokeMoves + strokeAdditions;
    }

    let hasNewTranscription = false;
    let transcriptionChanged = false;
    if (transcription && Array.isArray(transcription.lines) && transcription.lines.length > 0) {
      const existingLines = existing?.transcript?.lines || [];
      if (existingLines.length === 0) {
        hasNewTranscription = true;
      } else {
        // Compare by joined text (same heuristic as v1 computePageChanges)
        const newText = transcription.lines.map(l => (l.text || '').trim()).join('\n');
        const oldText = existingLines.map(l => (l.text || '').trim()).join('\n');
        if (newText !== oldText) transcriptionChanged = true;
      }
    }

    return {
      strokeAdditions,
      strokeEdits,
      strokeModifications,
      strokeDeletions,
      strokeMoves,
      strokeTotal,
      hasNewTranscription,
      transcriptionChanged
    };
  } catch (err) {
    console.error(`Failed to compute changes for B${book}/P${page}:`, err);
    return {
      strokeAdditions: activeStrokes.length,
      strokeEdits: 0,
      strokeModifications: 0,
      strokeDeletions: 0,
      strokeMoves: 0,
      strokeTotal: activeStrokes.length,
      hasNewTranscription: !!transcription?.text,
      transcriptionChanged: false
    };
  }
}
