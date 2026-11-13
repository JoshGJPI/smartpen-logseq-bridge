<!--
  TranscriptEditToolbar.svelte — TranscriptPane's buttons while Edit is open:
  Add, Delete, Merge, the ticked group's moves, Copy all, Save, Cancel.
  The structural buttons keep focus in the line being edited (mousedown is
  prevented), so they act on that line.
-->
<script>
  /** Index of the focused line, -1 for none. */
  export let activeIndex = -1;
  export let lineCount = 0;
  /** How many lines are ticked. */
  export let ticked = 0;
  export let canMerge = false;
  export let saving = false;
  export let onAdd = () => {};
  export let onDelete = () => {};
  export let onMerge = () => {};
  /** (how: -1 | 1 | 'top' | 'bottom') => void */
  export let onMove = () => {};
  export let onCopy = () => {};
  export let onSave = () => {};
  export let onCancel = () => {};
</script>

<button class="tp-btn" on:mousedown|preventDefault on:click={onAdd}
  title="Add a line after the selected line and its indented lines, or at the end">＋ Add</button>
<button class="tp-btn danger" on:mousedown|preventDefault on:click={onDelete}
  disabled={activeIndex < 0 || lineCount <= 1}
  title={activeIndex < 0 ? 'Click in a line to delete it' : 'Delete the selected line'}>🗑 Delete</button>
<button class="tp-btn" on:mousedown|preventDefault on:click={onMerge} disabled={!canMerge}
  title={ticked >= 2 ? 'Join the ticked lines into one, in the first one\'s place (Ctrl+J)' : 'Join the selected line with the next one, or tick lines to join (Ctrl+J)'}
>Merge{ticked >= 2 ? ` (${ticked})` : ''}</button>
{#if ticked}
  <span class="tp-move" role="group" aria-label="Move the ticked lines">
    <button class="tp-btn" on:mousedown|preventDefault on:click={() => onMove(-1)} title="Move the ticked lines up one line (Alt+↑ on a ticked line)" aria-label="Move the ticked lines up">↑</button>
    <button class="tp-btn" on:mousedown|preventDefault on:click={() => onMove(1)} title="Move the ticked lines down one line (Alt+↓ on a ticked line)" aria-label="Move the ticked lines down">↓</button>
    <button class="tp-btn" on:mousedown|preventDefault on:click={() => onMove('top')} title="Move the ticked lines, in order, to the top">Top</button>
    <button class="tp-btn" on:mousedown|preventDefault on:click={() => onMove('bottom')} title="Move the ticked lines, in order, to the bottom">Bottom</button>
  </span>
{/if}
<span class="tp-toolbar-divider"></span>
<button class="tp-btn" on:click={onCopy} title="Copy the whole transcript as LogSeq markdown">Copy all</button>
<button class="tp-btn primary" on:click={onSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
<button class="tp-btn muted" on:click={onCancel} disabled={saving}>Cancel</button>

<style>
  .tp-move { display: inline-flex; gap: 2px; }
  .tp-move .tp-btn { padding: 4px 8px; }
  .tp-toolbar-divider { width: 1px; align-self: stretch; background: #e6e6e6; margin: 2px 2px; }
</style>
