<!--
  LogSeqDbTab.svelte - Main LogSeq Database Explorer tab
-->
<script>
  import { onMount } from 'svelte';
  import { logseqPages, pagesByBook, bookIds, isScanning, lastScanTime } from '$stores';
  import { logseqConnected } from '$stores';
  import { scanLogSeqPages } from '$lib/logseq-scanner.js';
  import DbHeader from './DbHeader.svelte';
  import BookAccordion from './BookAccordion.svelte';
  
  // Auto-scan on mount if connected and no pages loaded
  onMount(() => {
    if ($logseqConnected && $logseqPages.length === 0) {
      handleRefresh();
    }
  });
  
  async function handleRefresh() {
    await scanLogSeqPages();
  }
</script>

<div class="logseq-db-tab">
  <DbHeader 
    connected={$logseqConnected}
    scanning={$isScanning}
    lastScan={$lastScanTime}
    on:refresh={handleRefresh}
  />
  
  {#if !$logseqConnected}
    <div class="empty-state">
      <div class="icon">🔌</div>
      <p class="title">Connect to LogSeq</p>
      <p class="hint">Configure connection in Settings to browse stored smartpen data.</p>
    </div>
  {:else if $isScanning}
    <div class="scanning">
      <span class="spinner">⏳</span>
      <span>Scanning LogSeq database...</span>
    </div>
  {:else if $bookIds.length === 0}
    <div class="empty-state">
      <div class="icon">📚</div>
      <p class="title">No smartpen data found</p>
      <p class="hint">Save strokes to LogSeq to see them here.</p>
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
