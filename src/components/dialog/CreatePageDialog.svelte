<!--
  CreatePageDialog.svelte - Dialog for creating a new page from pasted strokes
-->
<script>
  import { pastedStrokes, getPastedAsNewPage, clearPastedStrokes } from '$stores';
  import { log } from '$stores';
  import { logseqHost, logseqToken, logseqConnected } from '$stores/settings.js';
  import { updatePageStrokes } from '$lib/logseq-api.js';
  
  export let isOpen = false;
  
  // LogSeq settings from stores
  $: host = $logseqHost;
  $: token = $logseqToken;
  
  let bookNumber = '';
  let pageNumber = '';
  let isSaving = false;
  let error = '';
  
  $: strokeCount = $pastedStrokes.length;
  $: canSave = bookNumber && pageNumber && strokeCount > 0 && !isSaving && $logseqConnected;
  
  function close() {
    if (isSaving) return; // Don't close while saving
    isOpen = false;
    bookNumber = '';
    pageNumber = '';
    error = '';
  }
  
  async function handleCreate() {
    if (!canSave) return;
    
    const book = parseInt(bookNumber, 10);
    const page = parseInt(pageNumber, 10);
    
    if (isNaN(book) || isNaN(page) || book < 0 || page < 0) {
      error = 'Please enter valid book and page numbers';
      return;
    }
    
    isSaving = true;
    error = '';
    
    try {
      // Get strokes formatted for the new page
      const newPageStrokes = getPastedAsNewPage(book, page);
      
      console.log('💾 Saving', newPageStrokes.length, 'pasted strokes as B', book, '/P', page);
      
      // Save to LogSeq using updatePageStrokes
      const result = await updatePageStrokes(book, page, newPageStrokes, host, token);
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to save strokes');
      }
      
      log(`Created new page B${book}/P${page} with ${strokeCount} strokes`, 'success');
      
      // Clear pasted strokes after successful save
      clearPastedStrokes();
      close();
      
    } catch (err) {
      error = `Failed to save: ${err.message}`;
      log(`Failed to create page: ${err.message}`, 'error');
      console.error('Error saving pasted strokes:', err);
    } finally {
      isSaving = false;
    }
  }
  
  function handleKeyDown(event) {
    if (event.key === 'Escape' && !isSaving) {
      close();
    } else if (event.key === 'Enter' && canSave) {
      handleCreate();
    }
  }
</script>

<svelte:window on:keydown={handleKeyDown} />

{#if isOpen}
  <div class="dialog-overlay" on:click={close}>
    <div class="dialog" on:click|stopPropagation>
      <div class="dialog-header">
        <h3>Create New Page</h3>
        {#if !isSaving}
          <button class="close-btn" on:click={close}>×</button>
        {/if}
      </div>
      
      <div class="dialog-content">
        {#if !$logseqConnected}
          <div class="warning">
            <strong>⚠️ LogSeq Not Connected</strong>
            <p>Please connect to LogSeq in Settings before saving pasted strokes.</p>
          </div>
        {/if}
        
        <p class="info">
          Save {strokeCount} pasted stroke{strokeCount !== 1 ? 's' : ''} as a new page in LogSeq.
        </p>
        
        <div class="form-row">
          <label>
            Book Number
            <input 
              type="number" 
              bind:value={bookNumber}
              placeholder="e.g., 200"
              min="0"
              disabled={isSaving}
            />
          </label>
          
          <label>
            Page Number
            <input 
              type="number" 
              bind:value={pageNumber}
              placeholder="e.g., 1"
              min="0"
              disabled={isSaving}
            />
          </label>
        </div>
        
        {#if error}
          <p class="error">{error}</p>
        {/if}
        
        <p class="hint">
          This will create a new page entry at <code>B{bookNumber || '?'}/P{pageNumber || '?'}</code>
          and save the stroke data to LogSeq.
        </p>
      </div>
      
      <div class="dialog-actions">
        <button 
          class="btn btn-secondary" 
          on:click={close}
          disabled={isSaving}
        >
          Cancel
        </button>
        <button 
          class="btn btn-primary" 
          on:click={handleCreate}
          disabled={!canSave}
        >
          {isSaving ? 'Saving...' : 'Create Page'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .dialog-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    backdrop-filter: blur(2px);
  }
  
  .dialog {
    background: var(--bg-secondary);
    border-radius: 12px;
    border: 1px solid var(--border);
    width: 400px;
    max-width: 90vw;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
  }
  
  .dialog-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border);
  }
  
  .dialog-header h3 {
    margin: 0;
    font-size: 1.1rem;
    color: var(--text-primary);
  }
  
  .close-btn {
    background: none;
    border: none;
    font-size: 1.5rem;
    color: var(--text-secondary);
    cursor: pointer;
    padding: 0;
    line-height: 1;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    transition: all 0.2s;
  }
  
  .close-btn:hover {
    color: var(--text-primary);
    background: var(--bg-tertiary);
  }
  
  .dialog-content {
    padding: 20px;
  }
  
  .warning {
    background: rgba(255, 165, 0, 0.1);
    border-left: 3px solid orange;
    padding: 12px 16px;
    margin-bottom: 16px;
    border-radius: 4px;
  }
  
  .warning strong {
    display: block;
    color: orange;
    margin-bottom: 4px;
  }
  
  .warning p {
    margin: 0;
    color: var(--text-secondary);
    font-size: 0.85rem;
    line-height: 1.4;
  }
  
  .info {
    margin: 0 0 16px;
    color: var(--text-secondary);
    font-size: 0.9rem;
  }
  
  .form-row {
    display: flex;
    gap: 16px;
    margin-bottom: 16px;
  }
  
  .form-row label {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 0.9rem;
    color: var(--text-secondary);
    font-weight: 500;
  }
  
  .form-row input {
    padding: 10px;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--bg-tertiary);
    color: var(--text-primary);
    font-size: 1rem;
    transition: all 0.2s;
  }
  
  .form-row input:focus {
    outline: none;
    border-color: var(--accent);
    background: var(--bg-primary);
  }
  
  .form-row input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  .error {
    color: var(--error);
    font-size: 0.85rem;
    margin: 12px 0 0;
    padding: 8px 12px;
    background: rgba(239, 68, 68, 0.1);
    border-radius: 4px;
    border-left: 3px solid var(--error);
  }
  
  .hint {
    margin: 16px 0 0;
    font-size: 0.8rem;
    color: var(--text-secondary);
    line-height: 1.4;
  }
  
  .hint code {
    background: var(--bg-tertiary);
    padding: 2px 6px;
    border-radius: 4px;
    font-family: 'Courier New', monospace;
    color: var(--accent);
  }
  
  .dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    padding: 16px 20px;
    border-top: 1px solid var(--border);
  }
  
  .btn {
    padding: 8px 16px;
    border-radius: 6px;
    font-size: 0.9rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
    border: none;
  }
  
  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  .btn-secondary {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }
  
  .btn-secondary:hover:not(:disabled) {
    background: var(--bg-primary);
  }
  
  .btn-primary {
    background: var(--success);
    color: var(--bg-primary);
  }
  
  .btn-primary:hover:not(:disabled) {
    background: #16a34a;
  }
</style>
