<!--
  PageSelector.svelte - Compact multi-select page/book filter with checkboxes
-->
<script>
  import { createEventDispatcher } from 'svelte';
  import { pages } from '$stores';
  
  const dispatch = createEventDispatcher();
  
  // Selected page keys (Set for efficient lookup)
  export let selectedPages = new Set();
  
  // Derive page options from the pages store
  $: pageOptions = Array.from($pages.keys());
  
  // Track which pages have been seen to auto-add new pages
  let previousPageOptions = [];
  
  // Auto-add new pages to selection when they appear
  $: {
    // On first load, select all pages
    if (pageOptions.length > 0 && previousPageOptions.length === 0) {
      selectedPages = new Set(pageOptions);
      dispatch('change', { selectedPages: new Set(pageOptions) });
      previousPageOptions = [...pageOptions];
    } 
    // On subsequent updates, add any new pages that weren't previously tracked
    else if (pageOptions.length > previousPageOptions.length) {
      const newPages = pageOptions.filter(p => !previousPageOptions.includes(p));
      if (newPages.length > 0) {
        selectedPages = new Set([...selectedPages, ...newPages]);
        dispatch('change', { selectedPages: new Set([...selectedPages]) });
        previousPageOptions = [...pageOptions];
      }
    }
    // Handle case where pages are removed (e.g., strokes cleared)
    else if (pageOptions.length < previousPageOptions.length) {
      // Clean up selectedPages to only include pages that still exist
      const validPages = pageOptions.filter(p => selectedPages.has(p));
      selectedPages = new Set(validPages);
      dispatch('change', { selectedPages: new Set(validPages) });
      previousPageOptions = [...pageOptions];
    }
  }
  
  // Group pages by book for better organization
  $: pagesByBook = (() => {
    const grouped = new Map();
    pageOptions.forEach(pageKey => {
      // Parse page key: S{section}/O{owner}/B{book}/P{page}
      const match = pageKey.match(/S(\d+)\/O(\d+)\/B(\d+)\/P(\d+)/);
      if (match) {
        const [, section, owner, book, page] = match;
        const bookKey = `B${book}`;
        if (!grouped.has(bookKey)) {
          grouped.set(bookKey, {
            section,
            owner,
            book,
            pages: []
          });
        }
        grouped.get(bookKey).pages.push({
          key: pageKey,
          page: parseInt(page),
          label: `P${page}`
        });
      }
    });
    
    // Sort pages within each book
    grouped.forEach(bookData => {
      bookData.pages.sort((a, b) => a.page - b.page);
    });
    
    return grouped;
  })();
  
  // Check if all pages in a book are selected
  function isBookFullySelected(bookKey) {
    const bookData = pagesByBook.get(bookKey);
    if (!bookData) return false;
    return bookData.pages.every(p => selectedPages.has(p.key));
  }
  
  // Check if some (but not all) pages in a book are selected
  function isBookPartiallySelected(bookKey) {
    const bookData = pagesByBook.get(bookKey);
    if (!bookData) return false;
    const selectedCount = bookData.pages.filter(p => selectedPages.has(p.key)).length;
    return selectedCount > 0 && selectedCount < bookData.pages.length;
  }
  
  // Toggle a single page
  function togglePage(pageKey) {
    const newSelected = new Set(selectedPages);
    if (newSelected.has(pageKey)) {
      newSelected.delete(pageKey);
    } else {
      newSelected.add(pageKey);
    }
    selectedPages = newSelected;
    dispatch('change', { selectedPages: newSelected });
  }
  
  // Toggle all pages in a book
  function toggleBook(bookKey) {
    const bookData = pagesByBook.get(bookKey);
    if (!bookData) return;
    
    const newSelected = new Set(selectedPages);
    const allSelected = isBookFullySelected(bookKey);
    
    bookData.pages.forEach(p => {
      if (allSelected) {
        newSelected.delete(p.key);
      } else {
        newSelected.add(p.key);
      }
    });
    
    selectedPages = newSelected;
    dispatch('change', { selectedPages: newSelected });
  }
  
  // Select all pages
  function selectAll() {
    const newSelected = new Set(pageOptions);
    selectedPages = newSelected;
    dispatch('change', { selectedPages: newSelected });
  }
  
  // Clear all selections (hide all)
  function clearAll() {
    selectedPages = new Set();
    dispatch('change', { selectedPages: new Set() });
  }
  
  // Count selected pages
  $: selectedCount = selectedPages.size;
  $: totalCount = pageOptions.length;
  $: showingAll = selectedCount === totalCount && totalCount > 0;
  
  // Color palette matching canvas-renderer.js
  const pageColors = [
    'rgba(233, 69, 96, 0.8)',   // Red
    'rgba(75, 192, 192, 0.8)',  // Teal
    'rgba(255, 205, 86, 0.8)',  // Yellow
    'rgba(153, 102, 255, 0.8)', // Purple
    'rgba(255, 159, 64, 0.8)',  // Orange
    'rgba(54, 162, 235, 0.8)',  // Blue
    'rgba(255, 99, 132, 0.8)',  // Pink
    'rgba(76, 175, 80, 0.8)',   // Green
    'rgba(121, 85, 72, 0.8)',   // Brown
    'rgba(158, 158, 158, 0.8)', // Gray
  ];
  
  /**
   * Get color for a book ID (matching canvas-renderer.js logic)
   * @param {string} bookId - Book ID
   * @returns {string} RGBA color string
   */
  function getBookColor(bookId) {
    // Simple hash to get consistent color
    let hash = 0;
    const str = String(bookId);
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const colorIndex = Math.abs(hash) % pageColors.length;
    return pageColors[colorIndex];
  }
</script>

<div class="page-selector">
  <div class="selector-header">
    <span class="label">Filter:</span>
    <span class="count">
      {#if showingAll}
        All ({totalCount})
      {:else}
        {selectedCount}/{totalCount}
      {/if}
    </span>
    <button class="mini-btn" on:click={selectAll} title="Select all (show all)">All</button>
    <button class="mini-btn" on:click={clearAll} title="Clear all (hide all)">None</button>
  </div>
  
  {#if pageOptions.length === 0}
    <div class="empty-message">No pages</div>
  {:else}
    <div class="books-container">
      {#each Array.from(pagesByBook.entries()) as [bookKey, bookData] (bookKey)}
        <div class="book-group">
          <label class="book-header" title="Toggle all pages in {bookKey}">
            <input 
              type="checkbox"
              checked={isBookFullySelected(bookKey)}
              indeterminate={isBookPartiallySelected(bookKey)}
              on:change={() => toggleBook(bookKey)}
            />
            <span class="book-label" style="color: {getBookColor(bookData.book)}">{bookKey}</span>
          </label>
          
          <div class="pages-list">
            {#each bookData.pages as pageInfo (pageInfo.key)}
              <label class="page-checkbox" title="{pageInfo.key}">
                <input 
                  type="checkbox"
                  checked={selectedPages.has(pageInfo.key)}
                  on:change={() => togglePage(pageInfo.key)}
                />
                <span class="page-label">{pageInfo.label}</span>
              </label>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .page-selector {
    background: var(--bg-tertiary);
    border-radius: 6px;
    padding: 8px;
    min-width: 0;
  }
  
  .selector-header {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 6px;
  }
  
  .label {
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--text-secondary);
  }
  
  .count {
    font-size: 0.7rem;
    color: var(--text-secondary);
    margin-right: auto;
  }
  
  .mini-btn {
    padding: 2px 6px;
    font-size: 0.65rem;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: var(--bg-secondary);
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.15s;
  }
  
  .mini-btn:hover {
    background: var(--bg-primary);
    border-color: var(--accent);
    color: var(--accent);
  }
  
  .empty-message {
    font-size: 0.75rem;
    color: var(--text-secondary);
    text-align: center;
  }
  
  .books-container {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    max-height: 80px;
    overflow-y: auto;
  }
  
  .book-group {
    background: var(--bg-secondary);
    border-radius: 4px;
    padding: 4px 6px;
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  
  .book-header {
    display: flex;
    align-items: center;
    gap: 3px;
    cursor: pointer;
  }
  
  .book-header input[type="checkbox"] {
    width: 12px;
    height: 12px;
    cursor: pointer;
    accent-color: var(--accent);
  }
  
  .book-label {
    font-size: 0.75rem;
    font-weight: 600;
    /* Color is set dynamically via inline style */
  }
  
  .pages-list {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
  }
  
  .page-checkbox {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 2px 4px;
    background: var(--bg-tertiary);
    border-radius: 3px;
    cursor: pointer;
    transition: background 0.15s;
  }
  
  .page-checkbox:hover {
    background: var(--bg-primary);
  }
  
  .page-checkbox input[type="checkbox"] {
    width: 10px;
    height: 10px;
    cursor: pointer;
    accent-color: var(--accent);
  }
  
  .page-label {
    font-size: 0.7rem;
    color: var(--text-primary);
  }
</style>
