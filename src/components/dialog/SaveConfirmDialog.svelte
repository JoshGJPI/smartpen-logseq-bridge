<!--
  SaveConfirmDialog.svelte - Git-style commit confirmation dialog
  Shows pending changes before saving to LogSeq
-->
<script>
  import { createEventDispatcher, onMount } from 'svelte';
  import { getActiveStrokesForPage } from '$stores/pending-changes.js';
  import { getBookAlias } from '$stores/book-aliases.js';
  import { getLogseqSettings } from '$stores';
  import { computePageChanges } from '$lib/logseq-api.js';
  import { strokes } from '$stores';
  
  export let visible = false;
  
  const dispatch = createEventDispatcher();
  
  // State
  let isLoading = true;
  let changesList = [];
  let totalAdditions = 0;
  let totalDeletions = 0;
  let totalPages = 0;
  
  // Compute actual changes when dialog opens
  $: if (visible) {
    computeChanges();
  }
  
  async function computeChanges() {
    isLoading = true;
    changesList = [];
    totalAdditions = 0;
    totalDeletions = 0;
    
    const { host, token } = getLogseqSettings();
    
    // Get all pages with strokes
    const pageMap = new Map();
    $strokes.forEach(stroke => {
      const pageInfo = stroke.pageInfo;
      if (!pageInfo || pageInfo.book === undefined || pageInfo.page === undefined) return;
      
      const key = `${pageInfo.book}-${pageInfo.page}`;
      if (!pageMap.has(key)) {
        pageMap.set(key, {
          book: pageInfo.book,
          page: pageInfo.page
        });
      }
    });
    
    // Compute changes for each page
    const promises = [];
    for (const [key, pageData] of pageMap) {
      const activeStrokes = getActiveStrokesForPage(pageData.book, pageData.page);
      
      const promise = computePageChanges(
        pageData.book,
        pageData.page,
        activeStrokes,
        host,
        token
      ).then(changes => ({
        pageKey: key,
        book: pageData.book,
        page: pageData.page,
        bookAlias: getBookAlias(pageData.book),
        additions: changes.additions,
        deletions: changes.deletions,
        total: changes.total
      }));
      
      promises.push(promise);
    }
    
    try {
      const results = await Promise.all(promises);
      
      // Filter to only pages with changes
      changesList = results
        .filter(item => item.additions > 0 || item.deletions > 0)
        .sort((a, b) => {
          // Sort by book then page
          if (a.book !== b.book) return a.book - b.book;
          return a.page - b.page;
        });
      
      totalAdditions = changesList.reduce((sum, item) => sum + item.additions, 0);
      totalDeletions = changesList.reduce((sum, item) => sum + item.deletions, 0);
      totalPages = changesList.length;
    } catch (error) {
      console.error('Failed to compute changes:', error);
    } finally {
      isLoading = false;
    }
  }
  
  function handleConfirm() {
    dispatch('confirm');
  }
  
  function handleCancel() {
    dispatch('cancel');
  }
  
  function formatPageName(item) {
    const alias = item.bookAlias || `Book ${item.book}`;
    return `${alias} / Page ${item.page}`;
  }
</script>

{#if visible}
  <!-- Backdrop -->
  <div class="dialog-backdrop" on:click={handleCancel}></div>
  
  <!-- Dialog -->
  <div class="dialog">
    <div class="dialog-header">
      <h2>💾 Confirm Save to LogSeq</h2>
      <button class="close-btn" on:click={handleCancel} title="Cancel">✕</button>
    </div>
    
    <div class="dialog-body">
    {#if isLoading}
      <div class="loading">
      <div class="spinner"></div>
    <p>Computing changes...</p>
    </div>
    {:else if changesList.length === 0}
    <div class="no-changes">
    <p>⚠️ No changes to save</p>
    </div>
    {:else}
    <!-- Summary -->
    <div class="summary">
      <div class="summary-item">
      <span class="summary-label">Pages:</span>
    <span class="summary-value">{totalPages}</span>
    </div>
    {#if totalAdditions > 0}
        <div class="summary-item additions">
            <span class="summary-label">Adding:</span>
            <span class="summary-value">+{totalAdditions} strokes</span>
          </div>
        {/if}
      {#if totalDeletions > 0}
      <div class="summary-item deletions">
      <span class="summary-label">Deleting:</span>
    <span class="summary-value">-{totalDeletions} strokes</span>
    </div>
    {/if}
    </div>
    
    <!-- Changes List -->
    <div class="changes-list">
    {#each changesList as item}
    <div class="change-item">
      <div class="page-name">
          📄 {formatPageName(item)}
          </div>
            <div class="change-stats">
              {#if item.additions > 0}
                <span class="stat additions">+{item.additions}</span>
            {/if}
          {#if item.deletions > 0}
              <span class="stat deletions">-{item.deletions}</span>
              {/if}
              </div>
            </div>
          {/each}
      </div>
    
      {#if totalDeletions > 0}
        <div class="warning">
        ⚠️ Deleted strokes will be permanently removed from LogSeq storage after this save.
        </div>
        {/if}
    {/if}
  </div>
  
  <div class="dialog-footer">
    <button class="btn btn-cancel" on:click={handleCancel}>
      Cancel
    </button>
    <button class="btn btn-confirm" on:click={handleConfirm} disabled={isLoading || changesList.length === 0}>
      {isLoading ? 'Loading...' : 'Confirm & Save'}
    </button>
  </div>
  </div>
{/if}

<style>
  .dialog-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
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
    max-width: 700px;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    z-index: 1001;
    animation: slideIn 0.3s ease;
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
  
  .summary {
    display: flex;
    gap: 24px;
    padding: 16px;
    background: var(--bg-secondary);
    border-radius: 8px;
    margin-bottom: 20px;
  }
  
  .summary-item {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  
  .summary-label {
    font-size: 0.75rem;
    text-transform: uppercase;
    color: var(--text-secondary);
    font-weight: 600;
    letter-spacing: 0.5px;
  }
  
  .summary-value {
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--text-primary);
  }
  
  .summary-item.additions .summary-value {
    color: var(--success);
  }
  
  .summary-item.deletions .summary-value {
    color: var(--error);
  }
  
  .changes-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: 400px;
    overflow-y: auto;
  }
  
  .change-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 6px;
    transition: background 0.2s;
  }
  
  .change-item:hover {
    background: var(--bg-tertiary);
  }
  
  .page-name {
    font-size: 0.9rem;
    font-weight: 500;
    color: var(--text-primary);
  }
  
  .change-stats {
    display: flex;
    gap: 12px;
    font-size: 0.85rem;
    font-weight: 600;
  }
  
  .stat {
    padding: 4px 8px;
    border-radius: 4px;
    font-family: 'Courier New', monospace;
  }
  
  .stat.additions {
    color: var(--success);
    background: rgba(34, 197, 94, 0.1);
  }
  
  .stat.deletions {
    color: var(--error);
    background: rgba(239, 68, 68, 0.1);
  }
  
  .warning {
    margin-top: 20px;
    padding: 12px 16px;
    background: rgba(251, 191, 36, 0.1);
    border: 1px solid rgba(251, 191, 36, 0.3);
    border-radius: 6px;
    color: #fbbf24;
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
  
  .btn-cancel {
    background: var(--bg-secondary);
    color: var(--text-primary);
    border: 1px solid var(--border);
  }
  
  .btn-cancel:hover {
    background: var(--bg-tertiary);
  }
  
  .btn-confirm {
    background: var(--success);
    color: white;
  }
  
  .btn-confirm:hover {
    background: #22c55e;
    transform: translateY(-1px);
  }
  
  /* Scrollbar styling */
  .changes-list::-webkit-scrollbar,
  .dialog-body::-webkit-scrollbar {
    width: 8px;
  }
  
  .changes-list::-webkit-scrollbar-track,
  .dialog-body::-webkit-scrollbar-track {
    background: var(--bg-tertiary);
    border-radius: 4px;
  }
  
  .changes-list::-webkit-scrollbar-thumb,
  .dialog-body::-webkit-scrollbar-thumb {
    background: var(--border);
    border-radius: 4px;
  }
  
  .changes-list::-webkit-scrollbar-thumb:hover,
  .dialog-body::-webkit-scrollbar-thumb:hover {
    background: var(--accent);
  }
  
  /* Loading spinner */
  .loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 40px 20px;
    gap: 16px;
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
  
  .loading p {
    margin: 0;
    color: var(--text-secondary);
    font-size: 0.9rem;
  }
  
  .no-changes {
    padding: 40px 20px;
    text-align: center;
  }
  
  .no-changes p {
    margin: 0;
    color: var(--text-secondary);
    font-size: 1rem;
  }
</style>
