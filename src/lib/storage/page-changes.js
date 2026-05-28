/**
 * Compute the per-page change preview shown by SaveConfirmDialog.
 *
 * v2.0 folder-backed replacement for logseq-api.js computePageChanges().
 *
 * Returns: { strokeAdditions, strokeDeletions, strokeTotal,
 *            hasNewTranscription, transcriptionChanged }
 */

import { getPage } from './local-store.js';

function getStrokeId(s) {
  return s.id || (s.startTime ? `s${s.startTime}` : null);
}

/**
 * @param {number} book
 * @param {number} page
 * @param {Array} activeStrokes      - Pen-format strokes (with dotArray)
 * @param {Object|null} transcription - Fresh MyScript output for this page, or null
 * @param {Set<string>} [deletedStrokeIds]
 */
export async function computePageChangesFolder(book, page, activeStrokes, transcription, deletedStrokeIds = new Set()) {
  try {
    const existing = await getPage(book, page);

    let strokeAdditions = 0;
    let strokeDeletions = 0;
    let strokeTotal = activeStrokes.length;

    if (!existing || !existing.strokes) {
      strokeAdditions = activeStrokes.length;
    } else {
      const existingIds = new Set(existing.strokes.map(s => s.id).filter(Boolean));
      for (const s of activeStrokes) {
        const id = getStrokeId(s);
        if (id && !existingIds.has(id)) strokeAdditions++;
      }
      if (deletedStrokeIds.size > 0) {
        for (const id of deletedStrokeIds) {
          if (existingIds.has(id)) strokeDeletions++;
        }
      }
      strokeTotal = existing.strokes.length - strokeDeletions + strokeAdditions;
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

    return { strokeAdditions, strokeDeletions, strokeTotal, hasNewTranscription, transcriptionChanged };
  } catch (err) {
    console.error(`Failed to compute changes for B${book}/P${page}:`, err);
    return {
      strokeAdditions: activeStrokes.length,
      strokeDeletions: 0,
      strokeTotal: activeStrokes.length,
      hasNewTranscription: !!transcription?.text,
      transcriptionChanged: false
    };
  }
}
