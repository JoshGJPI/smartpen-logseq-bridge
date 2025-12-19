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
    setPageTranscription,
    clearTranscription,
    setIsTranscribing,
    setActiveTab,
    getMyScriptCredentials,
    logseqConnected,
    getLogseqSettings,
    hasTranscription,
    hasPageTranscriptions,
    lastTranscription,
    transferProgress
  } from '$stores';
  import { connectPen, disconnectPen, fetchOfflineData, cancelOfflineTransfer } from '$lib/pen-sdk.js';
  import { transcribeStrokes } from '$lib/myscript-api.js';
  import { updatePageStrokes, updatePageTranscription } from '$lib/logseq-api.js';
  // Removed filtered-strokes import - now handled via user-controlled deselection
  import {
    setStorageSaving,
    recordSuccessfulSave,
    recordStorageError
  } from '$stores/storage.js';
  
  let isConnecting = false;
  let isFetchingOffline = false;
  let isSavingToLogseq = false;
  
  // Determine what data is available to save
  $: hasSaveableData = $strokeCount > 0;
  $: saveButtonText = (() => {
    if (isSavingToLogseq) return 'Saving...';
    if (!$hasTranscription) return 'Save to LogSeq (Strokes)';
    return 'Save to LogSeq (Strokes + Text)';
  })();
  
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
    
    // Group strokes by page
    const strokesByPage = new Map();
    strokesToTranscribe.forEach(stroke => {
      const pageInfo = stroke.pageInfo || {};
      const pageKey = `S${pageInfo.section || 0}/O${pageInfo.owner || 0}/B${pageInfo.book || 0}/P${pageInfo.page || 0}`;
      
      if (!strokesByPage.has(pageKey)) {
        strokesByPage.set(pageKey, {
          strokes: [],
          pageInfo: {
            section: pageInfo.section || 0,
            owner: pageInfo.owner || 0,
            book: pageInfo.book || 0,
            page: pageInfo.page || 0
          }
        });
      }
      
      strokesByPage.get(pageKey).strokes.push(stroke);
    });
    
    const totalPages = strokesByPage.size;
    log(`Transcribing ${transcribeCount} ${transcribeLabel} strokes from ${totalPages} page(s)...`, 'info');
    
    // Clear previous transcriptions
    clearTranscription();
    
    try {
      const { appKey, hmacKey } = getMyScriptCredentials();
      let successCount = 0;
      let errorCount = 0;
      
      // Transcribe each page separately
      for (const [pageKey, pageData] of strokesByPage) {
        const { book, page } = pageData.pageInfo;
        
        try {
          log(`Transcribing Book ${book}, Page ${page}...`, 'info');
          const result = await transcribeStrokes(pageData.strokes, appKey, hmacKey);
          
          // Store transcription for this page
          setPageTranscription(
            pageKey, 
            result, 
            pageData.pageInfo,
            pageData.strokes.length
          );
          
          log(`✓ Book ${book}/Page ${page}: ${result.text?.length || 0} characters, ${result.lines?.length || 0} lines`, 'success');
          successCount++;
        } catch (error) {
          log(`✗ Failed to transcribe Book ${book}/Page ${page}: ${error.message}`, 'error');
          errorCount++;
        }
      }
      
      setActiveTab('transcription');
      
      if (successCount > 0) {
        log(`Transcription complete: ${successCount}/${totalPages} pages successful`, 'success');
      }
      if (errorCount > 0) {
        log(`${errorCount} page(s) failed to transcribe`, 'error');
      }
    } catch (error) {
      log(`Transcription failed: ${error.message}`, 'error');
    } finally {
      setIsTranscribing(false);
    }
  }

  
  async function handleSaveToLogseq() {
    if (!$logseqConnected) {
      log('Please configure LogSeq connection in Settings', 'warning');
      return;
    }
    
    if (!$strokeCount) {
      log('No strokes to save', 'warning');
      return;
    }
    
    isSavingToLogseq = true;
    setStorageSaving(true);
    
    let savedStrokesCount = 0;
    let savedTranscriptionCount = 0;
    let errorCount = 0;
    
    try {
      const { host, token } = getLogseqSettings();
      // Step 1: Save strokes (grouped by page)
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
      
      // Save strokes for each page
      for (const [key, pageStrokes] of strokesByPage) {
        const pageInfo = pageStrokes[0].pageInfo;
        const { book, page } = pageInfo;
        
        try {
          const result = await updatePageStrokes(book, page, pageStrokes, host, token);
          
          if (result.success) {
            recordSuccessfulSave(`B${book}/P${page}`, result);
            
            // Show batching info if applicable
            if (result.batched) {
              log(`Saved strokes to ${result.page} in batches: ${result.added} new, ${result.total} total`, 'success');
            } else {
              log(`Saved strokes to ${result.page}: ${result.added} new, ${result.total} total`, 'success');
            }
            savedStrokesCount++;
            
            // Step 2: If transcription exists for this page, save it too
            if ($hasTranscription) {
              // Check if transcription is for this page
              const transcriptionStrokes = $selectedStrokes.length > 0 ? $selectedStrokes : $strokes;
              const firstTranscriptionStroke = transcriptionStrokes[0];
              
              if (firstTranscriptionStroke && 
                  firstTranscriptionStroke.pageInfo.book === book && 
                  firstTranscriptionStroke.pageInfo.page === page) {
                
                log(`Saving transcription to ${result.page}...`, 'info');
                
                const transcriptionResult = await updatePageTranscription(
                  book,
                  page,
                  $lastTranscription,
                  transcriptionStrokes.length,
                  host,
                  token
                );
                
                if (transcriptionResult.success) {
                  log(`Saved transcription to ${transcriptionResult.page} (${transcriptionResult.lineCount} lines)`, 'success');
                  savedTranscriptionCount++;
                } else {
                  log(`Failed to save transcription: ${transcriptionResult.error}`, 'warning');
                }
              }
            }
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
      
      // Summary
      if (savedStrokesCount > 0) {
        const summary = savedTranscriptionCount > 0 
          ? `Saved ${savedStrokesCount} page(s) with strokes and transcription`
          : `Saved ${savedStrokesCount} page(s) with strokes`;
        log(summary, 'success');
      }
      if (errorCount > 0) {
        log(`Failed to save ${errorCount} page(s)`, 'error');
      }
    } finally {
      isSavingToLogseq = false;
    }
  }
</script>

<div class="action-bar">
  <!-- Transfer Progress Popup -->
  {#if $transferProgress.active}
    <div class="transfer-popup">
      <div class="transfer-header">
        <span>📥 Importing Offline Data</span>
        {#if $transferProgress.canCancel}
          <button class="cancel-btn" on:click={cancelOfflineTransfer} title="Cancel transfer">✕</button>
        {/if}
      </div>
      <div class="transfer-bar">
        <div class="transfer-fill indeterminate"></div>
      </div>
      <div class="transfer-stats">
        <span>
          {#if $transferProgress.currentBook > 0}
            Book {$transferProgress.currentBook}/{$transferProgress.totalBooks}, {$transferProgress.receivedStrokes} strokes
          {:else}
            {$transferProgress.status === 'requesting' ? 'Requesting...' : 'Waiting...'}
          {/if}
        </span>
        <span>{$transferProgress.elapsedSeconds}s</span>
      </div>
    </div>
  {/if}

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
    disabled={!$penConnected || !$penAuthorized || isFetchingOffline || $transferProgress.active}
    title="Fetch offline notes from pen memory"
  >
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="7 10 12 15 17 10"/>
      <line x1="12" y1="15" x2="12" y2="3"/>
    </svg>
    {#if isFetchingOffline || $transferProgress.active}
      Fetching...
    {:else}
      Fetch Notes
    {/if}
  </button>
  
  <button 
    class="action-btn save-logseq-btn"
    on:click={handleSaveToLogseq}
    disabled={!hasSaveableData || isSavingToLogseq || !$logseqConnected}
    title="Save strokes and transcription (if available) to LogSeq storage"
  >
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
      <polyline points="17 21 17 13 7 13 7 21"/>
      <polyline points="7 3 7 8 15 8"/>
    </svg>
    {saveButtonText}
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
    position: relative;
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
  
  .save-logseq-btn {
    background: var(--success);
    color: white;
    border-color: var(--success);
  }
  
  .save-logseq-btn:hover:not(:disabled) {
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

  /* Transfer Progress Popup */
  .transfer-popup {
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: 8px;
    background: var(--bg-secondary);
    border: 1px solid var(--accent);
    border-radius: 8px;
    padding: 12px 16px;
    min-width: 280px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    z-index: 100;
  }

  .transfer-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
    font-size: 0.9rem;
    font-weight: 500;
  }

  .cancel-btn {
    background: var(--error);
    color: white;
    border: none;
    border-radius: 4px;
    padding: 2px 8px;
    cursor: pointer;
    font-size: 0.85rem;
    transition: background 0.2s;
  }

  .cancel-btn:hover {
    background: #dc2626;
  }

  .transfer-bar {
    height: 8px;
    background: var(--bg-tertiary);
    border-radius: 4px;
    overflow: hidden;
    margin-bottom: 8px;
  }

  .transfer-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--success), #22c55e);
    border-radius: 4px;
    transition: width 0.3s ease;
  }

  .transfer-fill.indeterminate {
    width: 30% !important;
    animation: transfer-indeterminate 1.5s infinite ease-in-out;
  }

  @keyframes transfer-indeterminate {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(400%); }
  }

  .transfer-stats {
    display: flex;
    justify-content: space-between;
    font-size: 0.8rem;
    color: var(--text-secondary);
  }

  .transfer-stats span:first-child {
    color: var(--success);
  }
</style>
