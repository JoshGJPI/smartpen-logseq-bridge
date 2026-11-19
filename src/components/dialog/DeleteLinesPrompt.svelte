<!--
  DeleteLinesPrompt.svelte - what Delete asks before deleting transcript lines
  (v3.20.0, lib/delete-lines.js deletePrompt): for a line with children,
  Delete line (its children move up a level) or Delete block (they go too); for
  task lines, a confirm naming the tasks, since their state goes with them.
  Used by the Edit Transcription dialog and Library Edit. Owns no state.
-->
<script>
  import { onMount } from 'svelte';
  import { taskConfirmText } from '$lib/delete-lines.js';

  /** deletePrompt()'s result */
  export let prompt;
  /** (block: boolean) => void */
  export let onChoose = () => {};
  export let onCancel = () => {};

  let firstBtn;
  onMount(() => firstBtn?.focus());

  $: lineAsk = taskConfirmText(prompt.lineTasks);
  $: blockAsk = taskConfirmText(prompt.blockTasks);
  const stateNote = (n) => (n === 1 ? 'Its state goes with it.' : 'Their state goes with them.');
  $: label = prompt.text.length > 70 ? prompt.text.slice(0, 67) + '…' : prompt.text;

  // Ahead of the dialog / reader behind it: Escape cancels here only.
  function onKey(e) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    onCancel();
  }
</script>

<svelte:window on:keydown|capture={onKey} />

<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
<div class="dlp-backdrop" on:click|self={onCancel}>
  <div class="dlp" role="alertdialog" aria-modal="true" aria-label="Delete lines">
    {#if prompt.askBlock}
      <p class="dlp-title">Delete “{label}”?</p>
      <p class="dlp-sub">It has {prompt.childCount} {prompt.childCount === 1 ? 'line' : 'lines'} under it.</p>
      <button class="dlp-choice" bind:this={firstBtn} on:click={() => onChoose(false)}>
        <strong>Delete line</strong>
        <span>Its {prompt.childCount === 1 ? 'line moves' : 'lines move'} up one level.</span>
        {#if lineAsk}<span class="dlp-task">{lineAsk.replace(/\?$/, '.')} {stateNote(prompt.lineTasks.length)}</span>{/if}
      </button>
      <button class="dlp-choice" on:click={() => onChoose(true)}>
        <strong>Delete block</strong>
        <span>The line and the {prompt.childCount} under it go.</span>
        {#if blockAsk}<span class="dlp-task">{blockAsk.replace(/\?$/, '.')} {stateNote(prompt.blockTasks.length)}</span>{/if}
      </button>
      <div class="dlp-actions"><button class="dlp-btn" on:click={onCancel}>Cancel</button></div>
    {:else}
      <p class="dlp-title">{lineAsk}</p>
      <p class="dlp-sub">{stateNote(prompt.lineTasks.length)}</p>
      <div class="dlp-actions">
        <button class="dlp-btn" on:click={onCancel}>Cancel</button>
        <button class="dlp-btn danger" bind:this={firstBtn} on:click={() => onChoose(false)}>Delete</button>
      </div>
    {/if}
  </div>
</div>

<style>
  .dlp-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.35);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10050;
  }
  .dlp {
    width: min(420px, 92vw);
    background: var(--bg-primary, #fff);
    color: var(--text-primary, #222);
    border: 1px solid var(--border, #ddd);
    border-radius: 10px;
    padding: 16px 18px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
    font-size: 13px;
  }
  .dlp-title { margin: 0 0 4px; font-weight: 600; font-size: 14px; word-break: break-word; }
  .dlp-sub { margin: 0 0 12px; color: var(--text-secondary, #666); }
  .dlp-choice {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 100%;
    text-align: left;
    margin-bottom: 8px;
    padding: 8px 10px;
    background: var(--bg-secondary, #f6f6f6);
    color: inherit;
    border: 1px solid var(--border, #ddd);
    border-radius: 6px;
    cursor: pointer;
    font: inherit;
  }
  .dlp-choice:hover, .dlp-choice:focus-visible { border-color: var(--accent, #4a7cf7); }
  .dlp-choice span { color: var(--text-secondary, #666); font-size: 12px; }
  .dlp-choice .dlp-task { color: #d97706; }
  .dlp-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
  .dlp-btn {
    padding: 6px 14px;
    border-radius: 6px;
    border: 1px solid var(--border, #ddd);
    background: var(--bg-tertiary, #fff);
    color: inherit;
    cursor: pointer;
    font: inherit;
  }
  .dlp-btn.danger { background: #c0392b; border-color: #c0392b; color: #fff; }
</style>
