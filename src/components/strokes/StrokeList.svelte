<!--
  StrokeList.svelte - List view of strokes grouped by book and page with collapsible headers
-->
<script>
  import { strokes, strokeCount } from '$stores';
  import { selectionCount } from '$stores';
  import StrokeBookAccordion from './StrokeBookAccordion.svelte';
  
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
      {#if $selectionCount > 0}
        <span class="selection-badge">{$selectionCount} selected</span>
      {/if}
    </div>
    
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

  .selection-badge {
    background: var(--accent);
    color: white;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 0.75rem;
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
