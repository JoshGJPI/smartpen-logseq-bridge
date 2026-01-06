<!--
  StrokeList.svelte - List view of strokes grouped by page with collapsible headers
  Now with drag-and-drop page reordering!
-->
<script>
  import { flip } from 'svelte/animate';
  import { dndzone } from 'svelte-dnd-action';
  import { strokes, strokeCount, pages } from '$stores';
  import { selectedIndices, handleStrokeClick, selectionCount } from '$stores';
  import { bookAliases } from '$stores';
  import { customPageOrder, useCustomOrder, setPageOrder, resetPageOrder, initializePageOrder } from '$stores/page-order.js';
  import { formatBookName } from '$utils/formatting.js';
  import StrokeItem from './StrokeItem.svelte';
  
  const flipDurationMs = 300;
  
  // Track expanded pages (default: all expanded)
  let expandedPages = {};
  
  // Track drag state to prevent click-to-expand during drag
  let isDragging = false;
  let dragStartPos = { x: 0, y: 0 };
  
  // Group strokes by page with their original indices
  $: strokesByPageMap = (() => {
    const grouped = new Map();
    
    $strokes.forEach((stroke, index) => {
      const pageInfo = stroke.pageInfo || {};
      const pageKey = `S${pageInfo.section || 0}/O${pageInfo.owner || 0}/B${pageInfo.book || 0}/P${pageInfo.page || 0}`;
      
      if (!grouped.has(pageKey)) {
        grouped.set(pageKey, {
          id: pageKey, // Required by svelte-dnd-action
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
    
    return grouped;
  })();
  
  // Apply sorting: custom order if enabled, otherwise auto-sort
  $: strokesByPage = (() => {
    const groupsArray = Array.from(strokesByPageMap.values());
    
    if ($useCustomOrder && $customPageOrder.length > 0) {
      // Use custom order - map pageKeys to groups
      const ordered = [];
      $customPageOrder.forEach(pageKey => {
        const group = strokesByPageMap.get(pageKey);
        if (group) ordered.push(group);
      });
      
      // Append any new pages that aren't in custom order yet
      groupsArray.forEach(group => {
        if (!ordered.find(g => g.pageKey === group.pageKey)) {
          ordered.push(group);
        }
      });
      
      return ordered;
    } else {
      // Default: auto-sort by book, then page
      return groupsArray.sort((a, b) => {
        if (a.book !== b.book) return a.book - b.book;
        return a.page - b.page;
      });
    }
  })();
  
  // Initialize custom order when pages change
  $: if (strokesByPage.length > 0) {
    const pageKeys = strokesByPage.map(g => g.pageKey);
    initializePageOrder(pageKeys);
  }
  
  // Initialize expanded state for all pages
  $: if (strokesByPage.length > 0) {
    strokesByPage.forEach(group => {
      if (expandedPages[group.pageKey] === undefined) {
        expandedPages[group.pageKey] = true; // Default: expanded
      }
    });
  }
  
  // Toggle page expansion (only if not dragging)
  function togglePage(pageKey, event) {
    // Prevent toggle if this was a drag operation
    if (isDragging) {
      isDragging = false;
      return;
    }
    
    // Prevent toggle if user clicked on stats area
    if (event.target.closest('.page-stats')) {
      return;
    }
    
    expandedPages[pageKey] = !expandedPages[pageKey];
    expandedPages = { ...expandedPages }; // Trigger reactivity
  }
  
  // Get selection count for a page
  function getPageSelectionCount(indices) {
    return indices.filter(i => $selectedIndices.has(i)).length;
  }
  
  // Handle drag and drop events
  function handleDndConsider(e) {
    isDragging = true;
    strokesByPage = e.detail.items;
  }
  
  function handleDndFinalize(e) {
    strokesByPage = e.detail.items;
    // Save the new order
    setPageOrder(strokesByPage.map(g => g.pageKey));
    
    // Reset drag state after a brief delay to prevent click event
    setTimeout(() => {
      isDragging = false;
    }, 100);
  }
  
  // Track mouse down position to detect drag vs click
  function handleMouseDown(event) {
    dragStartPos = { x: event.clientX, y: event.clientY };
  }
  
  function handleMouseUp(event, pageKey) {
    // Calculate distance moved
    const distance = Math.sqrt(
      Math.pow(event.clientX - dragStartPos.x, 2) +
      Math.pow(event.clientY - dragStartPos.y, 2)
    );
    
    // If moved less than 5 pixels, treat as click
    if (distance < 5) {
      togglePage(pageKey, event);
    }
  }
  
  // Reset to automatic sorting
  function handleResetOrder() {
    resetPageOrder();
  }
</script>

<div class="stroke-list">
  {#if $strokeCount === 0}
    <p class="empty-message">
      Connect pen and write to see strokes
    </p>
  {:else}
    <div class="list-header">
      <div class="header-info">
        <span>{$strokeCount} strokes across {strokesByPage.length} page{strokesByPage.length !== 1 ? 's' : ''}</span>
        {#if $useCustomOrder}
          <span class="custom-order-indicator" title="Custom page order active">
            ⋮⋮ Custom Order
          </span>
        {/if}
      </div>
      <div class="header-actions">
        {#if $selectionCount > 0}
          <span class="selection-badge">{$selectionCount} selected</span>
        {/if}
        {#if $useCustomOrder}
          <button 
            class="reset-btn" 
            on:click={handleResetOrder}
            title="Reset to automatic sorting (by book and page number)"
          >
            🔄 Reset Order
          </button>
        {/if}
      </div>
    </div>
    
    <div 
      class="page-groups"
      use:dndzone={{
        items: strokesByPage,
        flipDurationMs,
        dropTargetStyle: { outline: '2px solid var(--accent)', outlineOffset: '-2px' },
        dragDisabled: false
      }}
      on:consider={handleDndConsider}
      on:finalize={handleDndFinalize}
    >
      {#each strokesByPage as group (group.id)}
        {@const isExpanded = expandedPages[group.pageKey]}
        {@const selectedCount = getPageSelectionCount(group.indices)}
        
        <div 
          class="page-group" 
          class:expanded={isExpanded}
          animate:flip={{duration: flipDurationMs}}
        >
          <!-- Draggable Page Header -->
          <div 
            class="page-header-draggable"
            on:mousedown={handleMouseDown}
            on:mouseup={(e) => handleMouseUp(e, group.pageKey)}
            role="button"
            tabindex="0"
            title="Click to expand/collapse, drag to reorder"
          >
            <div class="drag-indicator">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="7" cy="6" r="1.5"/>
                <circle cx="7" cy="12" r="1.5"/>
                <circle cx="7" cy="18" r="1.5"/>
                <circle cx="17" cy="6" r="1.5"/>
                <circle cx="17" cy="12" r="1.5"/>
                <circle cx="17" cy="18" r="1.5"/>
              </svg>
            </div>
            
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
          </div>
          
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
    flex-wrap: wrap;
    gap: 8px;
  }
  
  .header-info {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  
  .custom-order-indicator {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 0.75rem;
    color: var(--accent);
    background: var(--bg-tertiary);
    padding: 2px 8px;
    border-radius: 10px;
    font-weight: 500;
  }
  
  .header-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .selection-badge {
    background: var(--accent);
    color: white;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 0.75rem;
  }
  
  .reset-btn {
    padding: 4px 10px;
    font-size: 0.75rem;
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    border: 1px solid var(--border);
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    gap: 4px;
  }
  
  .reset-btn:hover {
    background: var(--bg-secondary);
    border-color: var(--accent);
    color: var(--accent);
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
  
  .page-header-draggable {
    display: flex;
    align-items: center;
    padding: 10px 12px;
    cursor: grab;
    user-select: none;
    transition: all 0.2s;
    gap: 8px;
  }
  
  .page-header-draggable:hover {
    background: var(--bg-secondary);
  }
  
  .page-header-draggable:active {
    cursor: grabbing;
  }
  
  .drag-indicator {
    display: flex;
    align-items: center;
    color: var(--text-secondary);
    flex-shrink: 0;
    transition: color 0.2s;
  }
  
  .page-header-draggable:hover .drag-indicator {
    color: var(--accent);
  }
  
  .page-title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
    font-size: 0.9rem;
    flex: 1;
    min-width: 0;
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
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  
  .page-number {
    color: var(--text-secondary);
    font-weight: 500;
    font-size: 0.85rem;
    flex-shrink: 0;
  }
  
  .page-stats {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
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
