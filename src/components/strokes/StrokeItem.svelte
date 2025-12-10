<!--
  StrokeItem.svelte - Individual stroke row in list
-->
<script>
  import { createEventDispatcher } from 'svelte';
  
  export let stroke;
  export let index;
  export let selected = false;
  
  const dispatch = createEventDispatcher();
  
  $: dotCount = stroke.dotArray?.length || stroke.dots?.length || 0;
  $: pageInfo = stroke.pageInfo || {};
  $: pageKey = pageInfo.page !== undefined 
    ? `Page ${pageInfo.page}` 
    : 'Unknown';
  
  function handleClick(event) {
    dispatch('click', {
      ctrlKey: event.ctrlKey || event.metaKey,
      shiftKey: event.shiftKey
    });
  }
  
  // Format timestamp if available
  function formatTime(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleTimeString();
  }
</script>

<div 
  class="stroke-item" 
  class:selected
  on:click={handleClick}
  on:keydown={(e) => e.key === 'Enter' && handleClick(e)}
  role="button"
  tabindex="0"
>
  <div class="stroke-header">
    <span class="stroke-id">Stroke #{index + 1}</span>
    <span class="stroke-dots">{dotCount} dots</span>
  </div>
  
  <div class="stroke-meta">
    <span class="meta-item">{pageKey}</span>
    {#if stroke.timestamp}
      <span class="meta-item">{formatTime(stroke.timestamp)}</span>
    {/if}
    {#if stroke.color}
      <span class="color-indicator" style="background: {stroke.color}"></span>
    {/if}
  </div>
</div>

<style>
  .stroke-item {
    background: var(--bg-tertiary);
    border-radius: 8px;
    padding: 12px;
    cursor: pointer;
    transition: all 0.2s;
    border: 2px solid transparent;
  }

  .stroke-item:hover {
    background: var(--border);
  }

  .stroke-item.selected {
    border-color: var(--accent);
    background: rgba(233, 69, 96, 0.1);
  }

  .stroke-header {
    display: flex;
    justify-content: space-between;
    margin-bottom: 5px;
  }

  .stroke-id {
    font-weight: 600;
    font-size: 0.85rem;
  }

  .stroke-dots {
    color: var(--text-secondary);
    font-size: 0.75rem;
  }

  .stroke-meta {
    display: flex;
    gap: 10px;
    align-items: center;
    font-size: 0.75rem;
    color: var(--text-secondary);
  }

  .meta-item {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .color-indicator {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 1px solid var(--border);
  }
</style>
