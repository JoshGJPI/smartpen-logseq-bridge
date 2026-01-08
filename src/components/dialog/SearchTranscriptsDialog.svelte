<!--
  SearchTranscriptsDialog.svelte - Search and import pages by transcription text
-->
<script>
  import { onMount } from 'svelte';
  import { logseqPages } from '$stores';
  import { showSearchTranscriptsDialog, closeSearchTranscriptsDialog, log } from '$stores';
  import { importStrokesFromLogSeq } from '$lib/logseq-import.js';
  import { searchPages } from '$lib/transcript-search.js';
  import TranscriptSearchResult from './TranscriptSearchResult.svelte';
  
  let searchQuery = '';
  let selectedPages = new Set();
  let importing = false;
  let importProgress = { current: 0, total: 0, message: '' };
  
  // Filter pages with transcription text
  $: pagesWithTranscription = $logseqPages.filter(p => p.transcriptionText);
  
  // Search results (debounced)
  let searchResults = [];
  let debounceTimer;
  
  $: {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (searchQuery.trim()) {
        searchResults = searchPages(pagesWithTranscription, searchQuery);
      } else {
        searchResults = pagesWithTranscription;
      }
    }, 200);
  }
  
  function toggleSelection(page) {
    const key = `B${page.book}/P${page.page}`;
    if (selectedPages.has(key)) {
      selectedPages.delete(key);
    } else {
      selectedPages.add(key);
    }
    selectedPages = selectedPages; // Trigger reactivity
  }
  
  function isSelected(page) {
    return selectedPages.has(`B${page.book}/P${page.page}`);
  }
  
  async function handleImport() {
    if (selectedPages.size === 0) return;
    
    importing = true;
    const pagesToImport = searchResults.filter(p => isSelected(p));
    importProgress = { current: 0, total: pagesToImport.length, message: '' };
    
    let successCount = 0;
    
    for (let i = 0; i < pagesToImport.length; i++) {
      const page = pagesToImport[i];
      importProgress = {
        current: i + 1,
        total: pagesToImport.length,
        message: `Importing B${page.book}/P${page.page}...`
      };
      
      try {
        const result = await importStrokesFromLogSeq(page);
        if (result.success) {
          successCount++;
        }
      } catch (error) {
        console.error('Import error:', error);
      }
    }
    
    log(`Import complete: ${successCount}/${pagesToImport.length} pages`, 'success');
    importing = false;
    closeSearchTranscriptsDialog();
  }
  
  function handleClose() {
    if (!importing) {
      closeSearchTranscriptsDialog();
    }
  }
  
  function handleKeydown(event) {
    if (event.key === 'Escape' && !importing) {
      handleClose();
    }
  }
  
  // Focus search input on mount
  let searchInput;
  onMount(() => {
    if (searchInput) {
      searchInput.focus();
    }
  });
</script>

<svelte:window on:keydown={handleKeydown} />

{#if $showSearchTranscriptsDialog}
  <div class="dialog-overlay" on:click={handleClose}>
    <div class="dialog" on:click|stopPropagation>
      <div class="dialog-header">
        <h3>🔍 Search Transcripts</h3>
        <button class="close-btn" on:click={handleClose} disabled={importing}>×</button>
      </div>
      
      <div class="search-section">
        <input
          bind:this={searchInput}
          bind:value={searchQuery}
          type="text"
          placeholder="Search transcribed text..."
          disabled={importing}
        />
        {#if searchQuery}
          <button class="clear-search" on:click={() => searchQuery = ''}>×</button>
        {/if}
      </div>
      
      <div class="results-section">
        {#if importing}
          <div class="importing-overlay">
            <div class="spinner">⏳</div>
            <div class="import-message">
              {importProgress.message}
              <br>
              <small>({importProgress.current}/{importProgress.total})</small>
            </div>
          </div>
        {/if}
        
        {#if pagesWithTranscription.length === 0}
          <div class="empty-state">
            <div class="icon">📄</div>
            <p>No pages with transcription text found in LogSeq.</p>
            <p class="hint">Transcribe and save pages first.</p>
          </div>
        {:else if searchQuery && searchResults.length === 0}
          <div class="empty-state">
            <div class="icon">🔍</div>
            <p>No matches found for "<strong>{searchQuery}</strong>"</p>
          </div>
        {:else}
          <div class="results-header">
            Found {searchResults.length} {searchResults.length === 1 ? 'page' : 'pages'}
            {#if searchQuery}with matching text{/if}
          </div>
          
          <div class="results-list">
            {#each searchResults as page (page.pageName)}
              <TranscriptSearchResult
                {page}
                query={searchQuery}
                selected={isSelected(page)}
                on:toggle={() => toggleSelection(page)}
                disabled={importing}
              />
            {/each}
          </div>
        {/if}
      </div>
      
      <div class="dialog-actions">
        <button class="btn btn-secondary" on:click={handleClose} disabled={importing}>
          Cancel
        </button>
        <button 
          class="btn btn-primary" 
          on:click={handleImport}
          disabled={selectedPages.size === 0 || importing}
        >
          {#if importing}
            Importing...
          {:else}
            Import Selected ({selectedPages.size})
          {/if}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .dialog-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 20px;
  }
  
  .dialog {
    background: var(--bg-secondary);
    border-radius: 12px;
    max-width: 700px;
    width: 100%;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--border);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  }
  
  .dialog-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 20px;
    border-bottom: 1px solid var(--border);
  }
  
  .dialog-header h3 {
    margin: 0;
    font-size: 1.25rem;
    color: var(--text-primary);
  }
  
  .close-btn {
    background: none;
    border: none;
    font-size: 2rem;
    line-height: 1;
    color: var(--text-secondary);
    cursor: pointer;
    padding: 0;
    width: 32px;
    height: 32px;
    border-radius: 4px;
    transition: all 0.2s;
  }
  
  .close-btn:hover:not(:disabled) {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }
  
  .close-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  .search-section {
    padding: 20px;
    border-bottom: 1px solid var(--border);
    position: relative;
  }
  
  .search-section input {
    width: 100%;
    padding: 12px 40px 12px 12px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text-primary);
    font-size: 1rem;
  }
  
  .search-section input:focus {
    outline: none;
    border-color: var(--accent);
  }
  
  .clear-search {
    position: absolute;
    right: 28px;
    top: 50%;
    transform: translateY(-50%);
    background: var(--bg-tertiary);
    border: none;
    color: var(--text-secondary);
    font-size: 1.5rem;
    cursor: pointer;
    padding: 0;
    width: 24px;
    height: 24px;
    line-height: 1;
    border-radius: 4px;
  }
  
  .clear-search:hover {
    background: var(--border);
    color: var(--text-primary);
  }
  
  .results-section {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    position: relative;
  }
  
  .importing-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(26, 26, 46, 0.95);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    z-index: 10;
  }
  
  .spinner {
    font-size: 3rem;
    animation: spin 1s linear infinite;
  }
  
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  
  .import-message {
    color: var(--text-primary);
    text-align: center;
  }
  
  .empty-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 40px 20px;
    text-align: center;
    color: var(--text-secondary);
  }
  
  .empty-state .icon {
    font-size: 4rem;
    margin-bottom: 16px;
    opacity: 0.5;
  }
  
  .empty-state p {
    margin: 8px 0;
  }
  
  .empty-state .hint {
    font-size: 0.875rem;
    color: var(--text-tertiary);
  }
  
  .results-header {
    padding: 12px 20px;
    border-bottom: 1px solid var(--border);
    color: var(--text-secondary);
    font-size: 0.875rem;
  }
  
  .results-list {
    flex: 1;
    overflow-y: auto;
    padding: 12px 20px;
  }
  
  .results-list::-webkit-scrollbar {
    width: 8px;
  }
  
  .results-list::-webkit-scrollbar-track {
    background: var(--bg-tertiary);
    border-radius: 4px;
  }
  
  .results-list::-webkit-scrollbar-thumb {
    background: var(--border);
    border-radius: 4px;
  }
  
  .results-list::-webkit-scrollbar-thumb:hover {
    background: var(--accent);
  }
  
  .dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    padding: 20px;
    border-top: 1px solid var(--border);
  }
  
  .btn {
    padding: 10px 20px;
    border-radius: 8px;
    font-size: 0.9rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
    border: none;
  }
  
  .btn-secondary {
    background: var(--bg-tertiary);
    color: var(--text-primary);
    border: 1px solid var(--border);
  }
  
  .btn-secondary:hover:not(:disabled) {
    background: var(--border);
  }
  
  .btn-primary {
    background: var(--accent);
    color: white;
  }
  
  .btn-primary:hover:not(:disabled) {
    opacity: 0.9;
  }
  
  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
