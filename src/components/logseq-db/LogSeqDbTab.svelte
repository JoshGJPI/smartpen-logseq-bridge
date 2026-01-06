<!--
  LogSeqDbTab.svelte - Main LogSeq Database Explorer tab
-->
<script>
  import { onMount } from 'svelte';
  import { logseqPages, pagesByBook, bookIds, isScanning, lastScanTime } from '$stores';
  import { logseqConnected, setLogseqStatus, getLogseqSettings, log } from '$stores';
  import { scanLogSeqPages } from '$lib/logseq-scanner.js';
  import { testLogseqConnection, scanBookAliases } from '$lib/logseq-api.js';
  import { setBookAliases } from '$stores/book-aliases.js';
  import DbHeader from './DbHeader.svelte';
  import BookAccordion from './BookAccordion.svelte';
  
  let isConnecting = false;
  
  // Auto-connect and scan on mount if not already connected
  onMount(async () => {
    if (!$logseqConnected) {
      await attemptConnection();
    } else if ($logseqPages.length === 0) {
      // Already connected but no pages loaded - just scan
      await handleRefresh();
    }
  });
  
  async function attemptConnection() {
    isConnecting = true;
    
    try {
      const { host, token } = getLogseqSettings();
      
      // Try to connect
      const result = await testLogseqConnection(host, token);
      
      if (result.success) {
        setLogseqStatus(true, `LogSeq: ${result.graphName || 'Connected'}`);
        log(`Connected to LogSeq graph: ${result.graphName}`, 'success');
        
        // Load book aliases
        try {
          const aliases = await scanBookAliases(host, token);
          if (Object.keys(aliases).length > 0) {
            setBookAliases(aliases);
            log(`Loaded ${Object.keys(aliases).length} book aliases`, 'info');
          }
        } catch (aliasError) {
          console.warn('Failed to load book aliases:', aliasError);
        }
        
        // Scan for pages
        await handleRefresh();
      } else {
        setLogseqStatus(false, 'LogSeq: Not Connected');
        // Don't log error on auto-connect failure - it's expected if LogSeq isn't running
      }
    } catch (error) {
      setLogseqStatus(false, 'LogSeq: Error');
      console.error('Auto-connect error:', error);
    } finally {
      isConnecting = false;
    }
  }
  
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
  
  {#if isConnecting}
    <div class="connecting">
      <span class="spinner">🔌</span>
      <span>Attempting to connect to LogSeq...</span>
    </div>
  {:else if !$logseqConnected}
    <div class="empty-state">
      <div class="icon">🔌</div>
      <p class="title">Connect to LogSeq</p>
      <p class="hint">Make sure LogSeq is running with HTTP API enabled.</p>
      <button class="retry-btn" on:click={attemptConnection}>Try Again</button>
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
