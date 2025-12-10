<!--
  StrokeList.svelte - List view of strokes with selection
-->
<script>
  import { strokes, strokeCount } from '$stores';
  import { selectedIndices, handleStrokeClick, selectionCount } from '$stores';
  import StrokeItem from './StrokeItem.svelte';
</script>

<div class="stroke-list">
  {#if $strokeCount === 0}
    <p class="empty-message">
      Connect pen and write to see strokes
    </p>
  {:else}
    <div class="list-header">
      <span>{$strokeCount} strokes</span>
      {#if $selectionCount > 0}
        <span class="selection-badge">{$selectionCount} selected</span>
      {/if}
    </div>
    
    <div class="list-items">
      {#each $strokes as stroke, index (index)}
        <StrokeItem 
          {stroke}
          {index}
          selected={$selectedIndices.has(index)}
          on:click={(e) => handleStrokeClick(index, e.detail.ctrlKey, e.detail.shiftKey)}
        />
      {/each}
    </div>
  {/if}
</div>

<style>
  .stroke-list {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .empty-message {
    color: var(--text-secondary);
    text-align: center;
    padding: 40px 20px;
  }

  .list-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 0;
    margin-bottom: 10px;
    font-size: 0.85rem;
    color: var(--text-secondary);
    border-bottom: 1px solid var(--border);
  }

  .selection-badge {
    background: var(--accent);
    color: white;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 0.75rem;
  }

  .list-items {
    display: flex;
    flex-direction: column;
    gap: 8px;
    overflow-y: auto;
    flex: 1;
  }
</style>
