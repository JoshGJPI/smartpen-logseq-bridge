<!--
  StrokePageCard.svelte - Display a single page with its strokes in a collapsible card
-->
<script>
  import { selectedIndices, handleStrokeClick } from '$stores';
  import StrokeItem from './StrokeItem.svelte';
  
  export let page; // Page object with pageInfo, strokes, indices, book, page number
  
  let expanded = false; // Default: collapsed
  
  function toggleExpanded() {
    expanded = !expanded;
  }
  
  // Get selection count for this page
  $: selectedCount = page.indices.filter(i => $selectedIndices.has(i)).length;
</script>

<div class="page-card" class:expanded>
  <!-- Page Header -->
  <button 
    class="page-header"
    on:click={toggleExpanded}
  >
    <div class="page-title">
      <svg 
        width="14" 
        height="14" 
        viewBox="0 0 24 24" 
        fill="none" 
        stroke="currentColor" 
        stroke-width="2"
        class="expand-icon"
        class:rotated={expanded}
      >
        <polyline points="6 9 12 15 18 9"/>
      </svg>
      <span class="page-icon">📄</span>
      <span class="page-number">Page {page.page}</span>
    </div>
    
    <div class="page-stats">
      {#if selectedCount > 0}
        <span class="selected-indicator">{selectedCount}/{page.strokes.length} selected</span>
      {:else}
        <span class="stroke-count">{page.strokes.length} strokes</span>
      {/if}
    </div>
  </button>
  
  <!-- Stroke List (collapsible) -->
  {#if expanded}
    <div class="stroke-items">
      {#each page.strokes as stroke, i (page.indices[i])}
        <StrokeItem 
          {stroke}
          index={page.indices[i]}
          selected={$selectedIndices.has(page.indices[i])}
          on:click={(e) => handleStrokeClick(page.indices[i], e.detail.ctrlKey, e.detail.shiftKey)}
        />
      {/each}
    </div>
  {/if}
</div>

<style>
  .page-card {
    background: transparent;
    border-radius: 6px;
    margin-bottom: 10px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    overflow: hidden;
    transition: all 0.2s;
  }
  
  .page-card:last-child {
    margin-bottom: 0;
  }
  
  .page-card.expanded {
    border-color: rgba(100, 150, 255, 0.3);
  }
  
  .page-header {
    width: 100%;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 12px;
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--text-primary);
    transition: background 0.2s;
  }
  
  .page-header:hover {
    background: rgba(255, 255, 255, 0.03);
  }
  
  .page-title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
    font-size: 0.9rem;
  }
  
  .expand-icon {
    transition: transform 0.2s;
    color: var(--text-secondary);
    flex-shrink: 0;
  }
  
  .expand-icon.rotated {
    transform: rotate(180deg);
  }
  
  .page-icon {
    font-size: 1rem;
  }
  
  .page-number {
    color: var(--text-primary);
    font-weight: 600;
    font-size: 0.875rem;
  }
  
  .page-stats {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  
  .stroke-count {
    font-size: 0.75rem;
    color: var(--text-secondary);
  }
  
  .selected-indicator {
    font-size: 0.75rem;
    color: var(--success);
    font-weight: 600;
  }
  
  .stroke-items {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 12px 12px 12px;
    background: rgba(255, 255, 255, 0.02);
    max-height: 400px;
    overflow-y: auto;
  }
  
  .stroke-items::-webkit-scrollbar {
    width: 6px;
  }
  
  .stroke-items::-webkit-scrollbar-track {
    background: transparent;
  }
  
  .stroke-items::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.2);
    border-radius: 3px;
  }
  
  .stroke-items::-webkit-scrollbar-thumb:hover {
    background: var(--accent);
  }
</style>
