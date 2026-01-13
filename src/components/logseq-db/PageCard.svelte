<!--
  PageCard.svelte - Display a single smartpen page with import button
-->
<script>
  import { importStrokesFromLogSeq } from '$lib/logseq-import.js';
  import TranscriptionPreview from './TranscriptionPreview.svelte';
  import SyncStatusBadge from './SyncStatusBadge.svelte';
  import { pageTranscriptions } from '$stores';
  
  export let page; // LogSeqPageData object
  
  let importing = false;
  let importProgress = { current: 0, total: 0 };
  let editedTranscription = page.transcriptionText || '';
  
  // Update edited transcription when page changes
  $: editedTranscription = page.transcriptionText || '';
  
  async function handleImport() {
    importing = true;
    importProgress = { current: 0, total: page.strokeCount || 0 };
    
    try {
      // Show progress during import
      const result = await importStrokesFromLogSeq(page, (current, total) => {
        console.log(`Import progress: ${current}/${total}`);
        importProgress = { current, total };
      });
      console.log('Import complete:', result);
    } finally {
      importing = false;
      importProgress = { current: 0, total: 0 };
    }
  }
  
  function formatDate(timestamp) {
    if (!timestamp) return 'Unknown';
    return new Date(timestamp).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  }
  
  function handleTranscriptionChange(event) {
    const newText = event.detail;
    editedTranscription = newText;
    
    // Build page key for store lookup
    const pageKey = `S0/O0/B${page.book}/P${page.page}`;
    
    // Check if transcription exists in store
    let existingTranscription = null;
    for (const [key, trans] of $pageTranscriptions) {
      if (trans.pageInfo.book === page.book && trans.pageInfo.page === page.page) {
        existingTranscription = trans;
        break;
      }
    }
    
    // Parse lines from edited text and preserve indentation
    const lines = newText.split('\n').map((line, index) => {
      // Calculate indentation level from leading spaces
      // Each 2 spaces = 1 indent level
      const leadingSpaces = line.match(/^\s*/)[0].length;
      const indentLevel = Math.floor(leadingSpaces / 2);
      
      // Get the text without leading/trailing whitespace for the trimmed version
      const trimmedText = line.trimStart();
      
      return {
        text: trimmedText,
        lineNumber: index,
        indentLevel: indentLevel,
        parent: null,
        children: []
      };
    });
    
    // Update or create transcription in store
    pageTranscriptions.update(pt => {
      const newMap = new Map(pt);
      
      if (existingTranscription) {
        // Update existing entry
        newMap.set(pageKey, {
          ...existingTranscription,
          text: newText,
          lines
        });
      } else {
        // Create new entry for imported page
        newMap.set(pageKey, {
          text: newText,
          lines,
          pageInfo: {
            section: 0,
            owner: 0,
            book: page.book,
            page: page.page
          },
          strokeCount: page.strokeCount || 0,
          timestamp: Date.now()
        });
      }
      
      return newMap;
    });
    
    console.log(`Updated transcription for B${page.book}/P${page.page}`);
  }
</script>

<div class="page-card">
  <div class="page-header">
    <span class="page-icon">📄</span>
    <span class="page-title">Page {page.page}</span>
    <SyncStatusBadge status={page.syncStatus} />
  </div>
  
  <div class="page-meta">
    <span>Strokes: {page.strokeCount}</span>
    <span class="separator">│</span>
    <span>Last Updated: {formatDate(page.lastUpdated)}</span>
  </div>
  
  {#if page.transcriptionText || editedTranscription}
    <div class="transcription-section">
      <div class="section-label">Transcription:</div>
      <TranscriptionPreview 
        text={editedTranscription} 
        editable={true}
        on:change={handleTranscriptionChange}
      />
    </div>
  {:else}
    <div class="no-transcription">
      <em>No transcription data</em>
    </div>
  {/if}
  
  <div class="page-actions">
    <button 
      class="import-btn"
      on:click={handleImport}
      disabled={importing}
    >
      {#if importing}
        <span class="spinner">⏳</span>
        {#if importProgress.total > 0}
          Importing... {importProgress.current}/{importProgress.total}
        {:else}
          Importing...
        {/if}
      {:else}
        Import Strokes
      {/if}
    </button>
  </div>
</div>

<style>
  .page-card {
    background: transparent;
    border-radius: 6px;
    padding: 14px;
    margin-bottom: 10px;
    border: none;
    border-bottom: 2px solid rgba(255, 255, 255, 0.08);
  }
  
  .page-card:last-child {
    border-bottom: none;
    margin-bottom: 0;
  }
  
  .page-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }
  
  .page-icon {
    font-size: 1.2rem;
  }
  
  .page-title {
    font-weight: 600;
    font-size: 1rem;
    color: var(--text-primary);
    flex: 1;
  }
  
  .page-meta {
    display: flex;
    gap: 8px;
    font-size: 0.8rem;
    color: var(--text-secondary);
    margin-bottom: 12px;
  }
  
  .separator {
    color: var(--text-tertiary);
  }
  
  .transcription-section {
    margin-bottom: 12px;
  }
  
  .section-label {
    font-size: 0.75rem;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 6px;
  }
  
  .no-transcription {
    padding: 12px;
    background: rgba(255, 255, 255, 0.03);
    border-radius: 6px;
    color: var(--text-tertiary);
    font-size: 0.875rem;
    margin-bottom: 12px;
    border: 1px solid rgba(255, 255, 255, 0.05);
  }
  
  .page-actions {
    display: flex;
    justify-content: flex-start;
  }
  
  .import-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 16px;
    background: var(--accent-color, #2196f3);
    border: none;
    border-radius: 6px;
    color: white;
    cursor: pointer;
    font-size: 0.875rem;
    font-weight: 500;
    transition: all 0.2s;
  }
  
  .import-btn:hover:not(:disabled) {
    opacity: 0.9;
    transform: translateY(-1px);
  }
  
  .import-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  
  .spinner {
    animation: spin 1s linear infinite;
  }
  
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
</style>
