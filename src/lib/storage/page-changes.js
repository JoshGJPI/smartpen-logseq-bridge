/**
 * Compute the per-page change preview shown by SaveConfirmDialog, against the
 * PageDoc on disk.
 *
 * Returns: { strokeAdditions, strokeEdits, strokeModifications, strokeDeletions,
 *            strokeMoves, strokeRetimes, strokeTotal, hasNewTranscription, transcriptionChanged }
 *
 * This is a SECOND implementation of the question `pendingChanges` answers, run
 * against the PageDoc on disk rather than the in-memory on-disk state index, so
 * the two have to stay on the same rules. See computePendingChangesMap.
 */

import { getPage } from './local-store.js';
import { planTranscript, round2 } from './save-page.js';

function getStrokeId(s) {
  return s.id || (s.startTime ? `s${s.startTime}` : null);
}

/**
 * Has this canvas stroke's geometry been edited relative to the stored copy?
 *
 * Point editing deletes points (a differing count) or snaps them onto a
 * neighbour (same count, different coordinates), so both are compared, the
 * coordinates at the 2 decimals they are stored with. An unknown point list on
 * either side reports no edit rather than guessing. `computePendingChangesMap()`
 * answers the same question from a count plus the `pointsEdited` marker, because
 * it has no stored coordinates; change both together.
 *
 * Note this reads actual state rather than the `pointsEdited` intent marker that
 * gates the *write* in save-page.js: for a preview, "what will change on disk" is
 * the honest question, and reading it from the file catches a mismatch the marker
 * would hide.
 */
function isPointEdited(canvasStroke, stored) {
  const dots = Array.isArray(canvasStroke.dotArray) ? canvasStroke.dotArray : null;
  const points = Array.isArray(stored.points) ? stored.points : null;
  if (!dots || !points) return false;
  if (dots.length !== points.length) return true;
  return dots.some((d, i) => round2(d.x) !== points[i][0] || round2(d.y) !== points[i][1]);
}


/**
 * @param {number} book
 * @param {number} page
 * @param {Array} activeStrokes      - Pen-format strokes (with dotArray)
 * @param {Object|null} transcription - Fresh MyScript output for this page, or null
 * @param {Set<string>} [deletedStrokeIds]
 * @param {Set<string>} [movedAwayStrokeIds] - ids leaving for another volume
 * @param {Set<string>} [retimedAwayStrokeIds] - old ids of strokes retimed on this page
 */
export async function computePageChangesFolder(
  book, page, activeStrokes, transcription,
  deletedStrokeIds = new Set(), movedAwayStrokeIds = new Set(), retimedAwayStrokeIds = new Set()
) {
  try {
    const existing = await getPage(book, page);

    let strokeAdditions = 0;
    let strokeEdits = 0;
    let strokeModifications = 0;
    let strokeDeletions = 0;
    let strokeMoves = 0;
    let strokeRetimes = 0;
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
          // Retimed (lib/retime.js): the new id replaces the stored old one, so
          // it neither adds nor removes a stroke. Same rule as pendingChanges.
          const from = s.retimedFrom?.id;
          if (from && !s.movedFrom && existingById.has(from) && retimedAwayStrokeIds.has(from)) {
            strokeRetimes++;
          } else {
            strokeAdditions++;
          }
        } else if (isPointEdited(s, stored)) {
          // Already on disk, but the user deleted or snapped points. The save
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
      // Asks the save's own planner, not a text comparison: the save parses task
      // boxes, skips lines already saved and keeps saved lines the batch didn't
      // cover, so comparing raw text called a saved page "changed" forever.
      const existingLines = existing?.transcript?.lines || [];
      const { changed } = planTranscript(existingLines, transcription);
      if (changed) {
        if (existingLines.length === 0) hasNewTranscription = true;
        else transcriptionChanged = true;
      }
    }

    return {
      strokeAdditions,
      strokeEdits,
      strokeModifications,
      strokeDeletions,
      strokeMoves,
      strokeRetimes,
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
      strokeRetimes: 0,
      strokeTotal: activeStrokes.length,
      hasNewTranscription: !!transcription?.text,
      transcriptionChanged: false
    };
  }
}

/** Does a page's change preview (computePageChangesFolder) have anything to save? */
export function hasPageChanges(c) {
  return !!c && (c.strokeAdditions > 0 || c.strokeEdits > 0 || c.strokeModifications > 0 ||
    c.strokeDeletions > 0 || c.strokeMoves > 0 || c.strokeRetimes > 0 ||
    c.hasNewTranscription || c.transcriptionChanged);
}

/**
 * The save dialog's summary over the ticked pages: stroke counts summed, and
 * how many pages get a new or an updated transcript.
 *
 * @param {Array<{pageKey: string}>} items  page previews (computePageChangesFolder plus pageKey)
 * @param {Set<string>} selected  ticked pageKeys
 */
export function sumSelectedChanges(items, selected) {
  const totals = {
    pages: 0, strokeAdditions: 0, strokeEdits: 0, strokeModifications: 0, strokeDeletions: 0,
    strokeMoves: 0, strokeRetimes: 0, newTranscriptions: 0, changedTranscriptions: 0
  };
  for (const item of items || []) {
    if (!selected?.has(item.pageKey)) continue;
    totals.pages++;
    for (const k of ['strokeAdditions', 'strokeEdits', 'strokeModifications', 'strokeDeletions', 'strokeMoves', 'strokeRetimes']) {
      totals[k] += item[k] || 0;
    }
    if (item.hasNewTranscription) totals.newTranscriptions++;
    if (item.transcriptionChanged) totals.changedTranscriptions++;
  }
  return totals;
}
