<script>
  import { bookAliases, knownBookIds, setBookAlias, removeBookAlias } from '$stores';
  import { updateBookPageProperty } from '$lib/logseq-api.js';
  import { getLogseqSettings, logseqConnected, log } from '$stores';
  
  // Track which books are being edited
  let editingBookIds = new Set();
  let aliasInputs = {};
  let isSyncing = false;
  
  // Reactive: Get sorted list of known books
  $: sortedBookIds = Array.from($knownBookIds).sort((a, b) => Number(a) - Number(b));
  
  // Initialize inputs from current aliases
  $: {
    sortedBookIds.forEach(bookId => {
      if (!(bookId in aliasInputs)) {
        aliasInputs[bookId] = $bookAliases[bookId] || '';
      }
    });
  }
  
  function startEditing(bookId) {
    editingBookIds.add(bookId);
    editingBookIds = editingBookIds; // Trigger reactivity
    aliasInputs[bookId] = $bookAliases[bookId] || '';
  }
  
  function cancelEditing(bookId) {
    editingBookIds.delete(bookId);
    editingBookIds = editingBookIds;
    aliasInputs[bookId] = $bookAliases[bookId] || '';
  }
  
  async function saveAlias(bookId) {
    const alias = aliasInputs[bookId]?.trim();
    
    if (!alias) {
      log('Book alias cannot be empty', 'warning');
      return;
    }
    
    // Update local store immediately
    setBookAlias(bookId, alias);
    
    // Update LogSeq if connected
    if ($logseqConnected) {
      const { host, token } = getLogseqSettings();
      const success = await updateBookPageProperty(Number(bookId), 'bookname', alias, host, token);
      
      if (success) {
        log(`Saved alias for B${bookId}: ${alias}`, 'success');
      } else {
        log(`Failed to save alias for B${bookId} to LogSeq`, 'error');
        // Revert on failure
        removeBookAlias(bookId);
        return;
      }
    } else {
      log(`Alias saved locally for B${bookId}. Connect to LogSeq to persist.`, 'info');
    }
    
    // Exit edit mode
    editingBookIds.delete(bookId);
    editingBookIds = editingBookIds;
  }
  
  async function removeAlias(bookId) {
    if (!confirm(`Remove alias for B${bookId}?`)) {
      return;
    }
    
    // Update local store
    removeBookAlias(bookId);
    aliasInputs[bookId] = '';
    
    // Update LogSeq if connected
    if ($logseqConnected) {
      const { host, token } = getLogseqSettings();
      const success = await updateBookPageProperty(Number(bookId), 'bookname', '', host, token);
      
      if (success) {
        log(`Removed alias for B${bookId}`, 'success');
      } else {
        log(`Failed to remove alias for B${bookId} from LogSeq`, 'error');
      }
    }
  }
  
  function handleKeydown(event, bookId) {
    if (event.key === 'Enter') {
      saveAlias(bookId);
    } else if (event.key === 'Escape') {
      cancelEditing(bookId);
    }
  }
  
  async function syncAllAliasesToLogSeq() {
    if (!$logseqConnected) {
      log('Connect to LogSeq first to sync aliases', 'warning');
      return;
    }
    
    const aliasEntries = Object.entries($bookAliases);
    
    if (aliasEntries.length === 0) {
      log('No aliases to sync', 'info');
      return;
    }
    
    isSyncing = true;
    const { host, token } = getLogseqSettings();
    
    let successCount = 0;
    let errorCount = 0;
    
    log(`Syncing ${aliasEntries.length} book aliases to LogSeq...`, 'info');
    
    for (const [bookId, alias] of aliasEntries) {
      try {
        const success = await updateBookPageProperty(Number(bookId), 'bookname', alias, host, token);
        if (success) {
          successCount++;
        } else {
          errorCount++;
        }
      } catch (error) {
        console.error(`Failed to sync alias for B${bookId}:`, error);
        errorCount++;
      }
    }
    
    isSyncing = false;
    
    if (successCount > 0) {
      log(`Successfully synced ${successCount} book aliases to LogSeq`, 'success');
    }
    if (errorCount > 0) {
      log(`Failed to sync ${errorCount} book aliases`, 'error');
    }
  }
</script>

<div class="book-aliases">
  <h3>📚 Book Aliases</h3>
  
  {#if sortedBookIds.length === 0}
    <p class="empty-state">No books found yet. Import strokes to get started.</p>
  {:else}
    <div class="header-section">
      <p class="help-text">
        Give your notebooks friendly names that will appear throughout the app.
        {#if !$logseqConnected}
          <span class="warning">⚠️ Connect to LogSeq to persist aliases.</span>
        {/if}
      </p>
      
      {#if $logseqConnected && Object.keys($bookAliases).length > 0}
        <button 
          class="btn-sync" 
          on:click={syncAllAliasesToLogSeq}
          disabled={isSyncing}
        >
          {#if isSyncing}
            <span class="spinner-small"></span>
            Syncing...
          {:else}
            🔄 Sync All to LogSeq
          {/if}
        </button>
      {/if}
    </div>
    
    <div class="alias-list">
      {#each sortedBookIds as bookId}
        {@const hasAlias = !!$bookAliases[bookId]}
        {@const isEditing = editingBookIds.has(bookId)}
        
        <div class="alias-row" class:has-alias={hasAlias}>
          <div class="book-label">B{bookId}</div>
          
          {#if isEditing}
            <input
              type="text"
              class="alias-input"
              bind:value={aliasInputs[bookId]}
              on:keydown={(e) => handleKeydown(e, bookId)}
              placeholder="Enter book name..."
              maxlength="50"
            />
            <button class="btn-save" on:click={() => saveAlias(bookId)}>
              ✓
            </button>
            <button class="btn-cancel" on:click={() => cancelEditing(bookId)}>
              ✕
            </button>
          {:else}
            <div class="alias-display">
              {#if hasAlias}
                <span class="alias-text">{$bookAliases[bookId]}</span>
              {:else}
                <span class="no-alias">No alias</span>
              {/if}
            </div>
            <button class="btn-edit" on:click={() => startEditing(bookId)}>
              {hasAlias ? 'Edit' : 'Add'}
            </button>
            {#if hasAlias}
              <button class="btn-remove" on:click={() => removeAlias(bookId)}>
                ✕
              </button>
            {/if}
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .book-aliases {
    padding: 1rem;
    background: var(--bg-secondary);
    border-radius: 6px;
  }
  
  h3 {
    margin: 0 0 0.75rem 0;
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-primary);
  }
  
  .empty-state {
    color: var(--text-secondary);
    font-size: 0.9rem;
    margin: 0;
    padding: 1rem;
    text-align: center;
    background: var(--bg-tertiary);
    border-radius: 4px;
  }
  
  .help-text {
    font-size: 0.85rem;
    color: var(--text-secondary);
    margin: 0 0 1rem 0;
    line-height: 1.5;
  }
  
  .help-text .warning {
    display: block;
    margin-top: 0.5rem;
    color: var(--warning);
  }
  
  .header-section {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 1rem;
    margin-bottom: 1rem;
  }
  
  .header-section .help-text {
    flex: 1;
    margin: 0;
  }
  
  .btn-sync {
    padding: 0.5rem 1rem;
    background: var(--accent);
    color: white;
    border: none;
    border-radius: 4px;
    font-size: 0.85rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
    white-space: nowrap;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  
  .btn-sync:hover:not(:disabled) {
    background: var(--accent-hover, #d64560);
    transform: translateY(-1px);
  }
  
  .btn-sync:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  
  .spinner-small {
    width: 14px;
    height: 14px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  
  .alias-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  
  .alias-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem;
    background: var(--bg-tertiary);
    border-radius: 4px;
    border: 1px solid transparent;
    transition: border-color 0.2s;
  }
  
  .alias-row.has-alias {
    border-color: var(--accent);
  }
  
  .book-label {
    font-family: 'Courier New', monospace;
    font-weight: bold;
    color: var(--text-primary);
    min-width: 60px;
    font-size: 0.9rem;
  }
  
  .alias-display {
    flex: 1;
    min-width: 0;
  }
  
  .alias-text {
    color: var(--text-primary);
    font-weight: 500;
  }
  
  .no-alias {
    color: var(--text-tertiary);
    font-style: italic;
    font-size: 0.85rem;
  }
  
  .alias-input {
    flex: 1;
    padding: 0.4rem 0.6rem;
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 3px;
    color: var(--text-primary);
    font-size: 0.9rem;
  }
  
  .alias-input:focus {
    outline: none;
    border-color: var(--accent);
  }
  
  button {
    padding: 0.4rem 0.75rem;
    border: none;
    border-radius: 3px;
    font-size: 0.85rem;
    cursor: pointer;
    transition: all 0.2s;
  }
  
  .btn-edit {
    background: var(--accent);
    color: white;
  }
  
  .btn-edit:hover {
    background: var(--accent-hover);
  }
  
  .btn-save {
    background: var(--success);
    color: white;
    font-size: 1rem;
    padding: 0.4rem 0.6rem;
  }
  
  .btn-save:hover {
    opacity: 0.9;
  }
  
  .btn-cancel,
  .btn-remove {
    background: var(--bg-primary);
    color: var(--text-secondary);
    border: 1px solid var(--border);
    font-size: 1rem;
    padding: 0.4rem 0.6rem;
  }
  
  .btn-cancel:hover,
  .btn-remove:hover {
    background: var(--error);
    color: white;
    border-color: var(--error);
  }
</style>
