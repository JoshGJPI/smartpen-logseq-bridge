<!--
  TranscriptionView.svelte - Main transcription display
-->
<script>
  import { 
    hasTranscription, 
    lastTranscription, 
    transcribedText, 
    transcribedLines, 
    detectedCommands,
    transcriptionSummary,
    lineMetrics,
    isTranscribing,
    logseqConnected,
    log,
    getLogseqSettings,
    strokes,
    selectedStrokes
  } from '$stores';
  import { sendToLogseq, updatePageTranscription } from '$lib/logseq-api.js';
  import { 
    storageStatus, 
    storageStatusMessage,
    setStorageSaving,
    recordSuccessfulSave,
    recordStorageError
  } from '$stores/storage.js';
  
  import LogseqPreview from './LogseqPreview.svelte';
  
  let isSending = false;
  let isSavingStorage = false;
  
  async function handleSendToLogseq() {
    if (!$hasTranscription) {
      log('No transcription to send. Transcribe strokes first.', 'warning');
      return;
    }
    
    isSending = true;
    log('Sending transcription to LogSeq...', 'info');
    
    try {
      const { host, token } = getLogseqSettings();
      const result = await sendToLogseq($transcribedLines, host, token);
      
      if (result.success) {
        log(`Sent ${result.blockCount} blocks to LogSeq`, 'success');
      } else {
        log(`Failed to send to LogSeq: ${result.error}`, 'error');
      }
    } catch (error) {
      log(`Send error: ${error.message}`, 'error');
    } finally {
      isSending = false;
    }
  }
  
  async function handleSaveToStorage() {
    if (!$hasTranscription) {
      log('No transcription to save. Transcribe strokes first.', 'warning');
      return;
    }
    
    // Get page info from strokes
    const relevantStrokes = $selectedStrokes.length > 0 ? $selectedStrokes : $strokes;
    if (relevantStrokes.length === 0) {
      log('No strokes to associate with transcription', 'warning');
      return;
    }
    
    const pageInfo = relevantStrokes[0].pageInfo;
    if (!pageInfo || !pageInfo.book || !pageInfo.page) {
      log('Invalid page information', 'error');
      return;
    }
    
    isSavingStorage = true;
    setStorageSaving(true);
    log(`Saving transcription to Smartpen Data/B${pageInfo.book}/P${pageInfo.page}...`, 'info');
    
    try {
      const { host, token } = getLogseqSettings();
      const result = await updatePageTranscription(
        pageInfo.book,
        pageInfo.page,
        $lastTranscription,
        relevantStrokes.length,
        host,
        token
      );
      
      if (result.success) {
        recordSuccessfulSave(`B${pageInfo.book}/P${pageInfo.page}`, result);
        log(`Saved transcription to ${result.page} (${result.lineCount} lines)`, 'success');
      } else {
        recordStorageError(result.error);
        log(`Failed to save transcription: ${result.error}`, 'error');
      }
    } catch (error) {
      recordStorageError(error.message);
      log(`Save error: ${error.message}`, 'error');
    } finally {
      isSavingStorage = false;
    }
  }
</script>

<div class="transcription-view">
  {#if $isTranscribing}
    <div class="loading-state">
      <div class="spinner"></div>
      <p>Transcribing handwriting...</p>
    </div>
  {:else if !$hasTranscription}
    <div class="empty-state">
      <p>Select strokes and click "Transcribe Selected" to convert handwriting to text.</p>
      <p class="hint">
        <a href="https://developer.myscript.com/" target="_blank" rel="noopener">
          Get MyScript API keys (free: 2,000 requests/month)
        </a>
      </p>
    </div>
  {:else}
    <!-- Action Buttons -->
    <div class="action-section">
      <button 
        class="btn btn-primary save-storage-btn"
        on:click={handleSaveToStorage}
        disabled={isSavingStorage || !$logseqConnected}
        title="Save to Smartpen Data archive page"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
          <polyline points="17 21 17 13 7 13 7 21"/>
          <polyline points="7 3 7 8 15 8"/>
        </svg>
        {isSavingStorage ? 'Saving...' : 'Save to Storage'}
      </button>
      
      <button 
        class="btn btn-success send-btn"
        on:click={handleSendToLogseq}
        disabled={isSending || !$logseqConnected}
        title="Send to today's journal page"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="12" y1="5" x2="12" y2="19"/>
          <polyline points="19 12 12 19 5 12"/>
        </svg>
        {isSending ? 'Sending...' : 'Send to Journal'}
      </button>
      
      {#if !$logseqConnected}
        <p class="hint">Configure LogSeq connection in Settings</p>
      {/if}
      
      {#if $storageStatusMessage}
        <p class="storage-status" class:error={$storageStatus.lastError}>
          {$storageStatusMessage}
        </p>
      {/if}
    </div>
    
    <!-- Transcribed Text -->
    <section class="section">
      <h3>Transcribed Text</h3>
      <pre class="text-output">{$transcribedText}</pre>
    </section>
    
    <!-- Summary Stats -->
    {#if $transcriptionSummary}
      <section class="section stats">
        <div class="stat">
          <span class="value">{$transcriptionSummary.totalLines || 0}</span>
          <span class="label">Lines</span>
        </div>
        <div class="stat">
          <span class="value">{$transcriptionSummary.totalWords || 0}</span>
          <span class="label">Words</span>
        </div>
        <div class="stat">
          <span class="value">{$transcriptionSummary.hasIndentation ? '✓' : '—'}</span>
          <span class="label">Indentation</span>
        </div>
        <div class="stat">
          <span class="value">{$detectedCommands.length || '—'}</span>
          <span class="label">Commands</span>
        </div>
      </section>
    {/if}
    
    <!-- LogSeq Preview -->
    <LogseqPreview lines={$transcribedLines} />
    
    <!-- Line Metrics -->
    {#if $lineMetrics}
      <details class="metrics-details">
        <summary>Line Detection Metrics</summary>
        <div class="metrics">
          <div>Median Height: {$lineMetrics.medianHeight?.toFixed(2) || '-'} px</div>
          <div>Indent Unit: {$lineMetrics.indentUnit?.toFixed(2) || '-'} px</div>
          <div>Line Spacing: {$lineMetrics.lineSpacing?.toFixed(2) || '-'} px</div>
        </div>
      </details>
    {/if}
  {/if}
</div>

<style>
  .transcription-view {
    display: flex;
    flex-direction: column;
    gap: 15px;
    height: 100%;
    overflow-y: auto;
    padding-right: 5px;
  }

  .empty-state, .loading-state {
    text-align: center;
    padding: 40px 20px;
    color: var(--text-secondary);
  }

  .empty-state .hint {
    margin-top: 15px;
  }

  .empty-state a {
    color: var(--accent);
    text-decoration: none;
  }

  .empty-state a:hover {
    text-decoration: underline;
  }

  .loading-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 15px;
  }

  .spinner {
    width: 40px;
    height: 40px;
    border: 3px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .section {
    background: var(--bg-tertiary);
    border-radius: 8px;
    padding: 12px;
  }

  .section h3 {
    font-size: 0.9rem;
    margin-bottom: 10px;
    color: var(--text-primary);
  }

  .text-output {
    background: var(--bg-primary);
    padding: 12px;
    border-radius: 6px;
    font-family: inherit;
    font-size: 0.9rem;
    white-space: pre-wrap;
    word-break: break-word;
    margin: 0;
    max-height: 150px;
    overflow-y: auto;
  }

  .stats {
    display: flex;
    justify-content: space-around;
    flex-wrap: wrap;
    gap: 10px;
  }

  .stat {
    text-align: center;
    min-width: 60px;
  }

  .stat .value {
    display: block;
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--accent);
  }

  .stat .label {
    font-size: 0.7rem;
    color: var(--text-secondary);
    text-transform: uppercase;
  }

  .metrics-details {
    background: var(--bg-tertiary);
    border-radius: 8px;
    padding: 10px;
  }

  .metrics-details summary {
    cursor: pointer;
    color: var(--text-secondary);
    font-size: 0.85rem;
  }

  .metrics {
    margin-top: 10px;
    font-size: 0.8rem;
    color: var(--text-primary);
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .action-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .btn {
    width: 100%;
    padding: 12px 20px;
    border: none;
    border-radius: 8px;
    font-size: 0.9rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }

  .btn:hover:not(:disabled) {
    transform: translateY(-1px);
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .save-storage-btn {
    background: var(--accent);
    color: var(--bg-primary);
  }

  .save-storage-btn:hover:not(:disabled) {
    background: #3b82f6;
  }

  .send-btn {
    background: var(--success);
    color: var(--bg-primary);
  }

  .send-btn:hover:not(:disabled) {
    background: #22c55e;
  }

  .action-section .hint {
    font-size: 0.75rem;
    color: var(--text-secondary);
    text-align: center;
  }
  
  .storage-status {
    font-size: 0.75rem;
    color: var(--text-secondary);
    text-align: center;
    padding: 6px;
    background: var(--bg-tertiary);
    border-radius: 4px;
  }
  
  .storage-status.error {
    color: var(--error);
  }
</style>
