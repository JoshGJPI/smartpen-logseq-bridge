<!--
  TranscriptEditorLine.svelte - One row of the Edit Transcription dialog
  (TranscriptionEditorModal): tick box, indent guides, the editable text and the
  row's merge / split / indent buttons. Owns no state; every change is an event
  the dialog applies (and records for its undo).
-->
<script>
  import { createEventDispatcher } from 'svelte';
  import { autosize, oneLine } from '$lib/autosize.js';
  import { editorLineStatus } from '$lib/editor-lines.js';

  export let line;
  export let selected = false;
  export let focused = false;
  /** The last row has nothing to merge with. */
  export let isLast = false;

  const dispatch = createEventDispatcher();

  const STATUS_TEXT = { synced: 'saved', modified: 'modified', new: 'new' };
  const STATUS_TITLE = {
    synced: 'Saved, unchanged',
    modified: 'Saved line, changed here',
    new: 'New line, not saved yet'
  };

  $: status = editorLineStatus(line);
  $: indent = line.indentLevel || 0;

  function split() {
    const text = line.text || '';
    const mid = Math.floor(text.length / 2);
    dispatch('split', { text1: text.slice(0, mid), text2: text.slice(mid) });
  }
</script>

<!-- svelte-ignore a11y-no-static-element-interactions -->
<div
  class="line-item"
  class:selected
  class:focused
  class:merged={line.mergedLineCount > 1}
  class:status-synced={status === 'synced'}
  class:status-modified={status === 'modified'}
  class:status-new={status === 'new'}
  on:mousedown={() => dispatch('focus')}
  on:focusin={() => dispatch('focus')}
>
  <div class="line-row" style="padding-left: {indent * 24}px">
    <input
      type="checkbox"
      class="line-checkbox"
      checked={selected}
      aria-label="Select line"
      on:change={() => dispatch('toggle')}
    />

    {#if indent > 0}
      <span class="indent-guide">
        {#each Array(indent) as _, i}
          <span class="indent-bar" style="left: {-(indent - i) * 24 + 8}px"></span>
        {/each}
      </span>
    {/if}

    <span class="bullet">&#8226;</span>

    <!-- Wraps instead of scrolling: a one-row textarea that grows
         (lib/autosize.js). The line stays one line: Enter is not a
         newline, and pasted breaks become spaces. -->
    <textarea
      class="line-text"
      rows="1"
      value={line.text}
      use:autosize={line.text}
      aria-label="Line text"
      on:input={(e) => dispatch('input', oneLine(e.target.value))}
      on:keydown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
      on:blur={() => dispatch('commit')}
      placeholder="Empty line…"
    ></textarea>

    <!-- Trailing cluster: actions then status. The status slot is a fixed
         width so a line changing from NEW to MODIFIED can't shift the buttons
         out from under the cursor mid-click. -->
    <div class="line-trailing">
      <div class="line-actions">
        <button class="action-btn" on:click={() => dispatch('merge')} disabled={isLast}
          title="Merge with next line" aria-label="Merge with next line">&#8595;</button>
        <button class="action-btn" on:click={split}
          title="Split line in half" aria-label="Split line in half">&#8596;</button>
        <button class="action-btn" on:click={() => dispatch('outdent')} disabled={indent <= 0}
          title="Outdent" aria-label="Outdent">&#8592;</button>
        <button class="action-btn" on:click={() => dispatch('indent')} disabled={indent >= 5}
          title="Indent" aria-label="Indent">&#8594;</button>
      </div>

      <span class="status-slot">
        <span class="status-badge {status}" title={STATUS_TITLE[status]}>{STATUS_TEXT[status]}</span>
      </span>
    </div>
  </div>

  {#if line.mergedLineCount > 1}
    <div class="merge-info" style="padding-left: {indent * 24 + 28}px">
      merged from {line.mergedLineCount} lines
    </div>
  {/if}
</div>

<style>
  /* Rendered like text, not like a form */
  .line-item {
    border-radius: 6px;
    margin-bottom: 2px;
    transition: background 0.15s;
  }

  .line-item:hover {
    background: var(--bg-secondary);
  }

  .line-item.selected {
    background: rgba(59, 130, 246, 0.08);
  }

  /* The row the stroke preview is showing. Distinct from selection, which
     drives the bulk indent/merge actions. */
  .line-item.focused {
    background: rgba(245, 158, 11, 0.10);
    box-shadow: inset 0 0 0 1px rgba(245, 158, 11, 0.35);
  }

  .line-item.focused.selected {
    background: rgba(245, 158, 11, 0.14);
  }

  .line-item.merged {
    border-left: 3px solid #22c55e;
  }

  /* Status-based left border */
  .line-item.status-synced {
    border-left: 3px solid transparent;
  }

  .line-item.status-modified {
    border-left: 3px solid #f59e0b;
  }

  .line-item.status-new {
    border-left: 3px solid var(--accent);
  }

  /* Top-aligned: a long line wraps, and the box, bullet and buttons stay on
     its first row. */
  .line-row {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    padding: 6px 8px;
    position: relative;
  }
  /* centred on the text's first row (about 32px tall) */
  .line-row > .line-checkbox,
  .line-row > .bullet { margin-top: 8px; }
  .line-row > .line-trailing { margin-top: 3px; }

  .line-checkbox {
    width: 16px;
    height: 16px;
    cursor: pointer;
    accent-color: var(--accent);
    flex-shrink: 0;
  }

  /* Indent guides */
  .indent-guide {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    pointer-events: none;
  }

  .indent-bar {
    position: absolute;
    top: 4px;
    bottom: 4px;
    width: 1px;
    background: var(--border);
  }

  .bullet {
    color: var(--text-tertiary);
    font-size: 1rem;
    flex-shrink: 0;
    line-height: 1;
  }

  /* Editable text — styled like rendered text, not code */
  .line-text {
    flex: 1;
    min-width: 0;
    padding: 4px 6px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 3px;
    color: var(--text-primary);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 0.9rem;
    line-height: 1.5;
    resize: none;
    overflow: hidden;
    overflow-wrap: anywhere;
    box-sizing: border-box;
    transition: border-color 0.15s, background 0.15s;
  }

  .line-text:hover {
    border-color: var(--border);
  }

  .line-text:focus {
    outline: none;
    border-color: var(--accent);
    background: var(--bg-primary);
  }

  .line-text::placeholder {
    color: var(--text-tertiary);
    font-style: italic;
  }

  /* Trailing cluster — actions sit at a fixed offset from the row's right edge
     because the status slot below never changes width. */
  .line-trailing {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  /* Per-line action buttons — compact icon row */
  .line-actions {
    display: flex;
    gap: 2px;
    opacity: 0;
    transition: opacity 0.15s;
    flex-shrink: 0;
  }

  .line-item:hover .line-actions,
  .line-item.selected .line-actions {
    opacity: 1;
  }

  .action-btn {
    width: 26px;
    height: 26px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 0.8rem;
    cursor: pointer;
    transition: all 0.15s;
    padding: 0;
  }

  .action-btn:hover:not(:disabled) {
    background: var(--bg-primary);
    color: var(--text-primary);
    border-color: var(--accent);
  }

  .action-btn:disabled {
    opacity: 0.25;
    cursor: not-allowed;
  }

  /* Status badges. The slot is fixed-width and the badge fills it, so a line
     going from NEW to MODIFIED (e.g. after an indent) re-labels in place instead
     of pushing the action buttons sideways under the user's cursor — which made
     indenting a line several levels a game of chase. */
  .status-slot {
    display: inline-flex;
    justify-content: flex-end;
    width: 68px;
    flex-shrink: 0;
  }

  .status-badge {
    width: 100%;
    box-sizing: border-box;
    text-align: center;
    font-size: 0.6rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 2px 6px;
    border-radius: 8px;
    flex-shrink: 0;
    opacity: 0.7;
  }

  .status-badge.synced {
    background: rgba(107, 114, 128, 0.15);
    color: #9ca3af;
  }

  .status-badge.modified {
    background: rgba(245, 158, 11, 0.15);
    color: #fbbf24;
    opacity: 1;
  }

  .status-badge.new {
    background: rgba(59, 130, 246, 0.15);
    color: #60a5fa;
    opacity: 1;
  }

  .merge-info {
    font-size: 0.7rem;
    color: #22c55e;
    font-weight: 500;
    padding-bottom: 4px;
  }
</style>
