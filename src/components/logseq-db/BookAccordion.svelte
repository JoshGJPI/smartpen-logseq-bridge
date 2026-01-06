<!--
  BookAccordion.svelte - Collapsible book section with pages
-->
<script>
  import { bookAliases } from '$stores';
  import { formatBookName } from '$utils/formatting.js';
  import { importStrokesFromLogSeq } from '$lib/logseq-import.js';
  import PageCard from './PageCard.svelte';
  
  export let bookId; // Book number
  export let pages;  // Array of page data objects
  
  let expanded = false;
  let importingAll = false;
  let importProgress = { current: 0, total: 0, currentPage: 0, totalPages: 0 };
  
  function toggleExpanded() {
    expanded = !expanded;
  }
  
  async function handleImportAll() {
    importingAll = true;
    const totalPages = pages.length;
    importProgress = { current: 0, total: 0, currentPage: 0, totalPages };
    
    let successCount = 0;
    let failCount = 0;
    
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      importProgress.currentPage = i + 1;
      
      try {
        const result = await importStrokesFromLogSeq(page, (current, total) => {
          importProgress = { 
            current, 
            total, 
            currentPage: i + 1, 
            totalPages 
          };
        });
        
        if (result.success) {
          successCount++;
        } else {
          failCount++;
        }
      } catch (error) {
        console.error(`Failed to import page ${page.page}:`, error);
        failCount++;
      }
    }
    
    importingAll = false;
    importProgress = { current: 0, total: 0, currentPage: 0, totalPages: 0 };
    
    console.log(`Import complete: ${successCount} successful, ${failCount} failed`);
  }
</script>

<div class="book-accordion">
  <button 
    class="book-header" 
    class:expanded
    on:click={toggleExpanded}
  >
    <span class="book-icon">📚</span>
    <span class="book-title">{formatBookName(bookId, $bookAliases, 'full')}</span>
    <button 
      class="page-count-btn"
      on:click|stopPropagation={handleImportAll}
      disabled={importingAll || pages.length === 0}
      title="Import all pages from this book"
    >
      {#if importingAll}
        <span class="spinner">⏳</span>
        {#if importProgress.totalPages > 0}
          {importProgress.currentPage}/{importProgress.totalPages}
          {#if importProgress.total > 0}
            ({importProgress.current}/{importProgress.total})
          {/if}
        {:else}
          Loading...
        {/if}
      {:else}
        <span class="import-icon">📥</span>
        {pages.length} {pages.length === 1 ? 'page' : 'pages'}
      {/if}
    </button>
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
  
  .book-header.expanded {
    border-radius: 8px 8px 0 0; /* Round only top corners when expanded */
    border-bottom: none; /* Remove bottom border when expanded */
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
  
  .page-count-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 0.75rem;
    color: var(--text-tertiary);
    padding: 4px 10px;
    background: var(--bg-tertiary);
    border: 1px solid transparent;
    border-radius: 12px;
    cursor: pointer;
    transition: all 0.2s;
    font-weight: 500;
  }
  
  .page-count-btn:hover:not(:disabled) {
    background: var(--accent-color, #2196f3);
    color: white;
    border-color: var(--accent-color, #2196f3);
    transform: translateY(-1px);
  }
  
  .page-count-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  .import-icon {
    font-size: 0.875rem;
  }
  
  .toggle-icon {
    font-size: 0.75rem;
    color: var(--text-secondary);
  }
  
  .spinner {
    animation: spin 1s linear infinite;
  }
  
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  
  .book-content {
    padding: 16px;
    margin-top: 0; /* No gap - connect to header */
    background: var(--bg-secondary);
    border: 2px solid rgba(100, 150, 255, 0.4); /* Blue tinted border */
    border-top: none; /* No top border - connects to header */
    border-radius: 0 0 8px 8px; /* Round only bottom corners */
  }
</style>
