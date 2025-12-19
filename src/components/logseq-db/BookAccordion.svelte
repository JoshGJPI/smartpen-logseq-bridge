<!--
  BookAccordion.svelte - Collapsible book section with pages
-->
<script>
  import PageCard from './PageCard.svelte';
  
  export let bookId; // Book number
  export let pages;  // Array of page data objects
  
  let expanded = false;
  
  function toggleExpanded() {
    expanded = !expanded;
  }
</script>

<div class="book-accordion">
  <button class="book-header" on:click={toggleExpanded}>
    <span class="book-icon">📚</span>
    <span class="book-title">Book {bookId}</span>
    <span class="page-count">{pages.length} {pages.length === 1 ? 'page' : 'pages'}</span>
    <span class="toggle-icon">{expanded ? '▼' : '▶'}</span>
  </button>
  
  {#if expanded}
    <div class="book-content">
      {#each pages as page (page.pageName)}
        <PageCard {page} />
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
  
  .book-header:hover {
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
  
  .page-count {
    font-size: 0.75rem;
    color: var(--text-tertiary);
    padding: 2px 8px;
    background: var(--bg-tertiary);
    border-radius: 12px;
  }
  
  .toggle-icon {
    font-size: 0.75rem;
    color: var(--text-secondary);
  }
  
  .book-content {
    padding: 8px 0 0 16px;
    margin-left: 12px;
    border-left: 2px solid var(--bg-tertiary);
  }
</style>
