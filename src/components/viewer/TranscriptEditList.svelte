<!--
  TranscriptEditList.svelte — Library Edit's rows (TranscriptPane): the hint,
  the ink choice for deleted lines (v3.20.0, while a deleted saved line had
  ink), one TranscriptEditRow per draft line with its keys, and the delete
  prompt. Owns no draft: every edit is a callback the pane applies.
-->
<script>
  import TranscriptEditRow from './TranscriptEditRow.svelte';
  import DeleteLinesPrompt from '../dialog/DeleteLinesPrompt.svelte';
  import DeletedInkChoice from '../dialog/DeletedInkChoice.svelte';

  /** @type {Array<{id: string, text: string, indentLevel: number}>} (bound: rows edit `text`) */
  export let draft = [];
  /** ids of the ticked lines */
  export let selectedIds = new Set();
  /** How many deleted saved lines had ink; 'textless' | 'retry' (bound). */
  export let inkCount = 0;
  export let deletedInk;
  /** deletePrompt()'s result while Delete is asking, else null */
  export let pendingDelete = null;
  export let onEdit = () => {};
  export let onFocus = (i) => {};
  export let onBlur = (i) => {};
  export let onToggle = (id) => {};
  /** (i, dir: -1 | 1) */
  export let onMove = () => {};
  export let onIndent = (i) => {};
  export let onOutdent = (i) => {};
  export let onAddBelow = (i) => {};
  export let onDelete = (i) => {};
  export let onMerge = () => {};
  /** (indices, block) */
  export let onChooseDelete = () => {};
  export let onCancelDelete = () => {};

  /** @type {Array<TranscriptEditRow>} */
  let rows = [];
  export function focusRow(i) { rows[i]?.focus(); }
  export function scrollRow(i) { rows[i]?.scrollIntoView?.({ block: 'nearest' }); }

  function onKey(e, i) {
    // Mid-IME, Enter / Backspace belong to the composition.
    if (e.isComposing) return;
    if ((e.key === 'j' || e.key === 'J') && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      onMerge();
    } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.altKey) {
      e.preventDefault();
      onMove(i, e.key === 'ArrowUp' ? -1 : 1);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      e.shiftKey ? onOutdent(i) : onIndent(i);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      onAddBelow(i);
    } else if (e.key === 'Backspace' && draft[i].text === '' && draft.length > 1) {
      e.preventDefault();
      onDelete(i);
    }
  }
</script>

<div class="tp-edit-hint">Tab / Shift+Tab to indent · Alt+↑ / Alt+↓ to reorder (ticked lines move together) · Enter for a new line · tick lines and Merge (Ctrl+J) to join them</div>
{#if inkCount > 0}<div class="tp-ink"><DeletedInkChoice bind:value={deletedInk} count={inkCount} /></div>{/if}
{#each draft as line, i (line.id)}
  <TranscriptEditRow
    bind:text={line.text}
    bind:this={rows[i]}
    indentLevel={line.indentLevel}
    selected={selectedIds.has(line.id)}
    isFirst={i === 0}
    isLast={i === draft.length - 1}
    {onEdit}
    onKey={(e) => onKey(e, i)}
    onFocus={() => onFocus(i)}
    onBlur={() => onBlur(i)}
    onToggleSelect={() => onToggle(line.id)}
    onMoveUp={() => onMove(i, -1)}
    onMoveDown={() => onMove(i, 1)}
    onOutdent={() => onOutdent(i)}
    onIndent={() => onIndent(i)}
  />
{/each}
{#if pendingDelete}
  <DeleteLinesPrompt prompt={pendingDelete} onChoose={(block) => onChooseDelete(pendingDelete.indices, block)}
    onCancel={onCancelDelete} />
{/if}

<style>
  .tp-ink { margin-bottom: 10px; padding: 6px 8px; background: #fff8eb; border: 1px solid #f3dfb5; border-radius: 5px; color: #555; }
  .tp-edit-hint {
    font-size: 11px;
    color: #999;
    margin-bottom: 10px;
    padding-bottom: 8px;
    border-bottom: 1px dashed #eee;
  }
</style>
