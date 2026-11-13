/**
 * canvas-save — the Editor's Save: writes the pages ticked in the save dialog
 * (SaveConfirmDialog) from the canvas, then settles the in-memory markers.
 * Called by ActionBar; the plan's pure parts are lib/canvas-save-plan.js.
 *
 * Every rule here is a CLAUDE.md invariant: append-only saves with explicit
 * deletions, volume moves force-include their source page, retimes are
 * recorded in pages/_retimed.json before the page write, the reading views are
 * refreshed afterwards.
 */
import { get } from 'svelte/store';
import {
  strokes, removeStrokesByIndices,
  clearPointEditMarkers, clearMovedFromMarkers, clearRetimedMarkers
} from './strokes.js';
import {
  deletedIndices, pendingChanges, getActiveStrokesForPage, getDeletedStrokeIdsForPage,
  getMovedAwayStrokeIdsForPage, getRetimedAwayStrokeIdsForPage,
  adjustDeletionsAfterRemoval, clearDeletedIndices
} from './pending-changes.js';
import { adjustSelectionAfterDeletion } from './selection.js';
import { pointEditMode, exitPointEditMode } from './point-edit.js';
import { filteredStrokes } from './filtered-strokes.js';
import { pageTranscriptions, clearPageTranscription } from './transcription.js';
import { forgetReset } from './transcript-reset.js';
import { recordRetimesFor } from './retimed.js';
import { carryTagsForMoves } from './tags.js';
import { dataRoot, dataFolderReady } from './settings.js';
import {
  setStorageSaving, recordSuccessfulSave, recordStorageError, clearUnsavedChanges
} from './storage.js';
import { log } from './ui.js';
import { savePageToFolder, finalizePageMoves } from '$lib/storage/save-page.js';
import { refreshAfterSave } from '$lib/storage/refresh.js';
import {
  groupPagesToSave, settledDeletionIndices, describePageSave, transcriptionPageKey
} from '$lib/canvas-save-plan.js';
import { plural } from '$lib/plural.js';

/**
 * Save the selected pages. Never throws for a page's failure (each is logged
 * and counted); the caller only tracks that a save is running.
 *
 * @param {string[]} selectedPageKeys  `${book}-${page}` keys from the dialog
 */
export async function saveCanvasPages(selectedPageKeys) {
  if (!selectedPageKeys || selectedPageKeys.length === 0) {
    log('No pages selected for save', 'warning');
    return;
  }
  if (!get(dataRoot) || !get(dataFolderReady)) {
    log('No data folder configured. Pick one in Settings.', 'error');
    return;
  }

  setStorageSaving(true);
  let savedPagesCount = 0;
  let savedTranscriptionCount = 0;
  let errorCount = 0;

  try {
    const { pagesToSave, moveSources } = groupPagesToSave(get(strokes), selectedPageKeys);
    if (pagesToSave.size === 0) {
      log('No selected pages have strokes to save', 'warning');
      return;
    }

    log(`Saving ${pagesToSave.size} selected ${plural(pagesToSave.size, 'page')} to the data folder…`, 'info');

    const completedMoves = [];   // for the post-save transcript carry / ghost-file cleanup
    const writtenPages = [];     // so the Library, search and Timeline can catch up
    const savedKeys = new Set(); // pages whose deletion marks the save settled

    for (const [key, { book, page }] of pagesToSave) {
      const label = `B${book}/P${page}`;
      const activeStrokes = getActiveStrokesForPage(book, page);
      const deletedOnPage = getDeletedStrokeIdsForPage(book, page);
      const movedAwayIds = getMovedAwayStrokeIdsForPage(book, page);
      // Old ids of strokes retimed on this page (lib/retime.js): the retimed
      // copy is appended under its new id, so the old one must go.
      const retimedAwayIds = getRetimedAwayStrokeIdsForPage(book, page);
      // Strokes whose old id is confirmed on disk, for the log line.
      const retimedCount = get(pendingChanges).get(label)?.retimes?.length || 0;
      // A page emptied by a move has no active strokes but still owes the
      // deletions, so "nothing to do" means nothing to add AND nothing to remove.
      if (activeStrokes.length === 0 && movedAwayIds.size === 0 && deletedOnPage.size === 0) {
        log(`Skipping ${label} (no active strokes)`, 'info');
        continue;
      }

      try {
        // "Remove this id from the stored page" is the same operation whether
        // the stroke was deleted, moved to another volume or retimed.
        const deletedIds = new Set([...deletedOnPage, ...movedAwayIds, ...retimedAwayIds]);

        // Retimes go into pages/_retimed.json BEFORE the page write, so a pen
        // import can't bring the old-time copy back. Moved-away strokes are
        // included in case their target page isn't saved now (recording is
        // idempotent). A failed write holds this page back (caught below).
        await recordRetimesFor([
          ...activeStrokes,
          ...get(strokes).filter((s) => s.movedFrom && s.retimedFrom &&
            String(s.movedFrom.book) === String(book) && String(s.movedFrom.page) === String(page))
        ]);

        // The page's MyScript result from this session, if any.
        const pageInfo = activeStrokes[0]?.pageInfo || { section: 0, owner: 0, book, page };
        const pageKey = transcriptionPageKey({ ...pageInfo, book, page });
        const pageTranscription = get(pageTranscriptions).get(pageKey) || null;

        // Strokes and transcript merge in one atomic write.
        const result = await savePageToFolder({
          book, page, activeStrokes, deletedStrokeIds: deletedIds, pageTranscription
        });

        if (!result.success) {
          recordStorageError(result.error);
          log(`Failed to save ${label}: ${result.error}`, 'error');
          errorCount++;
          continue;
        }

        recordSuccessfulSave(label, result);
        if (result.reIded) {
          log(`${label}: ${result.reIded} ${plural(result.reIded, 'stroke')} shared a start time with another and ${result.reIded === 1 ? 'was' : 'were'} saved 1 ms later`, 'warning');
        }
        writtenPages.push({ book, page });
        savedKeys.add(key);

        // The edited points are on disk, so the intent markers have done their
        // job. Not gated on `result.edited`: a stroke point-edited before its
        // first save is written by the append branch (reported as an addition).
        clearPointEditMarkers(book, page);
        // The old ids are gone from disk; a marker left behind would make a
        // later save delete an id that may belong to another stroke by then.
        clearRetimedMarkers(book, page);
        if (pageTranscription) {
          // In the file now; left in the store, the save dialog would list the
          // page as a transcript change and Review would keep it pending.
          clearPageTranscription(pageKey);
          // A reset page's re-transcription is on disk: its links are the new ones.
          forgetReset(book, page);
        }

        // The source page has lost the moved strokes on disk; a marker left
        // behind would re-delete ids that are no longer there.
        if (movedAwayIds.size > 0) {
          for (const target of (moveSources.get(key)?.targets.values() || [])) {
            completedMoves.push({ fromBook: book, fromPage: page, toBook: target.book, toPage: target.page });
          }
          clearMovedFromMarkers(book, page);
        }

        log(describePageSave(label, result, { retimed: retimedCount, movedAway: movedAwayIds.size }), 'success');
        savedPagesCount++;
        if (pageTranscription && result.transcriptChanged) savedTranscriptionCount++;
      } catch (error) {
        recordStorageError(error.message);
        log(`Error saving ${label}: ${error.message}`, 'error');
        errorCount++;
      }
    }

    // Finish the moves AFTER every page save, so both docs on disk are final:
    // carry a transcript stranded on a page whose strokes have all left, and
    // remove the emptied source file so it doesn't linger as a 0-stroke ghost.
    if (completedMoves.length > 0) {
      const tidy = await finalizePageMoves(completedMoves);
      if (tidy.transcriptsMoved > 0) {
        log(`Moved ${tidy.transcriptsMoved} ${plural(tidy.transcriptsMoved, 'transcript')} to follow their strokes`, 'info');
      }
      if (tidy.pagesDeleted > 0) {
        log(`Removed ${tidy.pagesDeleted} emptied page ${plural(tidy.pagesDeleted, 'file')}`, 'info');
      }
      for (const err of tidy.errors) log(`Move cleanup: ${err}`, 'warning');
      // Page tags live in _tags.json, so a whole-page move carries them too.
      const tagsMoved = await carryTagsForMoves(tidy.emptied);
      if (tagsMoved > 0) log(`Moved the tags of ${tagsMoved} ${plural(tagsMoved, 'page')} to follow their strokes`, 'info');
    }

    if (savedPagesCount > 0) {
      log(savedTranscriptionCount > 0
        ? `Saved ${savedPagesCount} ${plural(savedPagesCount, 'page')} with strokes and transcription`
        : `Saved ${savedPagesCount} ${plural(savedPagesCount, 'page')} with strokes`, 'success');
      dropSettledDeletions(savedKeys);
    }
    if (errorCount > 0) log(`Failed to save ${errorCount} ${plural(errorCount, 'page')}`, 'error');

    // The reading views hold their own copies (scan, page cache, thumbnails,
    // capture dates); refresh them in the background.
    if (writtenPages.length || completedMoves.length) {
      refreshAfterSave([...writtenPages, ...completedMoves.map((m) => ({ book: m.fromBook, page: m.fromPage }))]);
    }

    // Reconcile the unsaved-changes indicator. This MUST run after
    // dropSettledDeletions(): removeStrokesByIndices() calls
    // markUnsavedChanges(), which would re-latch the dot right after
    // recordSuccessfulSave() cleared it. Only when nothing failed and no
    // deletion is still owed to a page that wasn't saved.
    if (errorCount === 0 && savedPagesCount > 0 && get(deletedIndices).size === 0) {
      clearUnsavedChanges();
    }
  } finally {
    setStorageSaving(false);
  }
}

/**
 * Take the strokes whose deletion is now on disk off the canvas, and re-point
 * every index-keyed store (same list as stores/canvas.js unloadPageFromCanvas).
 * Marks on pages that were not saved (not selected, or the write failed) stay.
 */
function dropSettledDeletions(savedKeys) {
  const removed = settledDeletionIndices(get(strokes), get(deletedIndices), savedKeys);
  if (removed.length > 0) {
    // Point-edit keys are "strokeIdx:pointIdx" and have no sensible shift.
    if (get(pointEditMode)) exitPointEditMode();
    adjustSelectionAfterDeletion(removed);
    adjustDeletionsAfterRemoval(removed);
    if (get(filteredStrokes).length > 0) filteredStrokes.set([]);
    removeStrokesByIndices(removed);
    log(`Removed ${removed.length} deleted ${plural(removed.length, 'stroke')} from the canvas`, 'info');
  }
  if (get(deletedIndices).size === 0) clearDeletedIndices();
}
