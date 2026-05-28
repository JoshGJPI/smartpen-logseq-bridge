<!--
  LogSeqDbTab.svelte — Data Explorer tab (v2.0: folder-backed).
  Source of truth is now <dataRoot>/pages/B###/P##.json files.
  Kept under the old filename for now; rename happens in Phase 4.
-->
<script>
  import { onMount } from 'svelte';
  import { logseqPages, pagesByBook, bookIds, isScanning, lastScanTime, log } from '$stores';
  import { dataRoot, dataFolderReady } from '$stores/settings.js';
  import { scanLocalPages } from '$lib/storage/scan.js';
  import DbHeader from './DbHeader.svelte';
  import BookAccordion from './BookAccordion.svelte';

  // Scan on mount once the data folder is known to be ready
  onMount(async () => {
    if ($dataFolderReady && $logseqPages.length === 0) {
      await handleRefresh();
    }
  });

  // Re-scan automatically when the data folder becomes ready (e.g. user picks one)
  let lastReadyState = $dataFolderReady;
  $: if ($dataFolderReady && !lastReadyState) {
    lastReadyState = true;
    handleRefresh();
  }

  async function handleRefresh() {
    await scanLocalPages();
  }
</script>

<div class="logseq-db-tab">
  <DbHeader
    connected={$dataFolderReady}
    scanning={$isScanning}
    lastScan={$lastScanTime}
    on:refresh={handleRefresh}
  />

  {#if !$dataRoot}
    <div class="empty-state">
      <div class="icon">📁</div>
      <p class="title">No data folder set</p>
      <p class="hint">Pick a data folder in Settings to see your saved pages.</p>
    </div>
  {:else if !$dataFolderReady}
    <div class="empty-state">
      <div class="icon">⚠️</div>
      <p class="title">Data folder unavailable</p>
      <p class="hint">Check that <code>{$dataRoot}</code> exists and is readable.</p>
      <button class="retry-btn" on:click={handleRefresh}>Retry</button>
    </div>
  {:else if $isScanning}
    <div class="scanning">
      <span class="spinner">⏳</span>
      <span>Scanning data folder…</span>
    </div>
  {:else if $bookIds.length === 0}
    <div class="empty-state">
      <div class="icon">📚</div>
      <p class="title">No saved pages yet</p>
      <p class="hint">Capture strokes from your pen and save them to populate this view.</p>
    </div>
  {:else}
    <div class="book-list">
      {#each $bookIds as bookId (bookId)}
        <BookAccordion
          {bookId}
          pages={$pagesByBook[bookId]}
        />
      {/each}
    </div>
  {/if}
</div>

<style>
  .logseq-db-tab {
    height: 100%;
    display: flex;
    flex-direction: column;
  }
  
  .connecting {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 40px 20px;
    color: var(--text-secondary);
  }
  
  .connecting .spinner {
    font-size: 1.5rem;
    animation: pulse 1.5s ease-in-out infinite;
  }
  
  @keyframes pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.5; transform: scale(0.95); }
  }
  
  .empty-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 40px 20px;
    text-align: center;
  }
  
  .empty-state .icon {
    font-size: 4rem;
    margin-bottom: 16px;
    opacity: 0.5;
  }
  
  .empty-state .title {
    font-size: 1.2rem;
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: 8px;
  }
  
  .empty-state .hint {
    font-size: 0.875rem;
    color: var(--text-tertiary);
    max-width: 300px;
    margin-bottom: 16px;
  }
  
  .retry-btn {
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
  
  .retry-btn:hover {
    opacity: 0.9;
    transform: translateY(-1px);
  }
  
  .scanning {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 40px 20px;
    color: var(--text-secondary);
  }
  
  .spinner {
    font-size: 1.5rem;
    animation: spin 1s linear infinite;
  }
  
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  
  .book-list {
    flex: 1;
    overflow-y: auto;
    padding: 0;
  }
</style>
