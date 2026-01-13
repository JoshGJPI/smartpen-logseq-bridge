<!--
  PenMemoryDialog.svelte - Modal dialog for managing pen memory and deleting books
-->
<script>
  import { onDestroy } from 'svelte';
  import { penConnected, penController } from '$stores/pen.js';
  import { log } from '$stores/ui.js';
  import { deleteBooksFromPen } from '$lib/pen-sdk.js';
  
  // Props
  export let visible = false;
  export let onClose = () => {};
  
  // State
  let state = 'loading';  // 'loading' | 'selection' | 'confirming' | 'deleting' | 'success' | 'error'
  let books = [];
  let selectedBooks = new Set();
  let deletionProgress = { current: 0, total: 0 };
  let deletionResults = null;
  let errorMessage = '';
  
  // Load books when dialog opens
  $: if (visible && $penConnected) {
    loadBooks();
  }
  
  async function loadBooks() {
    state = 'loading';
    errorMessage = '';
    
    try {
      log('🗑️ Requesting pen memory status...', 'info');
      
      // Request note list from pen
      const controller = $penController;
      if (!controller) {
        throw new Error('No pen controller available');
      }
      
      // Set up one-time listener for note list
      const noteListPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Timeout waiting for pen response'));
        }, 15000);
        
        // This will be called by handleOfflineNoteList in pen-sdk.js
        window.__pendingNoteListResolver = (noteList) => {
          clearTimeout(timeout);
          resolve(noteList);
        };
      });
      
      controller.RequestOfflineNoteList();
      
      const noteList = await noteListPromise;
      
      if (!noteList || noteList.length === 0) {
        books = [];
        state = 'selection';
        log('ℹ️ No books found in pen memory', 'info');
        return;
      }
      
      books = noteList;
      selectedBooks = new Set();
      state = 'selection';
      
      log(`ℹ️ Found ${books.length} book(s) in pen memory`, 'info');
      
    } catch (error) {
      console.error('Failed to load books:', error);
      errorMessage = error.message;
      state = 'error';
      log(`❌ Failed to load pen memory: ${error.message}`, 'error');
    }
  }
  
  function toggleBook(index) {
    const newSet = new Set(selectedBooks);
    if (newSet.has(index)) {
      newSet.delete(index);
    } else {
      newSet.add(index);
    }
    selectedBooks = newSet;
  }
  
  function selectAll() {
    selectedBooks = new Set(books.map((_, i) => i));
  }
  
  function selectNone() {
    selectedBooks = new Set();
  }
  
  function handleDeleteClick() {
    if (selectedBooks.size === 0) return;
    state = 'confirming';
  }
  
  function handleCancelConfirm() {
    state = 'selection';
  }
  
  async function handleConfirmDelete() {
    const booksToDelete = books.filter((_, i) => selectedBooks.has(i));
    
    state = 'deleting';
    deletionProgress = { current: 0, total: booksToDelete.length };
    
    try {
      // Call deletion function
      const results = await deleteBooksFromPen(booksToDelete);
      
      deletionResults = results;
      state = 'success';
      
      // Auto-close after 3 seconds
      setTimeout(() => {
        handleClose();
      }, 3000);
      
    } catch (error) {
      console.error('Deletion failed:', error);
      errorMessage = error.message;
      state = 'error';
      log(`❌ Deletion failed: ${error.message}`, 'error');
    }
  }
  
  function handleClose() {
    visible = false;
    state = 'loading';
    books = [];
    selectedBooks = new Set();
    deletionResults = null;
    errorMessage = '';
    onClose();
  }
  
  function handleKeyDown(event) {
    if (event.key === 'Escape' && state === 'selection') {
      handleClose();
    }
  }
  
  function formatBookInfo(book) {
    return `Book ${book.Note}`;
  }
  
  function formatBookMeta(book) {
    const section = `Section ${book.Section}`;
    const owner = `Owner ${book.Owner}`;
    return `${section} / ${owner}`;
  }
  
  // Cleanup on unmount
  onDestroy(() => {
    if (window.__pendingNoteListResolver) {
      window.__pendingNoteListResolver = null;
    }
  });
</script>

<svelte:window on:keydown={handleKeyDown} />

{#if visible}
  <!-- Backdrop -->
  <div class="dialog-backdrop" on:click={state === 'selection' ? handleClose : null} role="presentation"></div>
  
  <!-- Dialog -->
  <div class="dialog" class:wide={state === 'success'} role="dialog" aria-modal="true" aria-labelledby="dialog-title">
    <!-- Loading State -->
    {#if state === 'loading'}
      <div class="dialog-header">
        <h2 id="dialog-title">🗑️ Manage Pen Memory</h2>
      </div>
      <div class="dialog-body centered">
        <div class="spinner"></div>
        <p>Loading books from pen...</p>
      </div>
    
    <!-- Selection State -->
    {:else if state === 'selection'}
      <div class="dialog-header">
        <h2 id="dialog-title">🗑️ Manage Pen Memory</h2>
        <button class="close-btn" on:click={handleClose} aria-label="Close">✕</button>
      </div>
      
      <div class="dialog-body">
        {#if books.length === 0}
          <div class="empty-state">
            <p>📭 No books found in pen memory</p>
            <p class="helper-text">Your pen memory is empty.</p>
          </div>
        {:else}
          <p class="info-text">
            Select books to delete from pen memory:
          </p>
          
          <div class="selection-controls">
            <button class="btn-link" on:click={selectAll}>Select All</button>
            <span class="separator">|</span>
            <button class="btn-link" on:click={selectNone}>Deselect All</button>
            <span class="selected-count">
              ({selectedBooks.size} selected)
            </span>
          </div>
          
          <div class="book-list">
            {#each books as book, i}
              <label class="book-item" class:selected={selectedBooks.has(i)}>
                <input 
                  type="checkbox" 
                  checked={selectedBooks.has(i)}
                  on:change={() => toggleBook(i)}
                />
                <div class="book-info">
                  <div class="book-title">{formatBookInfo(book)}</div>
                  <div class="book-meta">{formatBookMeta(book)}</div>
                </div>
              </label>
            {/each}
          </div>
          
          <div class="warning-box">
            ⚠️ This will permanently delete books from pen memory. This action cannot be undone.
          </div>
        {/if}
      </div>
      
      <div class="dialog-footer">
        <button class="btn btn-secondary" on:click={handleClose}>
          Cancel
        </button>
        <button 
          class="btn btn-danger" 
          on:click={handleDeleteClick}
          disabled={selectedBooks.size === 0}
        >
          Delete Selected Books ({selectedBooks.size})
        </button>
      </div>
    
    <!-- Confirmation State -->
    {:else if state === 'confirming'}
      <div class="dialog-header">
        <h2 id="dialog-title">⚠️ Permanently Delete from Pen?</h2>
      </div>
      
      <div class="dialog-body">
        <p class="confirm-text">
          You are about to delete these books from pen memory:
        </p>
        
        <div class="confirm-list">
          {#each books.filter((_, i) => selectedBooks.has(i)) as book}
            <div class="confirm-item">
              • {formatBookInfo(book)}
            </div>
          {/each}
        </div>
        
        <div class="warning-box danger">
          ⚠️ This action cannot be undone. The data will be permanently removed from your pen.
        </div>
      </div>
      
      <div class="dialog-footer">
        <button class="btn btn-secondary" on:click={handleCancelConfirm}>
          Cancel
        </button>
        <button class="btn btn-danger" on:click={handleConfirmDelete}>
          Yes, Delete from Pen
        </button>
      </div>
    
    <!-- Deleting State -->
    {:else if state === 'deleting'}
      <div class="dialog-header">
        <h2 id="dialog-title">🗑️ Deleting from Pen Memory</h2>
      </div>
      
      <div class="dialog-body centered">
        <p class="progress-text">
          Deleting books from pen...
        </p>
        <div class="spinner"></div>
        <p class="helper-text">Please wait...</p>
      </div>
    
    <!-- Success State -->
    {:else if state === 'success'}
      <div class="dialog-header">
        <h2 id="dialog-title">✅ Deletion Complete</h2>
        <button class="close-btn" on:click={handleClose} aria-label="Close">✕</button>
      </div>
      
      <div class="dialog-body">
        <p class="success-text">
          Successfully deleted {deletionResults.deletedBooks.length} book(s) from pen memory.
        </p>
        
        <div class="success-list">
          {#each deletionResults.deletedBooks as book}
            <div class="success-item">
              ✓ {formatBookInfo(book)}
            </div>
          {/each}
        </div>
        
        {#if deletionResults.failedBooks.length > 0}
          <div class="warning-box">
            ⚠️ Failed to delete {deletionResults.failedBooks.length} book(s)
          </div>
        {/if}
      </div>
      
      <div class="dialog-footer">
        <button class="btn btn-primary" on:click={handleClose}>
          Close
        </button>
      </div>
    
    <!-- Error State -->
    {:else if state === 'error'}
      <div class="dialog-header">
        <h2 id="dialog-title">❌ Error</h2>
        <button class="close-btn" on:click={handleClose} aria-label="Close">✕</button>
      </div>
      
      <div class="dialog-body">
        <div class="error-box">
          {errorMessage}
        </div>
      </div>
      
      <div class="dialog-footer">
        <button class="btn btn-secondary" on:click={handleClose}>
          Close
        </button>
        <button class="btn btn-primary" on:click={loadBooks}>
          Try Again
        </button>
      </div>
    {/if}
  </div>
{/if}

<style>
  .dialog-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.75);
    z-index: 1000;
    animation: fadeIn 0.2s ease;
  }
  
  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  
  .dialog {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
    min-width: 500px;
    max-width: 600px;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    z-index: 1001;
    animation: slideIn 0.3s ease;
  }
  
  .dialog.wide {
    min-width: 550px;
  }
  
  @keyframes slideIn {
    from {
      opacity: 0;
      transform: translate(-50%, -48%);
    }
    to {
      opacity: 1;
      transform: translate(-50%, -50%);
    }
  }
  
  .dialog-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 20px 24px;
    border-bottom: 1px solid var(--border);
  }
  
  .dialog-header h2 {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--text-primary);
  }
  
  .close-btn {
    background: none;
    border: none;
    font-size: 1.5rem;
    color: var(--text-secondary);
    cursor: pointer;
    padding: 4px 8px;
    line-height: 1;
    border-radius: 4px;
    transition: all 0.2s;
  }
  
  .close-btn:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }
  
  .dialog-body {
    padding: 20px 24px;
    overflow-y: auto;
    flex: 1;
  }
  
  .dialog-body.centered {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
  }
  
  .info-text {
    margin-bottom: 16px;
    color: var(--text-secondary);
    font-size: 0.9rem;
  }
  
  .selection-controls {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 16px;
    padding: 12px;
    background: var(--bg-tertiary);
    border-radius: 6px;
  }
  
  .btn-link {
    background: none;
    border: none;
    color: var(--accent);
    cursor: pointer;
    font-size: 0.875rem;
    font-weight: 500;
    padding: 0;
    transition: color 0.2s;
  }
  
  .btn-link:hover {
    color: var(--accent-hover);
    text-decoration: underline;
  }
  
  .separator {
    color: var(--border);
  }
  
  .selected-count {
    color: var(--text-secondary);
    font-size: 0.875rem;
    margin-left: auto;
  }
  
  .book-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: 400px;
    overflow-y: auto;
    margin-bottom: 16px;
  }
  
  .book-item {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 14px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--bg-tertiary);
    cursor: pointer;
    transition: all 0.2s;
  }
  
  .book-item:hover {
    background: var(--bg-secondary);
    border-color: var(--accent);
  }
  
  .book-item.selected {
    border-color: var(--accent);
    background: rgba(233, 69, 96, 0.1);
  }
  
  .book-item input[type="checkbox"] {
    margin-top: 2px;
    cursor: pointer;
    width: 18px;
    height: 18px;
    flex-shrink: 0;
    accent-color: var(--accent);
  }
  
  .book-info {
    flex: 1;
  }
  
  .book-title {
    font-weight: 500;
    color: var(--text-primary);
    font-size: 0.9rem;
    margin-bottom: 4px;
  }
  
  .book-meta {
    font-size: 0.8rem;
    color: var(--text-secondary);
  }
  
  .warning-box {
    padding: 12px 16px;
    background: rgba(251, 191, 36, 0.1);
    border: 1px solid rgba(251, 191, 36, 0.3);
    border-radius: 6px;
    color: #fbbf24;
    font-size: 0.875rem;
    line-height: 1.5;
  }
  
  .warning-box.danger {
    background: rgba(239, 68, 68, 0.1);
    border-color: rgba(239, 68, 68, 0.3);
    color: #ef4444;
  }
  
  .confirm-text {
    margin-bottom: 16px;
    color: var(--text-primary);
  }
  
  .confirm-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 16px;
    padding: 12px 16px;
    background: var(--bg-tertiary);
    border-radius: 6px;
    max-height: 200px;
    overflow-y: auto;
  }
  
  .confirm-item {
    color: var(--text-primary);
    font-size: 0.9rem;
  }
  
  .progress-text {
    font-size: 1rem;
    color: var(--text-primary);
    margin: 0;
  }
  
  .success-text {
    margin-bottom: 16px;
    color: var(--success);
    font-weight: 500;
  }
  
  .success-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 16px;
    padding: 12px 16px;
    background: rgba(34, 197, 94, 0.1);
    border: 1px solid rgba(34, 197, 94, 0.3);
    border-radius: 6px;
  }
  
  .success-item {
    color: var(--success);
    font-size: 0.9rem;
  }
  
  .helper-text {
    margin: 0;
    color: var(--text-secondary);
    font-size: 0.875rem;
  }
  
  .empty-state {
    text-align: center;
    padding: 40px 20px;
  }
  
  .empty-state p {
    margin: 0 0 8px 0;
    color: var(--text-primary);
  }
  
  .error-box {
    padding: 12px 16px;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: 6px;
    color: #ef4444;
    font-size: 0.875rem;
    line-height: 1.5;
  }
  
  .dialog-footer {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    padding: 16px 24px;
    border-top: 1px solid var(--border);
  }
  
  .btn {
    padding: 10px 20px;
    border: none;
    border-radius: 6px;
    font-size: 0.9rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }
  
  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  .btn-secondary {
    background: var(--bg-secondary);
    color: var(--text-primary);
    border: 1px solid var(--border);
  }
  
  .btn-secondary:hover:not(:disabled) {
    background: var(--bg-tertiary);
  }
  
  .btn-primary {
    background: var(--success);
    color: white;
  }
  
  .btn-primary:hover:not(:disabled) {
    background: #22c55e;
  }
  
  .btn-danger {
    background: var(--error);
    color: white;
  }
  
  .btn-danger:hover:not(:disabled) {
    background: #dc2626;
  }
  
  .spinner {
    width: 40px;
    height: 40px;
    border: 4px solid var(--bg-tertiary);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  
  /* Scrollbar styling */
  .book-list::-webkit-scrollbar,
  .confirm-list::-webkit-scrollbar {
    width: 8px;
  }
  
  .book-list::-webkit-scrollbar-track,
  .confirm-list::-webkit-scrollbar-track {
    background: var(--bg-tertiary);
    border-radius: 4px;
  }
  
  .book-list::-webkit-scrollbar-thumb,
  .confirm-list::-webkit-scrollbar-thumb {
    background: var(--border);
    border-radius: 4px;
  }
  
  .book-list::-webkit-scrollbar-thumb:hover,
  .confirm-list::-webkit-scrollbar-thumb:hover {
    background: var(--accent);
  }
</style>
