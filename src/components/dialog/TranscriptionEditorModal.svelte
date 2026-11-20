<!--
  TranscriptionEditorModal.svelte - The Edit Transcription dialog: one column
  of editable lines (TranscriptEditorLine), its header, toolbar and footer
  (TranscriptEditorHeader / Toolbar / Footer) and, beside it, the page's
  handwriting (TranscriptStrokePreview). Existing lines are edited in place by
  id; Confirm hands the lines back to the caller and writes nothing itself.
  Ticked lines (else the focused line) move up / down / to the top or bottom as
  a group (lib/move-lines.js; Alt+↑ / Alt+↓), and are deleted (v3.20.0,
  lib/delete-lines.js; Ctrl+Shift+K, or Backspace on an empty line): a line
  with children asks Delete line or Delete block, a task asks first. A line
  left empty is deleted the same way at Confirm (only itself). While a
  deleted line had ink, the footer asks what happens to it (lib/deleted-ink.js),
  and Confirm hands that choice and the deleted lines to the caller.
-->
<script>
  import { debug } from '$lib/debug.js';
  import {
    mergeEditorLines, splitEditorLine, editorLineStatus, detectMergeSuggestions,
    deleteEditorLines, deletedLinesForSave, emptiedLines, startHistory, pushHistory, stepHistory
  } from '$lib/editor-lines.js';
  import { deletePrompt } from '$lib/delete-lines.js';
  import { INK_TEXTLESS, lineHasInk } from '$lib/deleted-ink.js';
  import { moveLines, moveLinesToEdge } from '$lib/move-lines.js';
  import { isTypingTarget } from '$lib/left-panel.js';
  import { createEventDispatcher } from 'svelte';
  import { reassignStrokes } from '$stores/strokes.js';
  import TranscriptStrokePreview from './TranscriptStrokePreview.svelte';
  import TranscriptEditorLine from './TranscriptEditorLine.svelte';
  import TranscriptEditorToolbar from './TranscriptEditorToolbar.svelte';
  import TranscriptEditorHeader from './TranscriptEditorHeader.svelte';
  import TranscriptEditorFooter from './TranscriptEditorFooter.svelte';
  import DeleteLinesPrompt from './DeleteLinesPrompt.svelte';

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
  /** The ink choice to start on (a reopened run keeps its earlier one). */
  export let deletedInk = INK_TEXTLESS;
  /** Lines with ink deleted when this run was confirmed before (the choice covers them too). */
  export let priorInkCount = 0;

  const dispatch = createEventDispatcher();

  // Local state for editing
  let editedLines = [];
  /** Lines removed by Delete, in the order deleted (part of the undo history). */
  let deleted = [];
  let selectedIndices = new Set();
  let history = startHistory({ lines: [], deleted: [] });
  /** What Delete is asking (DeleteLinesPrompt), or null. */
  let pendingDelete = null;
  let inkChoice = deletedInk;

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
  $: if (visible && lines) {
    initializeEditor();
  }

  function initializeEditor() {
    editedLines = lines.map((line, index) => ({
      ...line,
      id: `line-${index}`,
      originalIndex: index,
      userModified: false
    }));
    deleted = [];
    pendingDelete = null;
    inkChoice = deletedInk;
    selectedIndices = new Set();
    focusedIndex = -1;
    previewReloadKey++;
    history = startHistory({ lines: editedLines, deleted });
  }

  /**
   * Record the current lines for undo / redo. A call that changed nothing
   * (leaving a line without typing) adds no step, so one Undo is one change.
   */
  function addToHistory() {
    history = pushHistory(history, { lines: editedLines, deleted });
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

    // A sketch row (v3.24.0) is never merged with text.
    if (indices.some(i => editedLines[i]?.kind)) return;
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
    if (editedLines[index]?.kind) return;   // a sketch's label is not split (v3.24.0)
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

  /**
   * Delete the ticked lines, else `index` (the focused line when not given).
   * Asks first when deletePrompt says so (a line with children, a task).
   */
  function requestDelete(index = null) {
    const ticked = index == null && selectedIndices.size > 0;
    const at = index ?? focusedIndex;
    const indices = ticked ? [...selectedIndices] : at >= 0 && at < editedLines.length ? [at] : [];
    if (indices.length === 0) return;
    const ask = deletePrompt(editedLines, indices, { ticked });
    if (ask) pendingDelete = ask;
    else applyDelete(indices, false);
  }

  function applyDelete(indices, block) {
    const r = deleteEditorLines(editedLines, indices, { block });
    editedLines = r.lines;
    deleted = [...deleted, ...r.removed];
    pendingDelete = null;
    selectedIndices = new Set();
    focusedIndex = -1;   // indices shifted
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
  function step(delta) {
    const r = stepHistory(history, delta);
    if (!r) return;
    history = r.history;
    editedLines = r.state.lines;
    deleted = r.state.deleted;
    selectedIndices = new Set();
    focusedIndex = -1;
  }
  const undo = () => step(-1);
  const redo = () => step(1);

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

  // Confirm: an emptied line is a Delete (v3.20.0): a task asks first, and its
  // ink follows the footer's choice. A line with children loses only itself.
  function handleSave() {
    const { indices, named } = emptiedLines(editedLines, lines);
    if (indices.length) {
      const ask = deletePrompt(named, indices, { ticked: true });
      if (ask) { pendingDelete = { ...ask, thenSave: true }; return; }
      applyDelete(indices, false);
    }
    finishSave();
  }

  // Hand the lines back and close (writes nothing to disk).
  function finishSave() {
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

    // Deleted lines and the ink choice; the caller's save settles their strokes.
    dispatch('save', {
      lines: editedLines, book, page, mergedBlockPairs,
      ...deletedLinesForSave(deleted), deletedInk: inkChoice
    });
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
    if (history.at > 0 && !confirm('Discard your edits to this transcription?')) return;
    handleClose();
  }

  // Handle keyboard shortcuts
  function handleKeydown(event) {
    if (!visible || event.defaultPrevented || pendingDelete) return;
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
      } else if (key === 'k' && event.shiftKey) {
        event.preventDefault();
        requestDelete();
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
  // Emptied lines are deleted at Confirm, so the choice covers them already.
  $: inkCount = priorInkCount + deleted.filter(lineHasInk).length
    + editedLines.filter((l) => (l.text || '').trim() === '' && lineHasInk(l)).length;

  $: mergeSuggestions = detectMergeSuggestions(editedLines);
</script>

<svelte:window on:keydown={handleKeydown} />

{#if visible}
<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
<div class="modal-backdrop" on:click={requestClose}>
  <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-noninteractive-element-interactions -->
  <div class="modal-container" role="dialog" aria-modal="true" aria-label="Edit transcription" on:click|stopPropagation>
    <TranscriptEditorHeader {book} {page} {stats} {showPreview} onTogglePreview={togglePreview} onClose={handleClose} />

    <TranscriptEditorToolbar
      canUndo={history.at > 0}
      canRedo={history.at < history.steps.length - 1}
      selectedCount={selectedIndices.size}
      {canMove}
      suggestionCount={mergeSuggestions.length}
      on:undo={undo}
      on:redo={redo}
      on:selectAll={selectAll}
      on:merge={() => mergeLines(Array.from(selectedIndices)[0])}
      on:delete={() => requestDelete()}
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
            nextIsKind={!!editedLines[index + 1]?.kind}
            sketch={line.kind && line.blockUuid ? { book, pageId: previewPageId, lineId: line.blockUuid } : null}
            on:focus={() => (focusedIndex = index)}
            on:toggle={() => toggleSelection(index)}
            on:input={(e) => handleLineInput(index, e.detail)}
            on:commit={addToHistory}
            on:merge={() => mergeLines(index)}
            on:split={(e) => splitLine(index, e.detail.text1, e.detail.text2)}
            on:outdent={() => shiftIndent(new Set([index]), -1)}
            on:indent={() => shiftIndent(new Set([index]), 1)}
            on:delete={() => requestDelete(index)}
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

    <TranscriptEditorFooter {book} pageId={previewPageId} lines={editedLines} {stats} {inkCount}
      bind:deletedInk={inkChoice} onCancel={handleClose} onConfirm={handleSave} />
  </div>
</div>
{#if pendingDelete}
  <DeleteLinesPrompt prompt={pendingDelete}
    onChoose={(block) => { const then = pendingDelete.thenSave; applyDelete(pendingDelete.indices, block); if (then) finishSave(); }}
    onCancel={() => (pendingDelete = null)} />
{/if}
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
