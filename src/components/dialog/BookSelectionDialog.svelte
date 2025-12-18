<!--
  BookSelectionDialog.svelte - Modal dialog for selecting which books to import
-->
<script>
  import { bookSelectionDialog } from '$stores/ui.js';
  
  $: ({ isOpen, books, onConfirm, onCancel } = $bookSelectionDialog);
  
  // Local state for checkbox selections
  let selectedBooks = new Set();
  let lastBookCount = 0;
  
  // Reset selections when dialog opens with new books (not on every render)
  $: if (isOpen && books.length > 0 && books.length !== lastBookCount) {
    lastBookCount = books.length;
    selectedBooks = new Set(books.map((_, i) => i));
  }
  
  // Reset tracking when dialog closes
  $: if (!isOpen) {
    lastBookCount = 0;
  }
  
  function toggleBook(index) {
    // Create a new Set to trigger reactivity properly
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
  
  function handleConfirm() {
    const selected = books.filter((_, i) => selectedBooks.has(i));
    onConfirm(selected);
  }
  
  function handleCancel() {
    onCancel();
  }
  
  function formatBookInfo(note) {
    return `Section ${note.Section} / Owner ${note.Owner} / Book ${note.Note}`;
  }
  
  function formatPageCount(note) {
    return note.PageCount ? `${note.PageCount} page${note.PageCount !== 1 ? 's' : ''}` : 'Unknown pages';
  }
</script>

{#if isOpen}
  <!-- Modal overlay -->
  <div class="modal-overlay" on:click={handleCancel}>
    <!-- Modal content -->
    <div class="modal-content" on:click|stopPropagation>
      <div class="modal-header">
        <h2>📚 Select Books to Import</h2>
        <button class="close-btn" on:click={handleCancel} aria-label="Close">×</button>
      </div>
      
      <div class="modal-body">
        <p class="info-text">
          Found {books.length} offline note{books.length !== 1 ? 's' : ''} in pen memory. 
          Select which books to download:
        </p>
        
        <div class="selection-controls">
          <button class="btn-link" on:click={selectAll}>Select All</button>
          <span class="separator">|</span>
          <button class="btn-link" on:click={selectNone}>Select None</button>
          <span class="selected-count">({selectedBooks.size} selected)</span>
        </div>
        
        <div class="book-list">
          {#each books as note, i}
            <label class="book-item" class:selected={selectedBooks.has(i)}>
              <input 
                type="checkbox" 
                checked={selectedBooks.has(i)}
                on:change={() => toggleBook(i)}
              />
              <div class="book-info">
                <div class="book-title">{formatBookInfo(note)}</div>
                <div class="book-meta">{formatPageCount(note)}</div>
              </div>
            </label>
          {/each}
        </div>
      </div>
      
      <div class="modal-footer">
        <button class="btn btn-secondary" on:click={handleCancel}>
          Cancel
        </button>
        <button 
          class="btn btn-primary" 
          on:click={handleConfirm}
          disabled={selectedBooks.size === 0}
        >
          Import {selectedBooks.size} Book{selectedBooks.size !== 1 ? 's' : ''}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.75);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    animation: fadeIn 0.2s ease-out;
  }
  
  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  
  .modal-content {
    background: var(--bg-secondary);
    border-radius: 12px;
    border: 1px solid var(--border);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    max-width: 600px;
    width: 90%;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    animation: slideUp 0.3s ease-out;
  }
  
  @keyframes slideUp {
    from {
      transform: translateY(20px);
      opacity: 0;
    }
    to {
      transform: translateY(0);
      opacity: 1;
    }
  }
  
  .modal-header {
    padding: 20px 24px;
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  
  .modal-header h2 {
    font-size: 1.25rem;
    font-weight: 600;
    margin: 0;
    color: var(--text-primary);
  }
  
  .close-btn {
    background: none;
    border: none;
    color: var(--text-secondary);
    font-size: 2rem;
    line-height: 1;
    cursor: pointer;
    padding: 0;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    transition: all 0.2s;
  }
  
  .close-btn:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }
  
  .modal-body {
    padding: 20px 24px;
    overflow-y: auto;
    flex: 1;
  }
  
  .info-text {
    margin-bottom: 16px;
    color: var(--text-secondary);
    font-size: 0.9rem;
    line-height: 1.5;
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
    background: var(--bg-primary);
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
  
  .modal-footer {
    padding: 16px 24px;
    border-top: 1px solid var(--border);
    display: flex;
    gap: 12px;
    justify-content: flex-end;
  }
  
  .modal-footer .btn {
    min-width: 120px;
  }
</style>
