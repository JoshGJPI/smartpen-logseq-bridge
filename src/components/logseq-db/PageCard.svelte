<!--
  PageCard.svelte - Display a single smartpen page with import button
-->
<script>
  import { importStrokesFromLogSeq } from '$lib/logseq-import.js';
  import TranscriptionPreview from './TranscriptionPreview.svelte';
  import SyncStatusBadge from './SyncStatusBadge.svelte';
  
  export let page; // LogSeqPageData object
  
  let importing = false;
  
  async function handleImport() {
    importing = true;
    try {
      await importStrokesFromLogSeq(page);
    } finally {
      importing = false;
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
  
  {#if page.transcriptionText}
    <div class="transcription-section">
      <div class="section-label">Transcription:</div>
      <TranscriptionPreview text={page.transcriptionText} />
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
        Importing...
      {:else}
        Import Strokes
      {/if}
    </button>
  </div>
</div>

<style>
  .page-card {
    background: var(--bg-secondary);
    border-radius: 8px;
    padding: 16px;
    margin-bottom: 12px;
    border: 1px solid var(--border-color, rgba(255, 255, 255, 0.1));
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
    background: var(--bg-tertiary);
    border-radius: 6px;
    color: var(--text-tertiary);
    font-size: 0.875rem;
    margin-bottom: 12px;
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
