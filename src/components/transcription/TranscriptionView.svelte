<!--
  TranscriptionView.svelte - Main transcription display with page groupings
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
    transcriptionSourcePages,
    transcriptionByPage
  } from '$stores';
  import { sendToLogseq } from '$lib/logseq-api.js';
  
  import LogseqPreview from './LogseqPreview.svelte';
  
  let isSending = false;
  
  // Organize page groups for display
  $: pageGroupsArray = (() => {
    if (!$transcriptionByPage || $transcriptionByPage.size === 0) return [];
    
    const groups = [];
    const combined = $transcriptionByPage.get('__combined__');
    
    // Add individual pages first (excluding combined)
    $transcriptionByPage.forEach((data, key) => {
      if (key !== '__combined__') {
        groups.push({ key, ...data });
      }
    });
    
    // Sort by book then page
    groups.sort((a, b) => {
      if (a.book !== b.book) return a.book - b.book;
      return a.page - b.page;
    });
    
    // Add combined at the end if it exists and there are multiple pages
    if (combined && groups.length > 1) {
      groups.push({ key: '__combined__', ...combined, isCombined: true });
    }
    
    return groups;
  })();
  
  // Check if we have multiple source pages
  $: hasMultiplePages = $transcriptionSourcePages && $transcriptionSourcePages.length > 1;
  
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
  
  function formatPageLabel(pageData) {
    if (pageData.isCombined) {
      return 'Combined View';
    }
    return `Book ${pageData.book} / Page ${pageData.page}`;
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
        class="btn btn-success send-btn"
        on:click={handleSendToLogseq}
        disabled={isSending || !$logseqConnected}
        title="Send to today's journal page as working notes"
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
    </div>
    
    <!-- Source Pages Summary -->
    {#if $transcriptionSourcePages && $transcriptionSourcePages.length > 0}
      <section class="section source-pages">
        <h3>Source Pages</h3>
        <div class="page-tags">
          {#each $transcriptionSourcePages as pageInfo (pageInfo.key)}
            <span class="page-tag">
              <span class="book-badge">B{pageInfo.book}</span>
              <span class="page-number">P{pageInfo.page}</span>
              <span class="stroke-count">{pageInfo.strokeCount} strokes</span>
            </span>
          {/each}
        </div>
      </section>
    {/if}
    
    <!-- Transcribed Text by Page -->
    {#if hasMultiplePages}
      <!-- Multi-page view with tabs/sections -->
      <section class="section">
        <h3>Transcribed Text</h3>
        <div class="page-groups">
          {#each pageGroupsArray as pageGroup (pageGroup.key)}
            <div class="page-group" class:combined={pageGroup.isCombined}>
              <div class="page-group-header">
                <span class="page-group-label">{formatPageLabel(pageGroup)}</span>
                {#if !pageGroup.isCombined}
                  <span class="page-group-strokes">{pageGroup.strokeCount} strokes</span>
                {/if}
              </div>
              
              {#if pageGroup.text}
                <pre class="text-output">{pageGroup.text}</pre>
              {:else}
                <p class="no-individual-text">
                  Text transcribed as part of combined view below
                </p>
              {/if}
            </div>
          {/each}
        </div>
      </section>
    {:else}
      <!-- Single page view -->
      <section class="section">
        <h3>
          Transcribed Text
          {#if pageGroupsArray.length > 0 && !pageGroupsArray[0].isCombined}
            <span class="section-subtitle">
              (B{pageGroupsArray[0].book}/P{pageGroupsArray[0].page})
            </span>
          {/if}
        </h3>
        <pre class="text-output">{$transcribedText}</pre>
      </section>
    {/if}
    
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
        {#if $transcriptionSourcePages}
          <div class="stat">
            <span class="value">{$transcriptionSourcePages.length}</span>
            <span class="label">Pages</span>
          </div>
        {/if}
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
    display: flex;
    align-items: center;
    gap: 8px;
  }
  
  .section-subtitle {
    font-size: 0.75rem;
    font-weight: normal;
    color: var(--text-secondary);
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
  
  /* Source Pages Section */
  .source-pages h3 {
    margin-bottom: 8px;
  }
  
  .page-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  
  .page-tag {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    background: var(--bg-secondary);
    border-radius: 6px;
    font-size: 0.8rem;
  }
  
  .book-badge {
    background: var(--accent);
    color: white;
    padding: 2px 6px;
    border-radius: 4px;
    font-weight: 600;
    font-size: 0.7rem;
  }
  
  .page-number {
    color: var(--text-primary);
    font-weight: 500;
  }
  
  .stroke-count {
    color: var(--text-secondary);
    font-size: 0.7rem;
  }
  
  /* Page Groups for multi-page transcriptions */
  .page-groups {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  
  .page-group {
    background: var(--bg-secondary);
    border-radius: 6px;
    padding: 10px;
    border-left: 3px solid var(--accent);
  }
  
  .page-group.combined {
    border-left-color: var(--success);
    background: var(--bg-primary);
  }
  
  .page-group-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--border);
  }
  
  .page-group-label {
    font-weight: 600;
    font-size: 0.85rem;
    color: var(--accent);
  }
  
  .page-group.combined .page-group-label {
    color: var(--success);
  }
  
  .page-group-strokes {
    font-size: 0.7rem;
    color: var(--text-secondary);
  }
  
  .page-group .text-output {
    max-height: 100px;
  }
  
  .no-individual-text {
    font-size: 0.8rem;
    color: var(--text-secondary);
    font-style: italic;
    margin: 0;
    padding: 8px;
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
</style>
