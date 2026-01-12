<!--
  CreatePageDialog.svelte - Dialog for creating a new page from duplicated strokes
-->
<script>
  import { pastedStrokes, pastedSelection, getPastedAsNewPage, clearPastedStrokes } from '$stores';
  import { addOfflineStrokes } from '$stores';
  import { log } from '$stores';
  import { logseqHost, logseqToken, logseqConnected } from '$stores/settings.js';
  import { logseqPages } from '$stores';
  import { updatePageStrokes, getPageStrokes } from '$lib/logseq-api.js';
  
  export let isOpen = false;
  
  // LogSeq settings from stores
  $: host = $logseqHost;
  $: token = $logseqToken;
  
  let bookNumber = '';
  let pageNumber = '';
  let isSaving = false;
  let error = '';
  let bookSuggestions = [];
  let pageSuggestions = [];
  let showBookSuggestions = false;
  let showPageSuggestions = false;
  
  // Get unique books and pages from LogSeq data
  $: allBooks = [...new Set($logseqPages.map(p => p.book))].sort((a, b) => a - b);
  $: allPagesForBook = bookNumber 
    ? $logseqPages.filter(p => p.book === parseInt(bookNumber)).map(p => p.page).sort((a, b) => a - b)
    : [];
  
  // Update suggestions when input changes
  $: {
    if (bookNumber) {
      const num = parseInt(bookNumber);
      bookSuggestions = allBooks.filter(b => 
        b.toString().startsWith(bookNumber) && b !== num
      ).slice(0, 5);
    } else {
      bookSuggestions = allBooks.slice(0, 5);
    }
  }
  
  $: {
    if (pageNumber && bookNumber) {
      const num = parseInt(pageNumber);
      pageSuggestions = allPagesForBook.filter(p => 
        p.toString().startsWith(pageNumber) && p !== num
      ).slice(0, 5);
    } else if (bookNumber) {
      pageSuggestions = allPagesForBook.slice(0, 5);
    } else {
      pageSuggestions = [];
    }
  }
  
  // Check if page exists
  $: pageExists = bookNumber && pageNumber 
    ? $logseqPages.some(p => p.book === parseInt(bookNumber) && p.page === parseInt(pageNumber))
    : false;
  
  // Determine which strokes to save: selected if any, otherwise all
  $: selectedCount = $pastedSelection.size;
  $: strokeCount = selectedCount > 0 ? selectedCount : $pastedStrokes.length;
  $: hasSelection = selectedCount > 0;
  $: canSave = bookNumber && pageNumber && strokeCount > 0 && !isSaving && $logseqConnected;
  
  function close() {
    if (isSaving) return; // Don't close while saving
    isOpen = false;
    bookNumber = '';
    pageNumber = '';
    error = '';
  }
  
  function selectBookSuggestion(book) {
    bookNumber = book.toString();
    showBookSuggestions = false;
  }
  
  function selectPageSuggestion(page) {
    pageNumber = page.toString();
    showPageSuggestions = false;
  }
  
  async function handleCreate(mode) {
    if (!canSave) return;
    
    const book = parseInt(bookNumber, 10);
    const page = parseInt(pageNumber, 10);
    
    if (isNaN(book) || isNaN(page) || book < 0 || page < 0) {
      error = 'Please enter valid book and page numbers';
      return;
    }
    
    // Proceed with save
    await performSave(book, page, mode);
  }
  
  // Helper to convert storage format back to full format for appending
  function storageToFullFormat(storedStroke, pageInfo) {
    return {
      startTime: storedStroke.startTime,
      endTime: storedStroke.endTime,
      pageInfo: pageInfo,
      dotArray: storedStroke.points.map(([x, y, timestamp]) => ({
        x, 
        y, 
        timestamp,
        f: 128, // Default force value
        dotType: 0
      }))
    };
  }
  
  async function performSave(book, page, mode) {
    isSaving = true;
    error = '';
    
    try {
      // Get strokes to save
      const indicesToConvert = hasSelection ? $pastedSelection : null;
      const newStrokes = getPastedAsNewPage(book, page, indicesToConvert);
      
      console.log('💾 Saving', newStrokes.length, 'strokes as B', book, '/P', page, `(${mode})`);
      
      // Prepare strokes for LogSeq storage and local store
      let strokesToSaveToLogSeq = newStrokes;
      let strokesToAddToLocalStore = newStrokes;
      
      if (mode === 'append') {
        // Get existing strokes and convert them back to full format
        const existingData = await getPageStrokes(book, page, host, token);
        if (existingData && existingData.strokes && existingData.strokes.length > 0) {
          console.log('📎 Appending to', existingData.strokes.length, 'existing strokes');
          
          // Convert stored format back to full format
          const existingFullFormat = existingData.strokes.map(s => 
            storageToFullFormat(s, existingData.pageInfo)
          );
          
          // Find the bottom-most Y coordinate in existing strokes
          let maxExistingY = -Infinity;
          for (const stroke of existingFullFormat) {
            for (const dot of stroke.dotArray) {
              if (dot.y > maxExistingY) {
                maxExistingY = dot.y;
              }
            }
          }
          console.log('📄 Existing strokes bottom Y:', maxExistingY.toFixed(2));
          
          // Find the top-most Y coordinate in new strokes
          let minNewY = Infinity;
          for (const stroke of newStrokes) {
            for (const dot of stroke.dotArray) {
              if (dot.y < minNewY) {
                minNewY = dot.y;
              }
            }
          }
          console.log('🆕 New strokes top Y:', minNewY.toFixed(2));
          
          // Calculate vertical offset with spacing (5 Ncode units for small gap)
          const spacing = 5; // Vertical gap between existing and new strokes
          const yOffset = maxExistingY - minNewY + spacing;
          console.log('⬇️ Applying Y offset:', yOffset.toFixed(2), 'to new strokes');
          
          // Apply vertical offset to new strokes
          const offsetNewStrokes = newStrokes.map(stroke => ({
            ...stroke,
            dotArray: stroke.dotArray.map(dot => ({
              ...dot,
              y: dot.y + yOffset
            }))
          }));
          
          // For LogSeq: save COMBINED (existing + new with offset)
          strokesToSaveToLogSeq = [...existingFullFormat, ...offsetNewStrokes];
          console.log('📦 Total strokes to save to LogSeq:', strokesToSaveToLogSeq.length);
          
          // For local store: only add the NEW strokes (with offset)
          strokesToAddToLocalStore = offsetNewStrokes;
          console.log('💾 Adding', strokesToAddToLocalStore.length, 'new strokes to local store');
        }
      }
      
      // Save to LogSeq
      const result = await updatePageStrokes(book, page, strokesToSaveToLogSeq, host, token);
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to save strokes');
      }
      
      log(`${mode === 'append' ? 'Appended to' : 'Created'} page B${book}/P${page} with ${newStrokes.length} strokes`, 'success');
      
      // Add only the NEW strokes to main strokes store so they appear on canvas
      addOfflineStrokes(strokesToAddToLocalStore);
      
      // Remove the saved strokes from pasted collection
      if (hasSelection) {
        const indicesToConvert = $pastedSelection;
        pastedStrokes.update(strokes => {
          return strokes.filter((_, idx) => !indicesToConvert.has(idx));
        });
        pastedSelection.set(new Set());
      } else {
        clearPastedStrokes();
      }
      
      // Close dialog automatically after successful save
      console.log('✅ Save successful, closing dialog');
      close();
      
    } catch (err) {
      error = `Failed to save: ${err.message}`;
      log(`Failed to create page: ${err.message}`, 'error');
      console.error('Error saving duplicated strokes:', err);
    } finally {
      isSaving = false;
    }
  }
  
  function handleKeyDown(event) {
    if (event.key === 'Escape' && !isSaving) {
      close();
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
            <p>Please connect to LogSeq in Settings before saving duplicated strokes.</p>
          </div>
        {/if}
        
        <p class="info">
          {#if hasSelection}
            Save <strong>{strokeCount} selected</strong> duplicated stroke{strokeCount !== 1 ? 's' : ''} as a new page in LogSeq.
          {:else}
            Save <strong>all {strokeCount}</strong> duplicated stroke{strokeCount !== 1 ? 's' : ''} as a new page in LogSeq.
          {/if}
        </p>
        
        <p class="hint-text">
          Coordinates will be normalized with the top-left corner at (0, 0).
        </p>
        
        <div class="form-row">
          <label>
            Book Number
            <div class="autocomplete-wrapper">
              <input 
                type="number" 
                bind:value={bookNumber}
                on:focus={() => showBookSuggestions = true}
                on:blur={() => setTimeout(() => showBookSuggestions = false, 200)}
                placeholder="e.g., 200"
                min="0"
                disabled={isSaving}
              />
              {#if showBookSuggestions && bookSuggestions.length > 0}
                <div class="suggestions">
                  {#each bookSuggestions as book}
                    <button 
                      class="suggestion-item"
                      on:click={() => selectBookSuggestion(book)}
                    >
                      Book {book}
                    </button>
                  {/each}
                </div>
              {/if}
            </div>
          </label>
          
          <label>
            Page Number
            <div class="autocomplete-wrapper">
              <input 
                type="number" 
                bind:value={pageNumber}
                on:focus={() => showPageSuggestions = true}
                on:blur={() => setTimeout(() => showPageSuggestions = false, 200)}
                placeholder="e.g., 1"
                min="0"
                disabled={isSaving || !bookNumber}
              />
              {#if showPageSuggestions && pageSuggestions.length > 0}
                <div class="suggestions">
                  {#each pageSuggestions as page}
                    <button 
                      class="suggestion-item"
                      on:click={() => selectPageSuggestion(page)}
                    >
                      Page {page}
                    </button>
                  {/each}
                </div>
              {/if}
            </div>
          </label>
        </div>
        
        {#if pageExists}
          <div class="page-exists-info">
            📄 Page <code>B{bookNumber}/P{pageNumber}</code> already exists
          </div>
        {/if}
        
        {#if error}
          <p class="error">{error}</p>
        {/if}
        
        {#if !pageExists}
          <p class="hint">
            This will create a new page entry at <code>B{bookNumber || '?'}/P{pageNumber || '?'}</code>
            and save the stroke data to LogSeq.
          </p>
        {/if}
      </div>
      
      <div class="dialog-actions">
        <button 
          class="btn btn-secondary" 
          on:click={close}
          disabled={isSaving}
        >
          Cancel
        </button>
        
        {#if pageExists}
          <button 
            class="btn btn-overwrite" 
            on:click={() => handleCreate('overwrite')}
            disabled={!canSave}
            title="Replace all existing strokes with new ones"
          >
            {isSaving ? 'Saving...' : '🔄 Overwrite'}
          </button>
          <button 
            class="btn btn-append" 
            on:click={() => handleCreate('append')}
            disabled={!canSave}
            title="Add new strokes to existing ones"
          >
            {isSaving ? 'Saving...' : '➕ Append'}
          </button>
        {:else}
          <button 
            class="btn btn-primary" 
            on:click={() => handleCreate('overwrite')}
            disabled={!canSave}
          >
            {isSaving ? 'Saving...' : 'Create Page'}
          </button>
        {/if}
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
    width: 480px;
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
    margin: 0 0 12px;
    color: var(--text-secondary);
    font-size: 0.9rem;
    line-height: 1.5;
  }
  
  .info strong {
    color: var(--text-primary);
  }
  
  .hint-text {
    margin: 0 0 16px;
    font-size: 0.8rem;
    color: var(--text-secondary);
    font-style: italic;
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
  
  .autocomplete-wrapper {
    position: relative;
  }
  
  .form-row input {
    padding: 10px;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--bg-tertiary);
    color: var(--text-primary);
    font-size: 1rem;
    transition: all 0.2s;
    width: 100%;
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
  
  .suggestions {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-top: none;
    border-radius: 0 0 6px 6px;
    max-height: 150px;
    overflow-y: auto;
    z-index: 10;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
  }
  
  .suggestion-item {
    width: 100%;
    padding: 8px 12px;
    background: none;
    border: none;
    color: var(--text-primary);
    text-align: left;
    cursor: pointer;
    font-size: 0.9rem;
    transition: background 0.15s;
  }
  
  .suggestion-item:hover {
    background: var(--bg-primary);
  }
  
  .page-exists-info {
    background: rgba(59, 130, 246, 0.1);
    border-left: 3px solid #3b82f6;
    padding: 10px 14px;
    margin-bottom: 12px;
    border-radius: 4px;
    font-size: 0.85rem;
    color: #3b82f6;
  }
  
  .page-exists-info code {
    background: rgba(59, 130, 246, 0.15);
    padding: 2px 6px;
    border-radius: 3px;
    font-family: 'Courier New', monospace;
    color: #2563eb;
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
  
  .btn-overwrite {
    background: #f59e0b;
    color: white;
    font-weight: 600;
  }
  
  .btn-overwrite:hover:not(:disabled) {
    background: #d97706;
  }
  
  .btn-append {
    background: var(--success);
    color: var(--bg-primary);
    font-weight: 600;
  }
  
  .btn-append:hover:not(:disabled) {
    background: #16a34a;
  }
</style>
