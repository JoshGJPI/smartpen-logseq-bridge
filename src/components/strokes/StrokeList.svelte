<!--
  StrokeList.svelte - List view of strokes grouped by page with collapsible headers
-->
<script>
  import { strokes, strokeCount, pages } from '$stores';
  import { selectedIndices, handleStrokeClick, selectionCount } from '$stores';
  import { bookAliases } from '$stores';
  import { formatBookName } from '$utils/formatting.js';
  import StrokeItem from './StrokeItem.svelte';
  
  // Track expanded pages (default: all expanded)
  let expandedPages = {};
  
  // Group strokes by page with their original indices
  $: strokesByPage = (() => {
    const grouped = new Map();
    
    $strokes.forEach((stroke, index) => {
      const pageInfo = stroke.pageInfo || {};
      const pageKey = `S${pageInfo.section || 0}/O${pageInfo.owner || 0}/B${pageInfo.book || 0}/P${pageInfo.page || 0}`;
      
      if (!grouped.has(pageKey)) {
        grouped.set(pageKey, {
          pageInfo,
          pageKey,
          strokes: [],
          indices: [],
          book: pageInfo.book || 0,
          page: pageInfo.page || 0
        });
      }
      
      const group = grouped.get(pageKey);
      group.strokes.push(stroke);
      group.indices.push(index);
    });
    
    // Sort by book, then page
    return Array.from(grouped.values()).sort((a, b) => {
      if (a.book !== b.book) return a.book - b.book;
      return a.page - b.page;
    });
  })();
  
  // Initialize expanded state for all pages
  $: if (strokesByPage.length > 0) {
    strokesByPage.forEach(group => {
      if (expandedPages[group.pageKey] === undefined) {
        expandedPages[group.pageKey] = true; // Default: expanded
      }
    });
  }
  
  // Toggle page expansion
  function togglePage(pageKey) {
    expandedPages[pageKey] = !expandedPages[pageKey];
    expandedPages = { ...expandedPages }; // Trigger reactivity
  }
  
  // Get selection count for a page
  function getPageSelectionCount(indices) {
    return indices.filter(i => $selectedIndices.has(i)).length;
  }
</script>

<div class="stroke-list">
  {#if $strokeCount === 0}
    <p class="empty-message">
      Connect pen and write to see strokes
    </p>
  {:else}
    <div class="list-header">
      <span>{$strokeCount} strokes across {strokesByPage.length} page{strokesByPage.length !== 1 ? 's' : ''}</span>
      {#if $selectionCount > 0}
        <span class="selection-badge">{$selectionCount} selected</span>
      {/if}
    </div>
    
    <div class="page-groups">
      {#each strokesByPage as group (group.pageKey)}
        {@const isExpanded = expandedPages[group.pageKey]}
        {@const selectedCount = getPageSelectionCount(group.indices)}
        
        <div class="page-group" class:expanded={isExpanded}>
          <!-- Page Header -->
          <button 
            class="page-header"
            on:click={() => togglePage(group.pageKey)}
          >
            <div class="page-title">
              <svg 
                width="16" 
                height="16" 
                viewBox="0 0 24 24" 
                fill="none" 
                stroke="currentColor" 
                stroke-width="2"
                class="expand-icon"
                class:rotated={isExpanded}
              >
                <polyline points="6 9 12 15 18 9"/>
              </svg>
              <span class="book-name">{formatBookName(group.book, $bookAliases, 'full')}</span>
              <span class="page-number">/ P{group.page}</span>
            </div>
            
            <div class="page-stats">
              {#if selectedCount > 0}
                <span class="selected-indicator">{selectedCount}/{group.strokes.length}</span>
              {:else}
                <span class="stroke-count">{group.strokes.length}</span>
              {/if}
            </div>
          </button>
          
          <!-- Stroke List (collapsible) -->
          {#if isExpanded}
            <div class="stroke-items">
              {#each group.strokes as stroke, i (group.indices[i])}
                <StrokeItem 
                  {stroke}
                  index={group.indices[i]}
                  selected={$selectedIndices.has(group.indices[i])}
                  on:click={(e) => handleStrokeClick(group.indices[i], e.detail.ctrlKey, e.detail.shiftKey)}
                />
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .stroke-list {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    overflow: hidden;
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

  .page-groups {
    display: flex;
    flex-direction: column;
    gap: 10px;
    overflow-y: auto;
    flex: 1;
    min-height: 0;
    padding-right: 4px;
  }
  
  .page-group {
    background: var(--bg-tertiary);
    border-radius: 8px;
    border: 1px solid var(--border);
    overflow: hidden;
    transition: all 0.2s;
    flex-shrink: 0;
  }
  
  .page-group.expanded {
    border-color: var(--accent);
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
    background: var(--bg-secondary);
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
  
  .book-name {
    color: var(--text-primary);
    font-weight: 600;
    font-size: 0.85rem;
  }
  
  .page-number {
    color: var(--text-secondary);
    font-weight: 500;
    font-size: 0.85rem;
  }
  
  .page-stats {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  
  .stroke-count {
    font-size: 0.8rem;
    color: var(--text-secondary);
  }
  
  .selected-indicator {
    font-size: 0.8rem;
    color: var(--success);
    font-weight: 600;
  }
  
  .stroke-items {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 12px 12px 12px;
    background: var(--bg-secondary);
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
  
  .page-groups::-webkit-scrollbar {
    width: 8px;
  }
  
  .page-groups::-webkit-scrollbar-track {
    background: var(--bg-tertiary);
    border-radius: 4px;
  }
  
  .page-groups::-webkit-scrollbar-thumb {
    background: var(--border);
    border-radius: 4px;
  }
  
  .page-groups::-webkit-scrollbar-thumb:hover {
    background: var(--accent);
  }
</style>
