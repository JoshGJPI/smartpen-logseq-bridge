<!--
  SelectionInfo.svelte - Selection status and actions bar
-->
<script>
  import { createEventDispatcher } from 'svelte';
  import { selectionCount, hasSelection } from '$stores';
  
  export let totalCount = 0;
  
  const dispatch = createEventDispatcher();
</script>

<div class="selection-info">
  {#if $hasSelection}
    <span class="selection-text">
      {$selectionCount} of {totalCount} strokes selected
    </span>
    <button class="action-btn" on:click={() => dispatch('clearSelection')}>
      Clear
    </button>
    <button class="action-btn" on:click={() => dispatch('selectAll')}>
      Select All
    </button>
  {:else}
    <span class="help-text">
      Click strokes to select • Ctrl+click to multi-select • Shift+click for range
    </span>
    {#if totalCount > 0}
      <button class="action-btn" on:click={() => dispatch('selectAll')}>
        Select All ({totalCount})
      </button>
    {/if}
  {/if}
</div>

<style>
  .selection-info {
    margin-top: 10px;
    padding: 10px;
    background: var(--bg-tertiary);
    border-radius: 8px;
    font-size: 0.8rem;
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  .selection-text {
    color: var(--accent);
    font-weight: 500;
  }

  .help-text {
    color: var(--text-secondary);
    flex: 1;
  }

  .action-btn {
    padding: 4px 10px;
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-secondary);
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.75rem;
    transition: all 0.2s;
  }

  .action-btn:hover {
    color: var(--text-primary);
    border-color: var(--text-secondary);
  }
</style>
