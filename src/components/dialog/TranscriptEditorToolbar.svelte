<!--
  TranscriptEditorToolbar.svelte - The Edit Transcription dialog's toolbar
  (TranscriptionEditorModal): undo / redo, select and merge, indent, move
  (lib/move-lines.js) and Smart merge. Buttons only; each dispatches an event
  named after its action, and the dialog's keyboard shortcuts do the same.
-->
<script>
  import { createEventDispatcher } from 'svelte';

  export let canUndo = false;
  export let canRedo = false;
  export let selectedCount = 0;
  /** Ticked lines, else a focused line, to move. */
  export let canMove = false;
  export let suggestionCount = 0;

  const dispatch = createEventDispatcher();
</script>

<div class="modal-toolbar">
  <div class="toolbar-group">
    <button class="tool-btn" on:click={() => dispatch('undo')} disabled={!canUndo} title="Undo (Ctrl+Z)">&#8630; Undo</button>
    <button class="tool-btn" on:click={() => dispatch('redo')} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">&#8631; Redo</button>
  </div>

  <div class="toolbar-group">
    <button class="tool-btn" on:click={() => dispatch('selectAll')} title="Select all lines (Ctrl+A)">Select all</button>
    <button class="tool-btn primary" on:click={() => dispatch('merge')} disabled={selectedCount < 2}
      title={selectedCount < 2 ? 'Tick two or more lines to merge them (Ctrl+J)' : 'Merge the ticked lines (Ctrl+J)'}>
      Merge ({selectedCount})
    </button>
  </div>

  <div class="toolbar-group">
    <button class="tool-btn" on:click={() => dispatch('outdent')} disabled={selectedCount === 0}
      title="Outdent the ticked lines (Ctrl+[ or Shift+Tab)">&#8592; Outdent</button>
    <button class="tool-btn" on:click={() => dispatch('indent')} disabled={selectedCount === 0}
      title="Indent the ticked lines (Ctrl+] or Tab)">Indent &#8594;</button>
  </div>

  <div class="toolbar-group" role="group" aria-label="Move lines">
    <button class="tool-btn" on:click={() => dispatch('move', -1)} disabled={!canMove}
      title="Move the ticked lines (or the focused line) up one line (Alt+↑)">&#8593; Up</button>
    <button class="tool-btn" on:click={() => dispatch('move', 1)} disabled={!canMove}
      title="Move the ticked lines (or the focused line) down one line (Alt+↓)">&#8595; Down</button>
    <button class="tool-btn" on:click={() => dispatch('move', 'top')} disabled={!canMove}
      title="Move the ticked lines (or the focused line), in order, to the top">Top</button>
    <button class="tool-btn" on:click={() => dispatch('move', 'bottom')} disabled={!canMove}
      title="Move the ticked lines (or the focused line), in order, to the bottom">Bottom</button>
  </div>

  {#if suggestionCount > 0}
    <div class="toolbar-group">
      <button class="tool-btn suggest" on:click={() => dispatch('smartMerge')}
        title="Merge the first pair of lines that look like one sentence broken in two">
        Smart merge ({suggestionCount})
      </button>
    </div>
  {/if}
</div>

<style>
  /* Toolbar */
  .modal-toolbar {
    display: flex;
    gap: 12px;
    padding: 10px 24px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
    flex-wrap: wrap;
  }

  .toolbar-group {
    display: flex;
    gap: 6px;
    align-items: center;
  }

  .tool-btn {
    padding: 5px 10px;
    background: var(--bg-tertiary);
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: 5px;
    font-size: 0.8rem;
    cursor: pointer;
    transition: all 0.2s;
    white-space: nowrap;
  }

  .tool-btn:hover:not(:disabled) {
    background: var(--bg-primary);
    border-color: var(--accent);
  }

  .tool-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .tool-btn.primary {
    background: var(--accent);
    color: white;
    border-color: var(--accent);
  }

  .tool-btn.primary:hover:not(:disabled) {
    opacity: 0.9;
  }

  .tool-btn.suggest {
    background: #f59e0b;
    color: white;
    border-color: #f59e0b;
  }
</style>
