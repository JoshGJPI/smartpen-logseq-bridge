<!--
  StrokeList.svelte - List view of strokes grouped by book and page with collapsible headers
-->
<script>
  import { strokes, strokeCount, logseqConnected } from '$stores';
  import { selectionCount } from '$stores';
  import StrokeBookAccordion from './StrokeBookAccordion.svelte';
  import { importStrokesForLoadedPages } from '../../lib/logseq-import.js';
  
  // Import progress tracking
  let isImporting = false;
  let importProgress = { message: '', current: 0, total: 0 };
  
  // Group strokes by book, then by page
  $: strokesByBook = (() => {
    const bookMap = new Map();
    
    $strokes.forEach((stroke, index) => {
      const pageInfo = stroke.pageInfo || {};
      const book = pageInfo.book || 0;
      const page = pageInfo.page || 0;
      const pageKey = `S${pageInfo.section || 0}/O${pageInfo.owner || 0}/B${book}/P${page}`;
      
      // Create book entry if it doesn't exist
      if (!bookMap.has(book)) {
        bookMap.set(book, {
          bookId: book,
          pages: new Map()
        });
      }
      
      const bookEntry = bookMap.get(book);
      
      // Create page entry if it doesn't exist
      if (!bookEntry.pages.has(pageKey)) {
        bookEntry.pages.set(pageKey, {
          pageInfo,
          pageKey,
          strokes: [],
          indices: [],
          book,
          page
        });
      }
      
      const pageEntry = bookEntry.pages.get(pageKey);
      pageEntry.strokes.push(stroke);
      pageEntry.indices.push(index);
    });
    
    // Convert to array and sort
    const booksArray = Array.from(bookMap.values()).map(bookEntry => ({
      bookId: bookEntry.bookId,
      pages: Array.from(bookEntry.pages.values()).sort((a, b) => a.page - b.page)
    }));
    
    // Sort books by ID
    return booksArray.sort((a, b) => a.bookId - b.bookId);
  })();
  
  // Calculate total page count
  $: totalPages = strokesByBook.reduce((sum, book) => sum + book.pages.length, 0);
  
  // Handle import from LogSeq
  async function handleImportFromLogSeq() {
    if (!$logseqConnected) {
      return; // Button should be disabled, but double-check
    }
    
    isImporting = true;
    importProgress = { message: 'Starting import...', current: 0, total: 0 };
    
    try {
      await importStrokesForLoadedPages((message, current, total) => {
        importProgress = { message, current, total };
      });
    } finally {
      isImporting = false;
      importProgress = { message: '', current: 0, total: 0 };
    }
  }
</script>

<div class="stroke-list">
  {#if $strokeCount === 0}
    <p class="empty-message">
      Connect pen and write to see strokes
    </p>
  {:else}
    <div class="list-header">
      <span>
        {$strokeCount} strokes across {strokesByBook.length} {strokesByBook.length === 1 ? 'book' : 'books'}
        ({totalPages} {totalPages === 1 ? 'page' : 'pages'})
      </span>
      <div class="header-actions">
        {#if $selectionCount > 0}
          <span class="selection-badge">{$selectionCount} selected</span>
        {/if}
        <button 
          class="import-button"
          on:click={handleImportFromLogSeq}
          disabled={!$logseqConnected || isImporting}
          title={!$logseqConnected ? 'Connect to LogSeq first' : 'Import additional strokes from LogSeq for currently loaded pages'}
        >
          {#if isImporting}
            <span class="spinner"></span>
            Importing...
          {:else}
            ⬇ Import from LogSeq
          {/if}
        </button>
      </div>
    </div>
    
    {#if isImporting && importProgress.total > 0}
      <div class="import-progress">
        <div class="progress-bar">
          <div 
            class="progress-fill" 
            style="width: {(importProgress.current / importProgress.total) * 100}%"
          ></div>
        </div>
        <div class="progress-text">
          {importProgress.message} ({importProgress.current}/{importProgress.total})
        </div>
      </div>
    {/if}
    
    <div class="book-list">
      {#each strokesByBook as book (book.bookId)}
        <StrokeBookAccordion 
          bookId={book.bookId} 
          pages={book.pages}
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

  .header-actions {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .selection-badge {
    background: var(--accent);
    color: white;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 0.75rem;
  }

  .import-button {
    padding: 4px 12px;
    background: var(--accent);
    color: white;
    border: none;
    border-radius: 4px;
    font-size: 0.75rem;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
  }

  .import-button:hover:not(:disabled) {
    background: var(--accent-hover);
    transform: translateY(-1px);
  }

  .import-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .spinner {
    width: 12px;
    height: 12px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .import-progress {
    padding: 8px 0;
    margin-bottom: 8px;
    border-bottom: 1px solid var(--border);
  }

  .progress-bar {
    width: 100%;
    height: 4px;
    background: var(--bg-tertiary);
    border-radius: 2px;
    overflow: hidden;
    margin-bottom: 4px;
  }

  .progress-fill {
    height: 100%;
    background: var(--accent);
    transition: width 0.3s ease;
  }

  .progress-text {
    font-size: 0.75rem;
    color: var(--text-secondary);
    text-align: center;
  }

  .book-list {
    flex: 1;
    overflow-y: auto;
    padding: 0;
  }
  
  .book-list::-webkit-scrollbar {
    width: 8px;
  }
  
  .book-list::-webkit-scrollbar-track {
    background: var(--bg-tertiary);
    border-radius: 4px;
  }
  
  .book-list::-webkit-scrollbar-thumb {
    background: var(--border);
    border-radius: 4px;
  }
  
  .book-list::-webkit-scrollbar-thumb:hover {
    background: var(--accent);
  }
</style>
