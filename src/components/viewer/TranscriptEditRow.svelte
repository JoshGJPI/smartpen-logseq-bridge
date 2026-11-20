<!--
  TranscriptEditRow.svelte — one line of TranscriptPane's Edit mode: a select
  box (for Merge), the text, which wraps (a one-row textarea that grows,
  lib/autosize.js), and the reorder / indent buttons revealed on hover or focus.
  Keys and edits are the pane's (onKey, onEdit); this row only lays them out.

  A sketch line (v3.24.0, `sketch`) shows a small thumbnail of its ink and a
  SKETCH badge before its label; the label edits like text (a cleared one is
  saved as "Sketch"), and the row moves and indents like any line.
-->
<script>
  import { autosize, oneLine } from '$lib/autosize.js';
  import PageThumb from './PageThumb.svelte';

  export let text = '';
  export let indentLevel = 0;
  export let selected = false;
  export let isFirst = false;
  export let isLast = false;
  /** () => void after the text changed */
  export let onEdit = () => {};
  /** (KeyboardEvent) => void */
  export let onKey = () => {};
  export let onFocus = () => {};
  export let onBlur = () => {};
  export let onToggleSelect = () => {};
  export let onMoveUp = () => {};
  export let onMoveDown = () => {};
  export let onIndent = () => {};
  export let onOutdent = () => {};
  /** A sketch row: `{ book, pageId, lineId }` for its thumbnail, else null. */
  export let sketch = null;

  /** @type {HTMLTextAreaElement} */
  let field;
  export function focus() {
    field?.focus();
  }

  function onInput(e) {
    // A pasted line break would split nothing: the line stays one line.
    if (/[\r\n]/.test(e.target.value)) text = oneLine(e.target.value);
    onEdit();
  }
</script>

<div class="tp-edit-row" class:selected style="margin-left: {(indentLevel || 0) * 1.5}rem">
  <input
    type="checkbox"
    class="tp-select"
    checked={selected}
    on:change={onToggleSelect}
    title="Select for Merge"
    aria-label="Select line for Merge"
  />
  {#if sketch}
    <div class="tp-sk" title="A sketch: its label is searchable; its ink stays linked to it">
      <PageThumb book={sketch.book} pageId={sketch.pageId} lineId={sketch.lineId} height="40px" />
      <span class="tp-sk-badge">SKETCH</span>
    </div>
  {/if}
  <textarea
    class="tp-input"
    rows="1"
    bind:value={text}
    bind:this={field}
    use:autosize={text}
    on:input={onInput}
    on:keydown={onKey}
    on:focus={onFocus}
    on:blur={onBlur}
    placeholder={sketch ? 'Sketch' : '(empty line)'}
    aria-label={sketch ? 'Sketch label' : null}
  ></textarea>
  <div class="tp-row-actions">
    <button class="tp-icon" on:click={onMoveUp} disabled={isFirst} title="Move up (Alt+↑)">↑</button>
    <button class="tp-icon" on:click={onMoveDown} disabled={isLast} title="Move down (Alt+↓)">↓</button>
    <button class="tp-icon" on:click={onOutdent} title="Outdent (Shift+Tab)">⇤</button>
    <button class="tp-icon" on:click={onIndent} title="Indent (Tab)">⇥</button>
  </div>
</div>

<style>
  .tp-edit-row {
    position: relative;
    display: flex;
    align-items: flex-start;
    gap: 6px;
    margin-bottom: 4px;
  }
  .tp-select {
    flex-shrink: 0;
    margin-top: 9px;
    cursor: pointer;
    accent-color: #4a7cf7;
    opacity: 0.35;
    transition: opacity 0.15s;
  }
  .tp-edit-row:hover .tp-select,
  .tp-edit-row:focus-within .tp-select,
  .tp-edit-row.selected .tp-select { opacity: 1; }
  .tp-input {
    flex: 1;
    min-width: 0;
    padding: 5px 8px;
    border: 1px solid #e0e0e0;
    border-radius: 5px;
    font-size: 14px;
    line-height: 1.5;
    color: #222;
    font-family: inherit;
    resize: none;
    overflow: hidden;
    overflow-wrap: anywhere;
    box-sizing: border-box;
  }
  .tp-input:focus { outline: none; border-color: #4a7cf7; }
  .tp-sk { flex-shrink: 0; display: flex; flex-direction: column; align-items: center; gap: 2px; width: 50px; }
  .tp-sk :global(.thumb) { width: 50px; padding: 2px; border: 1px solid #eee; border-radius: 4px; box-sizing: border-box; }
  .tp-sk-badge { padding: 0 4px; border-radius: 3px; background: #f5b942; color: #1c1f2b; font-size: 9px; font-weight: 700; letter-spacing: 0.04em; }
  .tp-edit-row.selected .tp-input { background: #f3f7ff; border-color: #b9ccfb; }
  /* The action group floats over the top right of the (full-width) text,
     revealed on hover / keyboard focus. Its white background + feathered shadow
     covers the text underneath so the controls stay legible; at rest the row
     gives its whole width to the transcript text. */
  .tp-row-actions {
    position: absolute;
    right: 5px;
    top: 3px;
    display: flex;
    gap: 2px;
    padding: 2px 3px;
    border-radius: 6px;
    background: #fff;
    box-shadow: 0 0 7px 5px #fff;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.15s;
  }
  .tp-edit-row:hover .tp-row-actions,
  .tp-edit-row:focus-within .tp-row-actions {
    opacity: 1;
    pointer-events: auto;
  }
  .tp-icon {
    width: 24px;
    height: 26px;
    border: 1px solid transparent;
    border-radius: 5px;
    background: transparent;
    cursor: pointer;
    color: #888;
    font-size: 13px;
    line-height: 1;
  }
  .tp-icon:hover:not(:disabled) { background: #f0f0f0; color: #333; }
  .tp-icon:disabled { opacity: 0.3; cursor: not-allowed; }
</style>
