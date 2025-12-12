<!--
  ActionBar.svelte - Compact action buttons for header
-->
<script>
  import { 
    penConnected, 
    penAuthorized, 
    log, 
    clearStrokes, 
    strokeCount,
    hasSelection,
    selectionCount,
    selectedStrokes,
    strokes,
    hasMyScriptCredentials,
    isTranscribing,
    setTranscription,
    setIsTranscribing,
    setActiveTab,
    getMyScriptCredentials,
    logseqConnected,
    getLogseqSettings
  } from '$stores';
  import { connectPen, disconnectPen, fetchOfflineData } from '$lib/pen-sdk.js';
  import { transcribeStrokes } from '$lib/myscript-api.js';
  import { updatePageStrokes } from '$lib/logseq-api.js';
  import {
    setStorageSaving,
    recordSuccessfulSave,
    recordStorageError
  } from '$stores/storage.js';
  
  let isConnecting = false;
  let isFetchingOffline = false;
  let isSavingStrokes = false;
  
  // Determine which strokes to transcribe (selected or all)
  $: strokesToTranscribe = $hasSelection ? $selectedStrokes : $strokes;
  $: transcribeCount = $hasSelection ? $selectionCount : $strokeCount;
  $: hasStrokes = $strokeCount > 0;
  $: canTranscribe = $hasMyScriptCredentials && hasStrokes && !$isTranscribing;
  
  async function handleConnect() {
    isConnecting = true;
    try {
      await connectPen();
    } catch (error) {
      log(`Connection failed: ${error.message}`, 'error');
    } finally {
      isConnecting = false;
    }
  }
  
  async function handleDisconnect() {
    try {
      await disconnectPen();
    } catch (error) {
      log(`Disconnect failed: ${error.message}`, 'error');
    }
  }
  
  async function handleFetchOffline() {
    isFetchingOffline = true;
    try {
      await fetchOfflineData();
    } catch (error) {
      log(`Failed to fetch offline data: ${error.message}`, 'error');
    } finally {
      isFetchingOffline = false;
    }
  }
  
  function handleClearCanvas() {
    clearStrokes();
    log('Canvas cleared', 'info');
  }
  
  async function handleTranscribe() {
    if (!$hasMyScriptCredentials) {
      log('Please configure MyScript API credentials in Settings', 'warning');
      return;
    }
    
    if (!hasStrokes) {
      log('No strokes available for transcription', 'warning');
      return;
    }
    
    setIsTranscribing(true);
    const transcribeLabel = $hasSelection ? 'selected' : 'all';
    log(`Transcribing ${transcribeCount} ${transcribeLabel} strokes...`, 'info');
    
    try {
      const { appKey, hmacKey } = getMyScriptCredentials();
      const result = await transcribeStrokes(strokesToTranscribe, appKey, hmacKey);
      
      setTranscription(result);
      setActiveTab('transcription');
      log(`Transcription complete: ${result.text?.length || 0} characters`, 'success');
    } catch (error) {
      log(`Transcription failed: ${error.message}`, 'error');
    } finally {
      setIsTranscribing(false);
    }
  }
  
  async function handleSaveRawStrokes() {
    if (!$logseqConnected) {
      log('Please configure LogSeq connection in Settings', 'warning');
      return;
    }
    
    if (!hasStrokes) {
      log('No strokes to save', 'warning');
      return;
    }
    
    // Group strokes by page
    const strokesByPage = new Map();
    $strokes.forEach(stroke => {
      const pageInfo = stroke.pageInfo;
      if (!pageInfo || !pageInfo.book || !pageInfo.page) return;
      
      const key = `${pageInfo.book}-${pageInfo.page}`;
      if (!strokesByPage.has(key)) {
        strokesByPage.set(key, []);
      }
      strokesByPage.get(key).push(stroke);
    });
    
    if (strokesByPage.size === 0) {
      log('No valid page information found in strokes', 'error');
      return;
    }
    
    isSavingStrokes = true;
    setStorageSaving(true);
    
    let savedCount = 0;
    let errorCount = 0;
    
    for (const [key, pageStrokes] of strokesByPage) {
      const pageInfo = pageStrokes[0].pageInfo;
      const { book, page } = pageInfo;
      
      log(`Saving ${pageStrokes.length} strokes to Smartpen Data/B${book}/P${page}...`, 'info');
      
      try {
        const { host, token } = getLogseqSettings();
        const result = await updatePageStrokes(book, page, pageStrokes, host, token);
        
        if (result.success) {
          recordSuccessfulSave(`B${book}/P${page}`, result);
          log(`Saved to ${result.page}: ${result.added} new, ${result.total} total`, 'success');
          savedCount++;
        } else {
          recordStorageError(result.error);
          log(`Failed to save page ${book}/${page}: ${result.error}`, 'error');
          errorCount++;
        }
      } catch (error) {
        recordStorageError(error.message);
        log(`Error saving page ${book}/${page}: ${error.message}`, 'error');
        errorCount++;
      }
    }
    
    if (savedCount > 0) {
      log(`Saved ${savedCount} page(s) to LogSeq storage`, 'success');
    }
    if (errorCount > 0) {
      log(`Failed to save ${errorCount} page(s)`, 'error');
    }
    
    isSavingStrokes = false;
  }
</script>

<div class="action-bar">
  {#if !$penConnected}
    <button 
      class="action-btn connect-btn" 
      on:click={handleConnect}
      disabled={isConnecting}
      title="Connect to SmartPen via Bluetooth"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 2v20M17 7l-5 5 5 5M7 7l5 5-5 5"/>
      </svg>
      {#if isConnecting}
        Connecting...
      {:else}
        Connect
      {/if}
    </button>
  {:else}
    <button 
      class="action-btn disconnect-btn" 
      on:click={handleDisconnect}
      title="Disconnect from SmartPen"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M18 6L6 18M6 6l12 12"/>
      </svg>
      Disconnect
    </button>
  {/if}
  
  <button 
    class="action-btn"
    on:click={handleFetchOffline}
    disabled={!$penConnected || !$penAuthorized || isFetchingOffline}
    title="Fetch offline notes from pen memory"
  >
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="7 10 12 15 17 10"/>
      <line x1="12" y1="15" x2="12" y2="3"/>
    </svg>
    {#if isFetchingOffline}
      Fetching...
    {:else}
      Fetch Notes
    {/if}
  </button>
  
  <button 
    class="action-btn save-strokes-btn"
    on:click={handleSaveRawStrokes}
    disabled={!hasStrokes || isSavingStrokes || !$logseqConnected}
    title="Save raw strokes to Smartpen Data archive"
  >
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
      <polyline points="17 21 17 13 7 13 7 21"/>
      <polyline points="7 3 7 8 15 8"/>
    </svg>
    {#if isSavingStrokes}
      Saving...
    {:else}
      Save Strokes
    {/if}
  </button>
  
  <button 
    class="action-btn"
    on:click={handleClearCanvas}
    title="Clear all strokes from canvas"
  >
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polyline points="3 6 5 6 21 6"/>
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
    </svg>
    Clear
  </button>
  
  <div class="divider"></div>
  
  <button 
    class="action-btn transcribe-btn"
    on:click={handleTranscribe}
    disabled={!canTranscribe}
    title="Transcribe handwriting to text using MyScript"
  >
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
    </svg>
    {#if $isTranscribing}
      Transcribing...
    {:else}
      Transcribe ({transcribeCount})
    {/if}
  </button>
</div>

<style>
  .action-bar {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .action-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 16px;
    border: none;
    border-radius: 6px;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
    background: var(--bg-secondary);
    color: var(--text-primary);
    border: 1px solid var(--border);
    white-space: nowrap;
  }

  .action-btn:hover:not(:disabled) {
    background: var(--bg-tertiary);
    border-color: var(--accent);
    transform: translateY(-1px);
  }

  .action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .connect-btn {
    background: var(--accent);
    color: white;
    border-color: var(--accent);
  }

  .connect-btn:hover:not(:disabled) {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
  }

  .disconnect-btn {
    background: var(--bg-tertiary);
  }

  .transcribe-btn {
    background: var(--accent);
    color: white;
    border-color: var(--accent);
  }

  .transcribe-btn:hover:not(:disabled) {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
  }
  
  .save-strokes-btn {
    background: var(--success);
    color: white;
    border-color: var(--success);
  }
  
  .save-strokes-btn:hover:not(:disabled) {
    background: #22c55e;
    border-color: #22c55e;
  }

  .divider {
    width: 1px;
    height: 24px;
    background: var(--border);
    margin: 0 4px;
  }

  .action-btn svg {
    flex-shrink: 0;
  }

  /* Responsive: hide text labels on smaller screens */
  @media (max-width: 1400px) {
    .action-btn {
      padding: 8px 12px;
      font-size: 0;
    }
    
    .action-btn svg {
      margin: 0;
    }
  }
</style>
