<!--
  TranscriptionEditorModal.svelte - The Edit Transcription dialog: one column
  of editable lines (TranscriptEditorLine), its toolbar
  (TranscriptEditorToolbar) and, beside it, the page's handwriting
  (TranscriptStrokePreview). Existing lines are edited in place by id; Confirm
  hands the lines back to the caller and writes nothing itself. Ticked lines
  (else the focused line) move up / down / to the top or bottom as a group
  (lib/move-lines.js; Alt+↑ / Alt+↓).
-->
<script>
  import { debug } from '$lib/debug.js';
  import {
    mergeEditorLines, splitEditorLine, editorLineStatus, detectMergeSuggestions
  } from '$lib/editor-lines.js';
  import { moveLines, moveLinesToEdge } from '$lib/move-lines.js';
  import { isTypingTarget } from '$lib/left-panel.js';
  import { createEventDispatcher } from 'svelte';
  import { reassignStrokes } from '$stores/strokes.js';
  import TranscriptStrokePreview from './TranscriptStrokePreview.svelte';
  import TranscriptEditorLine from './TranscriptEditorLine.svelte';
  import TranscriptEditorToolbar from './TranscriptEditorToolbar.svelte';
  import PageTagsInline from '../tags/PageTagsInline.svelte';

  export let book;
  export let page;
  /**
   * Unique-within-book page id including any letter suffix (e.g. "151b").
   * Only the stroke preview needs it — it is the read key for the PageDoc when
   * the page isn't on the canvas. Defaults to `page` for callers that have no
   * suffix to give.
   */
  export let pageId = null;
  export let lines = []; // Array of line objects (merged: existing + new MyScript)
  /**
   * Ncode anchor for the incoming MyScript batch, when this modal is confirming
   * one. Passed straight to the preview; only lines flagged `fromBatch` use it.
   */
  export let batchOriginY = null;
  export let visible = false;

  const dispatch = createEventDispatcher();

  // Local state for editing
  let editedLines = [];
  let selectedIndices = new Set();
  let history = [];
  let historyIndex = -1;

  // Which line the stroke preview is showing. Set by clicking or focusing a row;
  // never by editing, so typing doesn't make the preview jump.
  let focusedIndex = -1;
  let showPreview = loadPreviewPref();
  let previewReloadKey = 0;

  $: previewPageId = pageId != null ? pageId : page;
  $: highlightLine = focusedIndex >= 0 && focusedIndex < editedLines.length
    ? editedLines[focusedIndex]
    : null;

  const PREVIEW_PREF_KEY = 'transcriptEditor.showStrokePreview';

  function loadPreviewPref() {
    try {
      return localStorage.getItem(PREVIEW_PREF_KEY) !== 'false';
    } catch {
      return true;
    }
  }

  function togglePreview() {
    showPreview = !showPreview;
    try {
      localStorage.setItem(PREVIEW_PREF_KEY, String(showPreview));
    } catch {
      /* preference only — a storage failure must not break the editor */
    }
  }

  // Initialize edited lines when modal opens
  $: if (visible && lines.length > 0) {
    initializeEditor();
  }

  function initializeEditor() {
    editedLines = lines.map((line, index) => ({
      ...line,
      id: `line-${index}`,
      originalIndex: index,
      userModified: false
    }));
    selectedIndices = new Set();
    focusedIndex = -1;
    previewReloadKey++;
    history = [JSON.parse(JSON.stringify(editedLines))];
    historyIndex = 0;
  }

  /**
   * Record the current lines for undo / redo. A call that changed nothing
   * (leaving a line without typing) adds no step, so one Undo is one change.
   */
  function addToHistory() {
    const snapshot = JSON.stringify(editedLines);
    if (historyIndex >= 0 && JSON.stringify(history[historyIndex]) === snapshot) return;
    history = history.slice(0, historyIndex + 1);
    history.push(JSON.parse(snapshot));
    historyIndex++;
  }

  // Merge the ticked lines (two or more), else `startIndex` with the next line.
  function mergeLines(startIndex) {
    if (editedLines.length < 2) return;

    let indices;
    if (selectedIndices.size >= 2) {
      indices = Array.from(selectedIndices).sort((a, b) => a - b);
    } else {
      if (startIndex >= editedLines.length - 1) return;
      indices = [startIndex, startIndex + 1];
    }

    const mergedLine = mergeEditorLines(indices.map(i => editedLines[i]));
    const drop = new Set(indices.slice(1));
    editedLines = editedLines.flatMap((line, index) =>
      index === indices[0] ? [mergedLine] : drop.has(index) ? [] : [line]);
    selectedIndices = new Set();
    focusedIndex = -1;   // indices shifted — a stale focus would point elsewhere
    addToHistory();
  }

  // Split a line at cursor position
  function splitLine(index, splitText1, splitText2) {
    const [line1, line2] = splitEditorLine(editedLines[index], splitText1, splitText2);
    editedLines = [
      ...editedLines.slice(0, index),
      line1,
      line2,
      ...editedLines.slice(index + 1)
    ];
    focusedIndex = -1;   // a line was inserted — later indices shifted
    addToHistory();
  }

  /** Change the indent of the lines at `indices` by `delta`, within 0..5. */
  function shiftIndent(indices, delta) {
    if (indices.size === 0) return;
    editedLines = editedLines.map((line, index) => indices.has(index)
      ? { ...line, indentLevel: Math.min(Math.max((line.indentLevel || 0) + delta, 0), 5), userModified: true }
      : line);
    addToHistory();
  }

  const indentLines = () => shiftIndent(selectedIndices, 1);
  const outdentLines = () => shiftIndent(selectedIndices, -1);

  // Move the ticked lines (else the focused one) a step (-1 / 1) or to an edge ('top' / 'bottom').
  function moveSelected(how) {
    const sel = selectedIndices.size ? [...selectedIndices] : focusedIndex >= 0 ? [focusedIndex] : [];
    const r = typeof how === 'number' ? moveLines(editedLines, sel, how) : moveLinesToEdge(editedLines, sel, how);
    if (!r) return;
    const movedSet = new Set(r.selected);
    editedLines = r.lines.map((l, i) => (movedSet.has(i) ? { ...l, userModified: true } : l));
    if (selectedIndices.size) selectedIndices = new Set(r.selected);
    else focusedIndex = r.selected[0];
    addToHistory();
  }
  $: canMove = selectedIndices.size > 0 || focusedIndex >= 0;

  /** Step through the undo history (-1 undo, +1 redo). */
  function stepHistory(delta) {
    const next = historyIndex + delta;
    if (next < 0 || next >= history.length) return;
    historyIndex = next;
    editedLines = JSON.parse(JSON.stringify(history[historyIndex]));
    selectedIndices = new Set();
    focusedIndex = -1;
  }
  const undo = () => stepHistory(-1);
  const redo = () => stepHistory(1);

  function toggleSelection(index) {
    if (selectedIndices.has(index)) selectedIndices.delete(index);
    else selectedIndices.add(index);
    selectedIndices = selectedIndices;
  }

  function selectAll() {
    selectedIndices = new Set(editedLines.map((_, i) => i));
  }

  // Merge the first suggested pair (detectMergeSuggestions).
  function applySmartMerge() {
    const [first] = mergeSuggestions;
    if (!first) return;
    selectedIndices = new Set(first.indices);
    mergeLines(first.indices[0]);
  }

  function handleLineInput(index, newText) {
    editedLines[index].text = newText;
    editedLines[index].canonical = newText.trim();
    editedLines[index].userModified = true;
    // An existing line being edited is marked as modified
    if (editedLines[index].blockUuid && editedLines[index].syncStatus === 'synced') {
      editedLines[index].syncStatus = 'modified';
    }
    editedLines = editedLines;
  }

  // Hand the lines back and close (writes nothing to disk).
  function handleSave() {
    // A merge points the merged-away lines' strokes at the survivor.
    const mergedBlockPairs = [];
    for (const line of editedLines) {
      if (line.blocksToDelete && line.blocksToDelete.length > 0 && line.blockUuid) {
        debug(`Processing merge: ${line.blocksToDelete.length} lines merged into ${line.blockUuid}`);
        for (const deletedBlockUuid of line.blocksToDelete) {
          if (deletedBlockUuid !== line.blockUuid) {
            mergedBlockPairs.push({ deletedBlockUuid, survivingBlockUuid: line.blockUuid });
          }
        }
      } else if (line.sourceLines && line.sourceLines.length > 1 && line.blockUuid) {
        for (let i = 1; i < line.sourceLines.length; i++) {
          const originalLine = lines[line.sourceLines[i]];
          if (originalLine && originalLine.blockUuid && originalLine.blockUuid !== line.blockUuid) {
            mergedBlockPairs.push({ deletedBlockUuid: originalLine.blockUuid, survivingBlockUuid: line.blockUuid });
          }
        }
      }
    }

    // Reassign strokes from merged-away lines to the survivors (in memory only)
    for (const { deletedBlockUuid, survivingBlockUuid } of mergedBlockPairs) {
      const count = reassignStrokes(deletedBlockUuid, survivingBlockUuid);
      if (count > 0) debug(`Reassigned ${count} strokes from ${deletedBlockUuid} to ${survivingBlockUuid}`);
    }

    dispatch('save', { lines: editedLines, book, page, mergedBlockPairs });
    handleClose();
  }

  // Close modal without saving
  function handleClose() {
    visible = false;
    dispatch('close');
  }

  // A stray backdrop click or Escape asks first once there are edits to lose;
  // Cancel is an explicit choice and closes at once.
  function requestClose() {
    if (historyIndex > 0 && !confirm('Discard your edits to this transcription?')) return;
    handleClose();
  }

  // Handle keyboard shortcuts
  function handleKeydown(event) {
    if (!visible || event.defaultPrevented) return;
    // The page-tags field (footer) keeps its own Tab, Ctrl+A / Z and Escape.
    if (event.target?.closest?.('[data-own-keys]')) return;
    // In a line's text field, select-all and undo/redo are the field's own.
    if (isTypingTarget(event.target) && (event.ctrlKey || event.metaKey) && ['a', 'z', 'y'].includes(event.key.toLowerCase())) return;

    if (event.ctrlKey || event.metaKey) {
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventDefault();
        redo();
      } else if (key === 'a') {
        event.preventDefault();
        selectAll();
      } else if (key === 'j') {
        event.preventDefault();
        if (selectedIndices.size >= 2) mergeLines(Array.from(selectedIndices)[0]);
      } else if (event.key === ']') {
        event.preventDefault();
        indentLines();
      } else if (event.key === '[') {
        event.preventDefault();
        outdentLines();
      }
    } else if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      moveSelected(event.key === 'ArrowUp' ? -1 : 1);
    } else if (event.key === 'Tab') {
      event.preventDefault();
      if (event.shiftKey) outdentLines();
      else indentLines();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      requestClose();
    }
  }

  // Counts derived from the same labels the rows show, so they can't disagree.
  $: statusLabels = editedLines.map(editorLineStatus);
  $: stats = {
    totalLines: editedLines.length,
    selected: selectedIndices.size,
    modified: statusLabels.filter(l => l === 'modified').length,
    synced: statusLabels.filter(l => l === 'synced').length,
    newLines: statusLabels.filter(l => l === 'new').length
  };

  $: mergeSuggestions = detectMergeSuggestions(editedLines);
</script>

<svelte:window on:keydown={handleKeydown} />

{#if visible}
<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
<div class="modal-backdrop" on:click={requestClose}>
  <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-noninteractive-element-interactions -->
  <div class="modal-container" role="dialog" aria-modal="true" aria-label="Edit transcription" on:click|stopPropagation>
    <div class="modal-header">
      <h2>Edit Transcription &mdash; B{book}/P{page}</h2>
      <div class="header-stats">
        {stats.totalLines} {stats.totalLines === 1 ? 'line' : 'lines'}
        {#if stats.synced > 0}<span class="stat-badge synced">{stats.synced} saved</span>{/if}
        {#if stats.newLines > 0}<span class="stat-badge new">{stats.newLines} new</span>{/if}
        {#if stats.modified > 0}<span class="stat-badge modified">{stats.modified} modified</span>{/if}
      </div>
      <button
        class="preview-toggle"
        class:active={showPreview}
        on:click={togglePreview}
        aria-pressed={showPreview}
        title={showPreview ? 'Hide the stroke preview' : 'Show the handwriting alongside the transcript'}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 17c3-6 6-9 9-9s4 3 3 6-3 4-4 2 1-6 4-8 4-1 6 1"/>
        </svg>
        {showPreview ? 'Hide strokes' : 'Show strokes'}
      </button>
      <button class="close-btn" on:click={handleClose} title="Close (Esc)" aria-label="Close">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>

    <TranscriptEditorToolbar
      canUndo={historyIndex > 0}
      canRedo={historyIndex < history.length - 1}
      selectedCount={selectedIndices.size}
      {canMove}
      suggestionCount={mergeSuggestions.length}
      on:undo={undo}
      on:redo={redo}
      on:selectAll={selectAll}
      on:merge={() => mergeLines(Array.from(selectedIndices)[0])}
      on:outdent={outdentLines}
      on:indent={indentLines}
      on:move={(e) => moveSelected(e.detail)}
      on:smartMerge={applySmartMerge}
    />

    <div class="modal-body" class:with-preview={showPreview}>
      <div class="lines-list">
        {#each editedLines as line, index}
          <TranscriptEditorLine
            {line}
            selected={selectedIndices.has(index)}
            focused={focusedIndex === index}
            isLast={index >= editedLines.length - 1}
            on:focus={() => (focusedIndex = index)}
            on:toggle={() => toggleSelection(index)}
            on:input={(e) => handleLineInput(index, e.detail)}
            on:commit={addToHistory}
            on:merge={() => mergeLines(index)}
            on:split={(e) => splitLine(index, e.detail.text1, e.detail.text2)}
            on:outdent={() => shiftIndent(new Set([index]), -1)}
            on:indent={() => shiftIndent(new Set([index]), 1)}
          />
        {/each}
      </div>

      {#if showPreview}
        <TranscriptStrokePreview
          {book}
          pageId={previewPageId}
          {highlightLine}
          {batchOriginY}
          reloadKey={previewReloadKey}
        />
      {/if}
    </div>

    <div class="modal-footer">
      <div class="footer-tags">
        <PageTagsInline {book} pageId={previewPageId} lines={editedLines} dropUp />
      </div>
      <div class="footer-info">
        {#if stats.selected > 0}
          <span class="selection-info">{stats.selected} selected</span>
        {/if}
        {#if stats.modified > 0}
          <span class="modified-warning">{stats.modified} line{stats.modified !== 1 ? 's' : ''} modified</span>
        {/if}
      </div>
      <div class="footer-actions">
        <button class="btn btn-cancel" on:click={handleClose}>Cancel</button>
        <button class="btn btn-primary" on:click={handleSave}>Confirm</button>
      </div>
    </div>
  </div>
</div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
    backdrop-filter: blur(2px);
  }

  .modal-container {
    background: var(--bg-primary);
    border-radius: 12px;
    width: 92vw;
    max-width: 1440px;
    height: 88vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
    border: 1px solid var(--border);
  }

  /* Header */
  .modal-header {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 16px 24px;
    border-bottom: 1px solid var(--border);
  }

  .modal-header h2 {
    margin: 0;
    font-size: 1.15rem;
    color: var(--text-primary);
    white-space: nowrap;
  }

  .header-stats {
    display: flex;
    gap: 8px;
    align-items: center;
    font-size: 0.8rem;
    color: var(--text-secondary);
    flex: 1;
  }

  .stat-badge {
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 0.7rem;
    font-weight: 600;
  }

  .stat-badge.synced { background: rgba(107, 114, 128, 0.2); color: #9ca3af; }
  .stat-badge.new { background: rgba(59, 130, 246, 0.15); color: #60a5fa; }
  .stat-badge.modified { background: rgba(245, 158, 11, 0.15); color: #fbbf24; }

  .preview-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    border: 1px solid var(--border);
    border-radius: 6px;
    font-size: 0.75rem;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .preview-toggle:hover {
    color: var(--text-primary);
    border-color: var(--accent);
  }

  .preview-toggle.active {
    color: var(--text-primary);
    border-color: var(--accent);
    background: rgba(59, 130, 246, 0.12);
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    transition: all 0.2s;
    flex-shrink: 0;
  }

  .close-btn:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  /* Body — transcript column, optionally beside the stroke preview */
  .modal-body {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: row;
    min-height: 0;
  }

  .modal-body.with-preview :global(.preview) {
    flex: 0 0 42%;
    max-width: 620px;
  }

  .lines-list {
    flex: 1 1 auto;
    min-width: 0;
    overflow-y: auto;
    padding: 12px 16px;
  }

  /* Footer */
  .modal-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 24px;
    background: var(--bg-secondary);
    border-top: 1px solid var(--border);
  }

  .footer-tags {
    flex: 1;
    min-width: 0;
    margin-right: 20px;
  }

  .footer-info {
    display: flex;
    gap: 16px;
    font-size: 0.8rem;
  }

  .selection-info {
    color: var(--accent);
    font-weight: 500;
  }

  .modified-warning {
    color: #f59e0b;
    font-weight: 500;
  }

  .footer-actions {
    display: flex;
    gap: 10px;
  }

  .btn {
    padding: 8px 20px;
    border: none;
    border-radius: 6px;
    font-size: 0.85rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }

  .btn-cancel {
    background: var(--bg-tertiary);
    color: var(--text-primary);
    border: 1px solid var(--border);
  }

  .btn-cancel:hover {
    background: var(--bg-primary);
  }

  .btn-primary {
    background: var(--accent);
    color: white;
  }

  .btn-primary:hover {
    opacity: 0.9;
  }

  /* Scrollbar */
  .lines-list::-webkit-scrollbar {
    width: 8px;
  }

  .lines-list::-webkit-scrollbar-track {
    background: var(--bg-tertiary);
    border-radius: 4px;
  }

  .lines-list::-webkit-scrollbar-thumb {
    background: var(--border);
    border-radius: 4px;
  }

  .lines-list::-webkit-scrollbar-thumb:hover {
    background: var(--accent);
  }
</style>
