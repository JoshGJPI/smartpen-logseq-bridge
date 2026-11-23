<!--
  RemoveSketchPrompt.svelte — what Remove sketch asks (v3.24.0): the line goes,
  its strokes are never deleted, and its ink follows the same choice as a deleted
  line's (DeletedInkChoice): Not text (the default: the drawing is never sent to
  MyScript) or Transcribe it again next time (only unlinked). Owns no state.
-->
<script>
  import { onMount } from 'svelte';
  import { INK_TEXTLESS } from '$lib/deleted-ink.js';
  import { plural } from '$lib/plural.js';
  import DeletedInkChoice from '../dialog/DeletedInkChoice.svelte';

  export let label = '';
  /** Strokes linked to the sketch, or null. */
  export let count = null;
  /** (ink: 'textless' | 'retry') => void */
  export let onConfirm = () => {};
  export let onCancel = () => {};

  let ink = INK_TEXTLESS;
  let firstBtn;
  onMount(() => firstBtn?.focus());

  function onKey(e) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    onCancel();
  }
</script>

<svelte:window on:keydown|capture={onKey} />

<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
<div class="rsp-backdrop" on:click|self={onCancel}>
  <div class="rsp" role="alertdialog" aria-modal="true" aria-label="Remove sketch">
    <p class="rsp-title">Remove the sketch “{label}”?</p>
    <p class="rsp-sub">The line goes from the transcript; its {count ?? ''} {plural(count || 0, 'stroke')} stay on the page (never deleted).</p>
    <div class="rsp-ink"><DeletedInkChoice bind:value={ink} count={1} /></div>
    <div class="rsp-actions">
      <button class="rsp-btn" on:click={onCancel}>Cancel</button>
      <button class="rsp-btn danger" bind:this={firstBtn} on:click={() => onConfirm(ink)}>Remove sketch</button>
    </div>
  </div>
</div>

<style>
  .rsp-backdrop { position: fixed; inset: 0; z-index: 10050; display: flex; align-items: center; justify-content: center; background: rgba(0, 0, 0, 0.35); }
  .rsp {
    width: min(440px, 92vw); padding: 16px 18px; border-radius: 10px; background: var(--bg-primary, #fff);
    color: var(--text-primary, #222); border: 1px solid var(--border, #ddd); box-shadow: 0 12px 32px rgba(0, 0, 0, 0.3);
  }
  .rsp-title { margin: 0 0 6px; font-weight: 600; }
  .rsp-sub { margin: 0 0 10px; font-size: 13px; color: var(--text-secondary, #666); }
  .rsp-ink { margin-bottom: 12px; padding: 6px 8px; background: #fff8eb; border: 1px solid #f3dfb5; border-radius: 5px; color: #555; }
  .rsp-actions { display: flex; justify-content: flex-end; gap: 8px; }
  .rsp-btn { padding: 6px 12px; border: 1px solid var(--border, #ccc); border-radius: 6px; background: var(--bg-tertiary, #f2f2f2); color: inherit; font: inherit; cursor: pointer; }
  .rsp-btn.danger { background: #c0392b; border-color: #c0392b; color: #fff; }
</style>
