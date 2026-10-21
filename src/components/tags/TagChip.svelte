<!--
  TagChip.svelte — one tag as a pill (v3.1.0 page tags; mockups 1–7).

  Keywords are grey, project numbers teal; a suggested project number is a
  dashed amber chip with ✓ (add as a tag) and ✕ (dismiss for this page).
  `onRemove` adds a × ; `onClick` makes the whole chip a toggle (filters), with
  `on` for a chosen filter and `count` for a small number after the name.
-->
<script>
  import { isProjectTag } from '$lib/tags.js';

  export let tag;
  export let suggested = false;
  export let on = false;
  /** Small count after the name (filter chips). */
  export let count = null;
  export let onRemove = null;
  export let onClick = null;
  export let onAccept = null;
  export let onDismiss = null;
  export let disabled = false;
  /** Tooltip; defaults to the tag. */
  export let title = '';

  $: project = isProjectTag(tag);
</script>

{#if onClick}
  <button
    type="button"
    class="tg"
    class:p={project}
    class:on
    aria-pressed={on}
    {disabled}
    title={title || tag}
    on:click={onClick}
  >{tag}{#if count != null}<small>{count}</small>{/if}{#if on}<span class="x" aria-hidden="true">×</span>{/if}</button>
{:else}
  <span class="tg" class:p={project} class:s={suggested} title={title || tag}>
    {tag}{#if count != null}<small>{count}</small>{/if}
    {#if onRemove}
      <button type="button" class="x" {disabled} aria-label="Remove tag {tag}" title="Remove" on:click|stopPropagation={onRemove}>×</button>
    {/if}
    {#if suggested && onAccept}
      <button type="button" class="ok" {disabled} aria-label="Add {tag} as a tag" title="Add as a tag" on:click|stopPropagation={onAccept}>✓</button>
    {/if}
    {#if suggested && onDismiss}
      <button type="button" class="no" {disabled} aria-label="Dismiss {tag} for this page" title="Dismiss for this page" on:click|stopPropagation={onDismiss}>✕</button>
    {/if}
  </span>
{/if}

<style>
  .tg {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    max-width: 100%;
    padding: 1px 8px;
    border: 1px solid transparent;
    border-radius: 99px;
    background: #eef0f3;
    color: #555;
    font-size: 11.5px;
    line-height: 1.5;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-family: inherit;
  }
  .tg.p { background: #e3f5f2; color: #0f766e; font-weight: 600; font-variant-numeric: tabular-nums; }
  .tg.s { background: #fff8e1; color: #9a6700; border: 1px dashed #e0b84a; font-weight: 600; padding-right: 3px; }
  button.tg { cursor: pointer; }
  button.tg:hover:not(:disabled) { filter: brightness(0.95); }
  button.tg.on { outline: 2px solid #4a7cf7; outline-offset: -1px; background: #eef3ff; color: #2c56c4; }
  small { opacity: 0.6; font-size: 10.5px; font-weight: 400; }

  .x, .ok, .no {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .x { opacity: 0.5; font-size: 12px; margin-left: 1px; }
  .x:hover:not(:disabled) { opacity: 1; }
  .ok, .no { width: 17px; height: 17px; border-radius: 50%; font-size: 10px; }
  .ok { background: #2f7d4f; color: #fff; }
  .ok:hover:not(:disabled) { background: #25663f; }
  .no { background: rgba(0, 0, 0, 0.07); color: #7a5200; }
  .no:hover:not(:disabled) { background: rgba(0, 0, 0, 0.18); }
  button:disabled { cursor: default; opacity: 0.5; }
</style>
