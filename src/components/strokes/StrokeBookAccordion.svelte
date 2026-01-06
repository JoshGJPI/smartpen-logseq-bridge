<!--
  StrokeBookAccordion.svelte - Collapsible book section with pages for strokes view
-->
<script>
  import { bookAliases } from '$stores';
  import { formatBookName, getBookColor } from '$utils/formatting.js';
  import StrokePageCard from './StrokePageCard.svelte';
  
  export let bookId;  // Book number
  export let pages;   // Array of page objects with strokes and indices
  
  let expanded = false;
  
  function toggleExpanded() {
    expanded = !expanded;
  }
  
  // Calculate total strokes across all pages in this book
  $: totalStrokes = pages.reduce((sum, page) => sum + page.strokes.length, 0);
  
  // Get book color
  $: bookColor = getBookColor(bookId, 1.0); // Full opacity for text
  
  // Format book name parts
  $: bookAlias = $bookAliases[bookId];
  $: bookIdText = `B${bookId}`;
</script>

<div class="book-accordion">
  <button 
    class="book-header" 
    class:expanded
    on:click={toggleExpanded}
  >
    <span class="book-icon">📚</span>
    <span class="book-title">
      {#if bookAlias}
        {bookAlias} <span class="book-id" style="color: {bookColor}">({bookIdText})</span>
      {:else}
        <span class="book-id" style="color: {bookColor}">{bookIdText}</span>
      {/if}
    </span>
    <span class="page-count">
      {pages.length} {pages.length === 1 ? 'page' : 'pages'}
      <span class="stroke-count-inline">({totalStrokes} strokes)</span>
    </span>
    <span class="toggle-icon">{expanded ? '▼' : '▶'}</span>
  </button>
  
  {#if expanded}
    <div class="book-content">
      {#each pages as page (page.pageKey)}
        <StrokePageCard {page} />
      {/each}
    </div>
  {/if}
</div>

<style>
  .book-accordion {
    margin-bottom: 12px;
  }
  
  .book-header {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color, rgba(255, 255, 255, 0.1));
    border-radius: 8px;
    color: var(--text-primary);
    cursor: pointer;
    text-align: left;
    transition: all 0.2s;
  }
  
  .book-header.expanded {
    border-radius: 8px 8px 0 0;
    border-bottom: none;
  }
  
  .book-header:hover:not(.expanded) {
    background: var(--bg-tertiary);
  }
  
  .book-icon {
    font-size: 1.2rem;
  }
  
  .book-title {
    font-weight: 600;
    font-size: 1rem;
    flex: 1;
  }
  
  .book-id {
    font-weight: 700;
  }
  
  .page-count {
    font-size: 0.75rem;
    color: var(--text-tertiary);
    padding: 4px 10px;
    background: var(--bg-tertiary);
    border-radius: 12px;
    font-weight: 500;
  }
  
  .stroke-count-inline {
    color: var(--text-secondary);
    margin-left: 4px;
  }
  
  .toggle-icon {
    font-size: 0.75rem;
    color: var(--text-secondary);
  }
  
  .book-content {
    padding: 16px;
    margin-top: 0;
    background: var(--bg-secondary);
    border: 2px solid rgba(100, 150, 255, 0.4);
    border-top: none;
    border-radius: 0 0 8px 8px;
  }
</style>
