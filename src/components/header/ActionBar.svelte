<!--
  ActionBar.svelte - The capture controls: Save, Delete, Undo, Clear, Transcribe.

  Sits inline in the header row (compact buttons, labels drop to icons on a
  narrow window) so a connected pen doesn't add a second header line.

  Always mounted (it owns the save dialog, the progress popups and the in-flight
  save / transcribe handlers); `visible` only decides whether the buttons are
  drawn. Header computes it with lib/capture-bar.js. Connect, Disconnect and
  Fetch Notes moved to the pen chip's menu (PenChip.svelte); the offline
  transfer's progress popup is still drawn here.
-->
<script>
  import { 
    penConnected, 
    penAuthorized, 
    log, 
    clearStrokes, 
    strokeCount,
    hasSelection,
    selectionCount,
    selectedStrokes,
    selectedIndices,
    clearSelection,
    adjustSelectionAfterDeletion,
    strokes,
    removeStrokesByIndices,
    hasMyScriptCredentials,
    isTranscribing,
    setTranscription,
    setPageTranscription,
    clearTranscription,
    setIsTranscribing,
    setActiveTab,
    getMyScriptCredentials,
    hasTranscription,
    hasPageTranscriptions,
    lastTranscription,
    pageTranscriptions,
    transferProgress,
    transferPercent,
    hasPendingDeletions,
    canUndo,
    markStrokesDeleted,
    undoLastDeletion,
    clearDeletedIndices,
    getActiveStrokesForPage,
    hasPendingChanges,
    deletedIndices
  } from '$stores';
  import { getUntranscribedStrokes, clearPointEditMarkers, clearMovedFromMarkers, clearRetimedMarkers } from '$stores/strokes.js';
  import {
    getDeletedStrokeIdsForPage, getMovedAwayStrokeIdsForPage, getRetimedAwayStrokeIdsForPage, pendingChanges
  } from '$stores/pending-changes.js';
  import { recordRetimesFor } from '$stores/retimed.js';
  import { carryTagsForMoves } from '$stores/tags.js';
  import { clearContextInk, contextInkPageKeys } from '$stores/context-ink.js';
  import { writable } from 'svelte/store';
  import SaveConfirmDialog from '$components/dialog/SaveConfirmDialog.svelte';
  
  // Transcription progress state
  const transcriptionProgress = writable({
    active: false,
    currentPage: 0,
    totalPages: 0,
    currentBook: 0,
    currentPageNum: 0,
    successCount: 0,
    errorCount: 0,
    elapsedSeconds: 0
  });
  import { cancelOfflineTransfer } from '$lib/pen-sdk.js';
  import { transcribeStrokes } from '$lib/myscript-api.js';
  // v2.0: sole save path is the local folder
  import { savePageToFolder, finalizePageMoves } from '$lib/storage/save-page.js';
  import { refreshAfterSave } from '$lib/storage/refresh.js';
  import { pageOrientations } from '$stores/orientation.js';
  import { rotationFor, rotateCanvasStrokes } from '$lib/page-orientation.js';
  import { dataRoot, dataFolderReady } from '$stores/settings.js';
  import { unsavedChanges } from '$stores';
  // Removed filtered-strokes import - now handled via user-controlled deselection
  import {
    setStorageSaving,
    recordSuccessfulSave,
    recordStorageError,
    clearUnsavedChanges
  } from '$stores/storage.js';
  
  /** Whether the bar's row is drawn. The dialog and popups' logic run regardless. */
  export let visible = true;

  let isSaving = false;
  let showSaveConfirmDialog = false;
  
  // Determine what data is available to save
  $: hasSaveableData = $strokeCount > 0;
  $: canDelete = $hasSelection;
  $: saveButtonText = isSaving ? 'Saving…' : 'Save';
  $: saveWhat = (() => {
    if ($hasPendingChanges) return 'Save changes';
    if ($hasPageTranscriptions || $hasTranscription) return 'Save strokes and transcription';
    return 'Save strokes';
  })();
  
  // Determine which strokes to transcribe (selected or all)
  $: strokesToTranscribe = $hasSelection ? $selectedStrokes : $strokes;
  $: transcribeCount = $hasSelection ? $selectionCount : $strokeCount;
  $: hasStrokes = $strokeCount > 0;
  $: canTranscribe = $hasMyScriptCredentials && hasStrokes && !$isTranscribing;
  
  // Calculate untranscribed strokes
  $: untranscribedStrokes = getUntranscribedStrokes($strokes);
  $: untranscribedCount = untranscribedStrokes.length;
  $: allTranscribed = $strokeCount > 0 && untranscribedCount === 0;
  $: transcribeTitle = allTranscribed
    ? 'All strokes already transcribed'
    : `Transcribe ${selectedUntranscribedCount} untranscribed stroke(s)`
      + (hasStrokes && untranscribedCount !== $strokeCount
        ? ` (${$strokeCount - untranscribedCount}/${$strokeCount} already transcribed)` : '');
  
  // For selected strokes, count how many are untranscribed
  $: selectedUntranscribedCount = $hasSelection ? getUntranscribedStrokes($selectedStrokes).length : untranscribedCount;
  
  function handleClearCanvas() {
    clearStrokes();
    // Selection indices point into the strokes array, which is now empty; a
    // stale set would select whatever lands at those positions next (and keeps
    // point-edit mode, which follows the selection, from exiting).
    clearSelection();
    clearDeletedIndices();
    // Context ink is drawn for pages that are on the canvas; with the canvas
    // empty it would be the only thing left, which is not a state the user can
    // do anything with.
    clearContextInk();
    // Nothing left on the canvas → nothing to save. Clear the indicator too, or
    // it stays latched with no way to clear it (Save is disabled at 0 strokes).
    clearUnsavedChanges();
    log('Canvas cleared', 'info');
  }
  
  function handleDeleteSelected() {
    const indices = Array.from($selectedIndices);
    if (indices.length === 0) return;
    
    markStrokesDeleted(indices);
    clearSelection();
    log(`Marked ${indices.length} stroke(s) for deletion`, 'info');
  }
  
  function handleUndo() {
    const success = undoLastDeletion();
    if (success) {
      log('Undid last deletion', 'info');
    }
  }
  
  function handleShowSaveDialog() {
    if (!$dataRoot || !$dataFolderReady) {
      log('Please pick a Data Folder in Settings before saving', 'warning');
      return;
    }
    if (!$strokeCount) {
      log('No strokes to save', 'warning');
      return;
    }
    showSaveConfirmDialog = true;
  }
  
  function handleCancelSave() {
    showSaveConfirmDialog = false;
  }
  
  async function handleTranscribe() {
    if (!$hasMyScriptCredentials) {
      log('Please configure MyScript API credentials in Settings', 'warning');
      return;
    }

    if (!hasStrokes) {
      log('No strokes available for transcription', 'warning');
      return;
    }

    // A date-range load puts only part of a page on the canvas, and MyScript
    // only ever sees what is loaded. The result is a real transcript of a
    // partial page — not wrong, but not the whole page either, and it merges
    // into the page's stored transcript alongside whatever was recognised
    // before. Worth saying out loud rather than discovering later.
    if ($contextInkPageKeys.size > 0) {
      const partial = new Set();
      strokesToTranscribe.forEach(stroke => {
        const pi = stroke.pageInfo || {};
        const key = `B${pi.book}/P${pi.page}`;
        if ($contextInkPageKeys.has(key)) partial.add(key);
      });
      if (partial.size > 0) {
        log(
          `${partial.size} page(s) are only partly loaded (date range) — `
          + 'transcription will cover the loaded strokes only',
          'warning'
        );
      }
    }

    setIsTranscribing(true);
    const transcribeLabel = $hasSelection ? 'selected' : 'all';

    // CRITICAL FIX: Filter strokes by page and handle Y-bounds overlap
    const strokesByPage = new Map();
    strokesToTranscribe.forEach(stroke => {
      const pageInfo = stroke.pageInfo || {};
      const pageKey = `S${pageInfo.section || 0}/O${pageInfo.owner || 0}/B${pageInfo.book || 0}/P${pageInfo.page || 0}`;

      if (!strokesByPage.has(pageKey)) {
        strokesByPage.set(pageKey, {
          allStrokes: [],          // All strokes (for Y-bounds calculation)
          untranscribedStrokes: [], // Only strokes without blockUuid (for MyScript)
          pageInfo: {
            section: pageInfo.section || 0,
            owner: pageInfo.owner || 0,
            book: pageInfo.book || 0,
            page: pageInfo.page || 0
          }
        });
      }

      const pageData = strokesByPage.get(pageKey);
      pageData.allStrokes.push(stroke);

      // Only add to untranscribed list if no blockUuid
      if (!stroke.blockUuid) {
        pageData.untranscribedStrokes.push(stroke);
      }
    });
    
    // Count pages that actually have untranscribed strokes
    const pagesWithNewStrokes = Array.from(strokesByPage.values()).filter(
      pageData => pageData.untranscribedStrokes.length > 0
    );
    const totalPages = pagesWithNewStrokes.length;

    if (totalPages === 0) {
      log('All selected strokes have already been transcribed', 'info');
      setIsTranscribing(false);
      return;
    }

    const totalUntranscribed = pagesWithNewStrokes.reduce(
      (sum, pageData) => sum + pageData.untranscribedStrokes.length,
      0
    );
    log(`Transcribing ${totalUntranscribed} untranscribed ${transcribeLabel} strokes from ${totalPages} page(s)...`, 'info');

    // Don't clear previous transcriptions - we're appending
    // clearTranscription();

    // Start progress tracking
    const startTime = Date.now();
    let progressInterval;

    transcriptionProgress.set({
      active: true,
      currentPage: 0,
      totalPages,
      currentBook: 0,
      currentPageNum: 0,
      successCount: 0,
      errorCount: 0,
      elapsedSeconds: 0
    });

    // Update elapsed time every second
    progressInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      transcriptionProgress.update(p => ({ ...p, elapsedSeconds: elapsed }));
    }, 1000);

    try {
      const { appKey, hmacKey } = getMyScriptCredentials();
      let successCount = 0;
      let errorCount = 0;
      let currentPageIndex = 0;

      // Transcribe each page separately
      for (const [pageKey, pageData] of strokesByPage) {
        // Skip pages with no untranscribed strokes
        if (pageData.untranscribedStrokes.length === 0) {
          log(`Skipping Book ${pageData.pageInfo.book}/Page ${pageData.pageInfo.page} - all strokes already transcribed`, 'info');
          continue;
        }

        currentPageIndex++;
        const { book, page } = pageData.pageInfo;

        // Update progress
        transcriptionProgress.update(p => ({
          ...p,
          currentPage: currentPageIndex,
          currentBook: book,
          currentPageNum: page
        }));

        try {
          log(`Transcribing ${pageData.untranscribedStrokes.length} new stroke(s) on Book ${book}, Page ${page}...`, 'info');

          // A page written with the notebook sideways is sent turned upright
          // (copies; the canvas keeps raw Ncode), or MyScript reads it as
          // vertical scribble. Its yBounds then come back in that upright frame,
          // so the turned copies are also what the batch origin is measured on,
          // and the rotation rides on the transcription for the save-time
          // stroke match (save-page.js strokesInTranscriptionFrame).
          const rotation = rotationFor($pageOrientations, book, page);
          const sentStrokes = rotateCanvasStrokes(pageData.untranscribedStrokes, rotation);

          // CRITICAL: Only send untranscribed strokes to MyScript
          const result = await transcribeStrokes(sentStrokes, appKey, hmacKey);

          // Store transcription for this page
          // CRITICAL: Pass the actual transcribed strokes so we can track which strokes get blockUuid
          setPageTranscription(
            pageKey,
            rotation ? { ...result, rotation } : result,
            pageData.pageInfo,
            pageData.allStrokes.length,  // Total stroke count includes both transcribed and untranscribed
            sentStrokes  // The strokes that were actually sent to MyScript (turned, if the page is)
          );

          log(`✓ Book ${book}/Page ${page}: ${result.text?.length || 0} characters, ${result.lines?.length || 0} lines`, 'success');
          successCount++;

          transcriptionProgress.update(p => ({ ...p, successCount }));
        } catch (error) {
          log(`✗ Failed to transcribe Book ${book}/Page ${page}: ${error.message}`, 'error');
          errorCount++;

          transcriptionProgress.update(p => ({ ...p, errorCount }));
        }
      }
      
      setActiveTab('transcription');
      
      if (successCount > 0) {
        log(`Transcription complete: ${successCount}/${totalPages} pages successful`, 'success');
      }
      if (errorCount > 0) {
        log(`${errorCount} page(s) failed to transcribe`, 'error');
      }
    } catch (error) {
      log(`Transcription failed: ${error.message}`, 'error');
    } finally {
      clearInterval(progressInterval);
      transcriptionProgress.set({
        active: false,
        currentPage: 0,
        totalPages: 0,
        currentBook: 0,
        currentPageNum: 0,
        successCount: 0,
        errorCount: 0,
        elapsedSeconds: 0
      });
      setIsTranscribing(false);
    }
  }

  
  async function handleSave(event) {
    // Function name retained for SaveConfirmDialog wiring; semantics now folder-only (v2.0).
    showSaveConfirmDialog = false;

    const selectedPageKeys = event?.detail?.selectedPages || [];
    if (selectedPageKeys.length === 0) {
      log('No pages selected for save', 'warning');
      return;
    }

    if (!$dataRoot || !$dataFolderReady) {
      log('No data folder configured. Pick one in Settings.', 'error');
      return;
    }

    const selectedSet = new Set(selectedPageKeys);

    isSaving = true;
    setStorageSaving(true);

    let savedStrokesCount = 0;
    let savedTranscriptionCount = 0;
    let errorCount = 0;

    try {
      // Group strokes by page (selection-filtered)
      const pagesToSave = new Map();
      $strokes.forEach((stroke) => {
        const pageInfo = stroke.pageInfo;
        if (!pageInfo || pageInfo.book === undefined || pageInfo.page === undefined) return;
        const key = `${pageInfo.book}-${pageInfo.page}`;
        if (!selectedSet.has(key)) return;
        if (!pagesToSave.has(key)) {
          pagesToSave.set(key, { book: pageInfo.book, page: pageInfo.page, strokes: [] });
        }
        pagesToSave.get(key).strokes.push(stroke);
      });

      /* Volume moves: a reassigned stroke is grouped above under its NEW page,
       * where it saves as an addition. The page it LEFT still holds it on disk
       * and needs a deletion — but it has no canvas strokes any more, so the
       * loop above never produced an entry for it. Add those source pages here.
       *
       * Force-included regardless of the dialog's selection: saving only the
       * target would leave the stroke in BOTH volumes, silently, which is worse
       * than the mis-filing the user is trying to fix. */
      const moveSources = new Map();
      $strokes.forEach((stroke) => {
        const from = stroke?.movedFrom;
        if (!from || from.book === undefined || from.page === undefined) return;
        const key = `${from.book}-${from.page}`;
        if (!moveSources.has(key)) {
          moveSources.set(key, { book: from.book, page: from.page, targets: new Map() });
        }
        // Record where the strokes went now, while the markers still exist — the
        // post-save cleanup needs it after clearMovedFromMarkers has run.
        const pi = stroke.pageInfo;
        if (pi) {
          moveSources.get(key).targets.set(`${pi.book}-${pi.page}`, { book: pi.book, page: pi.page });
        }
        if (!pagesToSave.has(key)) {
          pagesToSave.set(key, { book: from.book, page: from.page, strokes: [] });
        }
      });

      if (pagesToSave.size === 0) {
        log('No selected pages have strokes to save', 'warning');
        return;
      }

      log(`Saving ${pagesToSave.size} selected page(s) to data folder...`, 'info');

      // Completed moves, for the post-save transcript carry / ghost-file cleanup.
      const completedMoves = [];
      // Pages written, so the Library, search and Timeline can catch up.
      const writtenPages = [];

      // Save each page
      for (const [key, pageData] of pagesToSave) {
        const { book, page } = pageData;

        const activeStrokes = getActiveStrokesForPage(book, page);
        const movedAwayIds = getMovedAwayStrokeIdsForPage(book, page);
        // Old ids of strokes retimed on this page (lib/retime.js): the retimed
        // copy is appended under its new id, so the old one must go.
        const retimedAwayIds = getRetimedAwayStrokeIdsForPage(book, page);
        // Strokes whose old id is confirmed on disk, for the log line: the save
        // counts each as one addition plus one deletion.
        const retimedCount = $pendingChanges.get(`B${book}/P${page}`)?.retimes?.length || 0;
        // A page emptied by a move has no active strokes but still owes the
        // deletions, so "nothing to do" now means nothing to add AND nothing to
        // remove.
        if (activeStrokes.length === 0 && movedAwayIds.size === 0 &&
            getDeletedStrokeIdsForPage(book, page).size === 0) {
          log(`Skipping B${book}/P${page} (no active strokes)`, 'info');
          continue;
        }

        try {
          // "Remove this id from the stored page" is the same operation whether
          // the stroke was deleted or moved to another volume, so they union.
          const deletedIds = new Set([
            ...getDeletedStrokeIdsForPage(book, page),
            ...movedAwayIds,
            ...retimedAwayIds
          ]);

          // Retimes go into pages/_retimed.json BEFORE the page write, so a pen
          // import can't bring the old-time copy back. Moved-away strokes are
          // included in case their target page isn't saved now (recording is
          // idempotent). A failed write holds this page back (caught below).
          await recordRetimesFor([
            ...activeStrokes,
            ...$strokes.filter((s) => s.movedFrom && s.retimedFrom &&
              String(s.movedFrom.book) === String(book) && String(s.movedFrom.page) === String(page))
          ]);

          // Pull the page transcription (if MyScript ran on this page in this session)
          const pageInfo = activeStrokes[0]?.pageInfo || { section: 0, owner: 0, book, page };
          const pageKey = `S${pageInfo.section || 0}/O${pageInfo.owner || 0}/B${book}/P${page}`;
          const pageTranscription = $pageTranscriptions.get(pageKey) || null;

          // Single folder save: strokes + transcription merge in one atomic write
          const result = await savePageToFolder({
            book,
            page,
            activeStrokes,
            deletedStrokeIds: deletedIds,
            pageTranscription
          });

          if (result.success) {
            recordSuccessfulSave(`B${book}/P${page}`, result);
            writtenPages.push({ book, page });

            // The edited strokes' points are now on disk, so the intent markers
            // have done their job. Not gated on `result.edited`: a stroke that was
            // point-edited before its first save is written by the append branch,
            // which reports it as an addition, and its marker needs clearing too.
            clearPointEditMarkers(book, page);
            // The old ids are gone from disk; a marker left behind would make a
            // later save delete an id that may belong to another stroke by then.
            clearRetimedMarkers(book, page);

            // Same reasoning for move markers: the source page has now lost the
            // strokes on disk, so "still needs deleting here" would be a lie —
            // and a later unrelated save of this page would re-delete ids that
            // are no longer present.
            if (movedAwayIds.size > 0) {
              for (const target of (moveSources.get(key)?.targets.values() || [])) {
                completedMoves.push({
                  fromBook: book, fromPage: page,
                  toBook: target.book, toPage: target.page
                });
              }
              clearMovedFromMarkers(book, page);
            }

            const parts = [];
            const added = Math.max(0, result.added - retimedCount);
            const deleted = Math.max(0, result.deleted - retimedCount);
            if (added > 0) parts.push(`+${added} new`);
            if (retimedCount > 0) parts.push(`${retimedCount} retimed`);
            if (result.edited > 0) parts.push(`${result.edited} edited (points rewritten)`);
            if (movedAwayIds.size > 0) parts.push(`→${movedAwayIds.size} moved to another volume`);
            if (deleted > 0) parts.push(`-${deleted} deleted`);
            if (result.linesAdded > 0) parts.push(`+${result.linesAdded} transcript line(s)`);
            const changes = parts.length > 0 ? parts.join(', ') + ', ' : '';

            log(`Saved B${book}/P${page}: ${changes}${result.total} stroke(s) total`, 'success');
            savedStrokesCount++;
            if (pageTranscription && result.linesAdded > 0) savedTranscriptionCount++;
          } else {
            recordStorageError(result.error);
            log(`Failed to save B${book}/P${page}: ${result.error}`, 'error');
            errorCount++;
          }
        } catch (error) {
          recordStorageError(error.message);
          log(`Error saving page ${book}/${page}: ${error.message}`, 'error');
          errorCount++;
        }
      }
      
      /* Finish the moves. Runs AFTER every page save so both docs on disk are
       * final — it can't race the writes. Carries a transcript that would
       * otherwise be stranded on a page whose strokes have all left, and removes
       * the emptied source file so it doesn't linger as a 0-stroke ghost. */
      if (completedMoves.length > 0) {
        const tidy = await finalizePageMoves(completedMoves);
        if (tidy.transcriptsMoved > 0) {
          log(`Moved ${tidy.transcriptsMoved} transcript(s) to follow their strokes`, 'info');
        }
        if (tidy.pagesDeleted > 0) {
          log(`Removed ${tidy.pagesDeleted} emptied page file(s)`, 'info');
        }
        for (const err of tidy.errors) {
          log(`Move cleanup: ${err}`, 'warning');
        }
        // Page tags live in _tags.json, so a whole-page move carries them too.
        const tagsMoved = await carryTagsForMoves(tidy.emptied);
        if (tagsMoved > 0) log(`Moved the tags of ${tagsMoved} page(s) to follow their strokes`, 'info');
      }

      // Summary
      if (savedStrokesCount > 0) {
        const summary = savedTranscriptionCount > 0 
          ? `Saved ${savedStrokesCount} page(s) with strokes and transcription`
          : `Saved ${savedStrokesCount} page(s) with strokes`;
        log(summary, 'success');
        
        // Remove deleted strokes from the store after successful save
        const deletedStrokeIndices = Array.from($deletedIndices).sort((a, b) => b - a);
        if (deletedStrokeIndices.length > 0) {
          // First adjust selection to account for removal
          adjustSelectionAfterDeletion(deletedStrokeIndices);
          
          // Then remove the strokes
          removeStrokesByIndices(deletedStrokeIndices);
          
          log(`Removed ${deletedStrokeIndices.length} deleted stroke(s) from canvas`, 'info');
        }
        
        // Clear deleted indices after removal
        clearDeletedIndices();
      }
      if (errorCount > 0) {
        log(`Failed to save ${errorCount} page(s)`, 'error');
      }
      // The reading views hold their own copies (scan, page cache, thumbnails,
      // capture dates); refresh them in the background.
      if (writtenPages.length || completedMoves.length) {
        refreshAfterSave([...writtenPages, ...completedMoves.map((m) => ({ book: m.fromBook, page: m.fromPage }))]);
      }

      // Reconcile the unsaved-changes indicator after a clean save.
      // This MUST run after the deletion cleanup above: removeStrokesByIndices()
      // calls markUnsavedChanges(), which would otherwise re-latch the indicator
      // immediately after recordSuccessfulSave() cleared it — leaving the dot lit
      // with nothing left to save (Save then reports "nothing to save"). Only
      // clear when nothing failed, so genuinely unsaved work still warns.
      if (errorCount === 0 && savedStrokesCount > 0) {
        clearUnsavedChanges();
      }
    } finally {
      isSaving = false;
    }
  }
</script>

<!-- Save Confirmation Dialog -->
<SaveConfirmDialog 
  visible={showSaveConfirmDialog} 
  on:confirm={handleSave}
  on:cancel={handleCancelSave}
/>

<div class="action-bar" class:hidden={!visible}>
  <!-- Transcription Progress Popup -->
  {#if $transcriptionProgress.active}
    <div class="transcription-popup">
      <div class="transcription-header">
        <span>✍️ Transcribing Handwriting</span>
      </div>
      <div class="transcription-bar">
        <div 
          class="transcription-fill" 
          style="width: {($transcriptionProgress.currentPage / $transcriptionProgress.totalPages) * 100}%"
        ></div>
      </div>
      <div class="transcription-stats">
        <span>
          Page {$transcriptionProgress.currentPage}/{$transcriptionProgress.totalPages}
          {#if $transcriptionProgress.currentBook > 0}
            - Book {$transcriptionProgress.currentBook}, Page {$transcriptionProgress.currentPageNum}
          {/if}
        </span>
        <span>{$transcriptionProgress.elapsedSeconds}s</span>
      </div>
      {#if $transcriptionProgress.successCount > 0 || $transcriptionProgress.errorCount > 0}
        <div class="transcription-results">
          {#if $transcriptionProgress.successCount > 0}
            <span class="success-count">✓ {$transcriptionProgress.successCount}</span>
          {/if}
          {#if $transcriptionProgress.errorCount > 0}
            <span class="error-count">✗ {$transcriptionProgress.errorCount}</span>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
  
  <!-- Transfer Progress Popup -->
  {#if $transferProgress.active}
    <div class="transfer-popup">
      <div class="transfer-header">
        <span>📥 Importing Offline Data</span>
        {#if $transferProgress.canCancel}
          <button class="cancel-btn" on:click={cancelOfflineTransfer} title="Cancel transfer">✕</button>
        {/if}
      </div>
      <div class="transfer-bar">
        {#if $transferProgress.expectedStrokes > 0}
          <div class="transfer-fill" style="width: {$transferPercent}%"></div>
        {:else}
          <div class="transfer-fill indeterminate"></div>
        {/if}
      </div>
      <div class="transfer-stats">
        <span>
          {#if $transferProgress.currentBook > 0}
            Book {$transferProgress.currentBook}/{$transferProgress.totalBooks}
            {#if $transferProgress.expectedStrokes > 0}
              · {$transferProgress.currentBookStrokes}/{$transferProgress.expectedStrokes} strokes ({$transferPercent}%)
            {:else}
              · {$transferProgress.currentBookStrokes} strokes
            {/if}
          {:else}
            {$transferProgress.status === 'requesting' ? 'Requesting...' : 'Waiting...'}
          {/if}
        </span>
        <span>{$transferProgress.elapsedSeconds}s</span>
      </div>
    </div>
  {/if}

  <button
    class="action-btn save-btn"
    class:dirty={$unsavedChanges}
    on:click={handleShowSaveDialog}
    disabled={!hasSaveableData || isSaving || !$dataFolderReady}
    title={$unsavedChanges ? `You have unsaved changes — click to save (${saveWhat.toLowerCase()})` : `${saveWhat} to the data folder`}
    aria-label={saveWhat}
  >
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
      <polyline points="17 21 17 13 7 13 7 21"/>
      <polyline points="7 3 7 8 15 8"/>
    </svg>
    <span class="lbl">{saveButtonText}</span>
    {#if $unsavedChanges}
      <span class="dirty-dot" aria-label="unsaved changes"></span>
    {/if}
  </button>
  
  <button 
    class="action-btn delete-btn minor"
    on:click={handleDeleteSelected}
    disabled={!canDelete}
    title="Delete {$selectionCount} selected stroke(s) (can be undone)"
    aria-label="Delete selected strokes"
  >
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <polyline points="3 6 5 6 21 6"/>
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
      <line x1="10" y1="11" x2="10" y2="17"/>
      <line x1="14" y1="11" x2="14" y2="17"/>
    </svg>
    <span class="lbl">Delete</span>{#if $selectionCount}<span class="count">{$selectionCount}</span>{/if}
  </button>
  
  <button 
    class="action-btn undo-btn minor"
    on:click={handleUndo}
    disabled={!$canUndo}
    title="Undo last deletion"
    aria-label="Undo last deletion"
  >
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <path d="M3 7v6h6"/>
      <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>
    </svg>
    <span class="lbl">Undo</span>
  </button>
  
  <button 
    class="action-btn minor"
    on:click={handleClearCanvas}
    title="Clear all strokes from canvas"
    aria-label="Clear canvas"
  >
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <polyline points="3 6 5 6 21 6"/>
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
    </svg>
    <span class="lbl">Clear</span>
  </button>
  
  <div class="divider"></div>
  
  <button 
    class="action-btn transcribe-btn"
    class:all-transcribed={allTranscribed}
    on:click={handleTranscribe}
    disabled={!canTranscribe}
    title={transcribeTitle}
    aria-label="Transcribe"
  >
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
    </svg>
    <span class="lbl">
      {#if $isTranscribing}
        Transcribing…
      {:else if allTranscribed}
        Transcribed ✓
      {:else}
        Transcribe {selectedUntranscribedCount}/{transcribeCount}
      {/if}
    </span>
  </button>
  
</div>

<style>
  .action-bar {
    display: flex;
    gap: 5px;
    align-items: center;
    position: relative;
    flex-shrink: 0;
  }

  .action-bar.hidden {
    display: none;
  }

  .action-btn {
    display: flex;
    align-items: center;
    gap: 5px;
    height: 28px;
    padding: 0 10px;
    border: none;
    border-radius: 6px;
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
    background: var(--bg-secondary);
    color: var(--text-primary);
    border: 1px solid var(--border);
    white-space: nowrap;
  }

  .action-btn:hover:not(:disabled) {
    background: var(--bg-tertiary);
    border-color: var(--accent);
  }

  .action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .transcribe-btn {
    background: var(--accent);
    color: white;
    border-color: var(--accent);
  }

  .transcribe-btn:hover:not(:disabled) {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
  }
  
  .transcribe-btn.all-transcribed {
    background: var(--success);
    border-color: var(--success);
  }
  
  .transcribe-btn.all-transcribed:hover:not(:disabled) {
    background: #22c55e;
    border-color: #22c55e;
  }
  
  .save-btn {
    background: var(--ok-solid);
    color: white;
    border-color: var(--ok-solid);
  }
  
  .save-btn:hover:not(:disabled) {
    background: var(--ok-solid-hover);
    border-color: var(--ok-solid-hover);
  }

  .save-btn.dirty {
    animation: dirty-pulse 2.4s ease-in-out infinite;
  }

  .dirty-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #fde047;       /* amber */
    box-shadow: 0 0 6px rgba(253, 224, 71, 0.75);
    display: inline-block;
    margin-left: 4px;
    flex-shrink: 0;
  }

  @keyframes dirty-pulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba(253, 224, 71, 0); }
    50%      { box-shadow: 0 0 0 4px rgba(253, 224, 71, 0.25); }
  }
  
  /* Dark red is for destruction only; the bright accent stays the primary action. */
  .delete-btn {
    background: var(--destructive);
    color: white;
    border-color: var(--destructive);
  }
  
  .delete-btn:hover:not(:disabled) {
    background: var(--destructive-hover);
    border-color: var(--destructive-hover);
  }
  
  .undo-btn:hover:not(:disabled) {
    background: var(--accent);
    color: white;
    border-color: var(--accent);
  }

  .divider {
    width: 1px;
    height: 20px;
    background: var(--border);
    margin: 0 4px;
  }

  .action-btn svg {
    flex-shrink: 0;
  }

  /* Transcription Progress Popup */
  .transcription-popup {
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: 8px;
    background: var(--bg-secondary);
    border: 1px solid var(--accent);
    border-radius: 8px;
    padding: 12px 16px;
    min-width: 300px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    z-index: 100;
  }

  .transcription-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
    font-size: 0.9rem;
    font-weight: 500;
  }

  .transcription-bar {
    height: 8px;
    background: var(--bg-tertiary);
    border-radius: 4px;
    overflow: hidden;
    margin-bottom: 8px;
  }

  .transcription-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--accent), var(--accent-hover));
    border-radius: 4px;
    transition: width 0.3s ease;
  }

  .transcription-stats {
    display: flex;
    justify-content: space-between;
    font-size: 0.8rem;
    color: var(--text-secondary);
    margin-bottom: 6px;
  }

  .transcription-stats span:first-child {
    color: var(--accent);
  }
  
  .transcription-results {
    display: flex;
    gap: 12px;
    font-size: 0.8rem;
    padding-top: 6px;
    border-top: 1px solid var(--border);
  }
  
  .success-count {
    color: var(--success);
    font-weight: 600;
  }
  
  .error-count {
    color: var(--error);
    font-weight: 600;
  }

  /* Transfer Progress Popup */
  .transfer-popup {
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: 8px;
    background: var(--bg-secondary);
    border: 1px solid var(--accent);
    border-radius: 8px;
    padding: 12px 16px;
    min-width: 280px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    z-index: 100;
  }

  .transfer-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
    font-size: 0.9rem;
    font-weight: 500;
  }

  .cancel-btn {
    background: var(--error);
    color: white;
    border: none;
    border-radius: 4px;
    padding: 2px 8px;
    cursor: pointer;
    font-size: 0.85rem;
    transition: background 0.2s;
  }

  .cancel-btn:hover {
    background: #dc2626;
  }

  .transfer-bar {
    height: 8px;
    background: var(--bg-tertiary);
    border-radius: 4px;
    overflow: hidden;
    margin-bottom: 8px;
  }

  .transfer-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--success), #22c55e);
    border-radius: 4px;
    transition: width 0.3s ease;
  }

  .transfer-fill.indeterminate {
    width: 30% !important;
    animation: transfer-indeterminate 1.5s infinite ease-in-out;
  }

  @keyframes transfer-indeterminate {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(400%); }
  }

  .transfer-stats {
    display: flex;
    justify-content: space-between;
    font-size: 0.8rem;
    color: var(--text-secondary);
  }

  .transfer-stats span:first-child {
    color: var(--success);
  }
  
  .count {
    min-width: 16px;
    padding: 0 4px;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.22);
    font-size: 0.6875rem;
    line-height: 16px;
    text-align: center;
  }

  /* The header row is shared with navigation, search, Tasks and the pen chip:
     on a narrower window the minor buttons go icon-only first, then all. */
  @media (max-width: 1560px) {
    .action-btn.minor { padding: 0 8px; }
    .action-btn.minor .lbl { display: none; }
  }

  @media (max-width: 1280px) {
    .action-btn { padding: 0 8px; }
    .action-btn .lbl { display: none; }
  }
</style>
