<!--
  ActionBar.svelte - The capture controls: Save, Delete, Undo, Clear, Transcribe.

  Mounted in the header. In the Editor (v3.14.0) its row is drawn in the Editor
  pane's title row instead (stores/editor-actions.js `placeIn`), so the header
  keeps one width in every view. Elsewhere it shows only when there is capture
  work (lib/capture-bar.js), and then only Save: Delete, Undo, Clear and
  Transcribe act on the canvas, which is the Editor's.

  Always mounted (it owns the save dialog and the progress popups); `visible`
  only decides whether the buttons are drawn. Header computes it with
  lib/capture-bar.js. The save itself is stores/canvas-save.js, the
  transcription stores/canvas-transcribe.js, the popups CaptureProgress.svelte.
  Connect, Disconnect and Fetch Notes are in the pen chip's menu (PenChip.svelte).
-->
<script>
  import {
    log,
    clearStrokes,
    strokeCount,
    hasSelection,
    selectionCount,
    selectedStrokes,
    selectedIndices,
    clearSelection,
    strokes,
    hasMyScriptCredentials,
    isTranscribing,
    clearTranscription,
    hasPageTranscriptions,
    canUndo,
    markStrokesDeleted,
    undoLastDeletion,
    clearDeletedIndices,
    hasPendingChanges,
    viewerMode,
    unsavedChanges
  } from '$stores';
  import { getUntranscribedStrokes } from '$stores/strokes.js';
  import { clearContextInk } from '$stores/context-ink.js';
  import { forgetAllResets } from '$stores/transcript-reset.js';
  import { pointEditMode, exitPointEditMode } from '$stores/point-edit.js';
  import { filteredStrokes } from '$stores/filtered-strokes.js';
  import { dataRoot, dataFolderReady } from '$stores/settings.js';
  import { clearUnsavedChanges } from '$stores/storage.js';
  import { editorActionsSlot, placeIn } from '$stores/editor-actions.js';
  import { saveCanvasPages } from '$stores/canvas-save.js';
  import { transcribeCanvas } from '$stores/canvas-transcribe.js';
  import { plural } from '$lib/plural.js';
  import SaveConfirmDialog from '$components/dialog/SaveConfirmDialog.svelte';
  import CaptureProgress from './CaptureProgress.svelte';

  /** Whether the bar's row is drawn. The dialog and popups' logic run regardless. */
  export let visible = true;

  // In the Editor the row lives in the Editor pane; elsewhere it is Save only.
  $: inPane = $viewerMode === 'editor' && !!$editorActionsSlot;

  let isSaving = false;
  let showSaveConfirmDialog = false;

  $: hasStrokes = $strokeCount > 0;
  $: saveWhat = $hasPendingChanges ? 'Save changes'
    : $hasPageTranscriptions ? 'Save strokes and transcription'
    : 'Save strokes';
  $: saveTitle = !$dataFolderReady ? 'Pick a data folder in Settings to save'
    : !hasStrokes ? 'Nothing on the canvas to save'
    : $unsavedChanges ? `You have unsaved changes — click to save (${saveWhat.toLowerCase()})`
    : `${saveWhat} to the data folder`;

  // Transcribe acts on the selection, else the whole canvas.
  $: strokesToTranscribe = $hasSelection ? $selectedStrokes : $strokes;
  $: transcribeCount = $hasSelection ? $selectionCount : $strokeCount;
  $: canTranscribe = $hasMyScriptCredentials && hasStrokes && !$isTranscribing;
  $: untranscribedCount = getUntranscribedStrokes($strokes).length;
  $: allTranscribed = hasStrokes && untranscribedCount === 0;
  $: selectedUntranscribedCount = $hasSelection ? getUntranscribedStrokes($selectedStrokes).length : untranscribedCount;
  $: transcribeTitle = !$hasMyScriptCredentials ? 'Add MyScript credentials in Settings to transcribe'
    : !hasStrokes ? 'Nothing on the canvas to transcribe'
    : allTranscribed ? 'All strokes already transcribed'
    : `Transcribe ${selectedUntranscribedCount} untranscribed ${plural(selectedUntranscribedCount, 'stroke')}`
      + (untranscribedCount !== $strokeCount
        ? ` (${$strokeCount - untranscribedCount}/${$strokeCount} already transcribed)` : '');

  function handleClearCanvas() {
    if (($unsavedChanges || $hasPendingChanges) && !confirm('The canvas has unsaved changes. Clear it anyway and lose them?')) return;
    clearStrokes();
    // Every store that holds positions into the strokes array, now empty: a
    // stale index would select (or delete) whatever lands there next.
    clearSelection();
    clearDeletedIndices();
    if ($pointEditMode) exitPointEditMode();
    if ($filteredStrokes.length > 0) filteredStrokes.set([]);
    // Context ink is drawn for pages on the canvas; with the canvas empty it
    // would be the only thing left, which the user can do nothing with.
    clearContextInk();
    // Pending transcriptions and resets belong to pages no longer loaded: they
    // can't be saved, and would list phantom pages in Transcripts → Review
    // (as unloading a page does, stores/canvas.js).
    clearTranscription();
    forgetAllResets();
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
    log(`Marked ${indices.length} ${plural(indices.length, 'stroke')} for deletion`, 'info');
  }

  function handleUndo() {
    if (undoLastDeletion()) log('Undid last deletion', 'info');
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

  function handleTranscribe() {
    transcribeCanvas(strokesToTranscribe, { selection: $hasSelection });
  }

  async function handleSave(event) {
    showSaveConfirmDialog = false;
    isSaving = true;
    try {
      await saveCanvasPages(event?.detail?.selectedPages || [], { leftUnsaved: event?.detail?.leftUnsaved || [] });
    } catch (error) {
      log(`Save failed: ${error.message}`, 'error');
    } finally {
      isSaving = false;
    }
  }
</script>

<SaveConfirmDialog
  visible={showSaveConfirmDialog}
  on:confirm={handleSave}
  on:cancel={() => (showSaveConfirmDialog = false)}
/>

<div class="action-bar" class:hidden={!visible} class:in-pane={inPane} class:save-only={!inPane} use:placeIn={inPane ? $editorActionsSlot : null}>
  <CaptureProgress />

  <button
    class="action-btn save-btn"
    class:dirty={$unsavedChanges}
    on:click={handleShowSaveDialog}
    disabled={!hasStrokes || isSaving || !$dataFolderReady}
    title={saveTitle}
    aria-label={saveWhat}
  >
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
      <polyline points="17 21 17 13 7 13 7 21"/>
      <polyline points="7 3 7 8 15 8"/>
    </svg>
    <span class="lbl">{isSaving ? 'Saving…' : 'Save'}</span>
    {#if $unsavedChanges}
      <span class="dirty-dot" aria-hidden="true"></span>
    {/if}
  </button>

  <button
    class="action-btn delete-btn minor"
    on:click={handleDeleteSelected}
    disabled={!$hasSelection}
    title={$hasSelection
      ? `Delete ${$selectionCount} selected ${plural($selectionCount, 'stroke')} (can be undone until you save)`
      : 'Select strokes to delete them'}
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
    class="action-btn clear-btn minor"
    on:click={handleClearCanvas}
    disabled={!hasStrokes}
    title="Clear all strokes from the canvas (saved pages are untouched)"
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

  /* Outside the Editor only Save shows (and the progress popups). */
  .action-bar.save-only .action-btn:not(.save-btn),
  .action-bar.save-only .divider {
    display: none;
  }

  /* In the Editor pane: Undo, Clear, Delete, then Transcribe, Save last (v3.14.0). */
  .action-bar.in-pane .undo-btn { order: 1; }
  .action-bar.in-pane .clear-btn { order: 2; }
  .action-bar.in-pane .delete-btn { order: 3; }
  .action-bar.in-pane .divider { order: 4; }
  .action-bar.in-pane .transcribe-btn { order: 5; }
  .action-bar.in-pane .save-btn { order: 6; }

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
