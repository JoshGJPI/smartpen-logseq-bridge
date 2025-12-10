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
    isTranscribing
  } from '$stores';
  
  import LineDisplay from './LineDisplay.svelte';
  import CommandList from './CommandList.svelte';
  import LogseqPreview from './LogseqPreview.svelte';
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
    
    <!-- Lines with Hierarchy -->
    {#if $transcribedLines.length > 0}
      <section class="section">
        <h3>Lines with Hierarchy ({$transcribedLines.length})</h3>
        <div class="lines-list">
          {#each $transcribedLines as line, i (i)}
            <LineDisplay {line} index={i} />
          {/each}
        </div>
      </section>
    {/if}
    
    <!-- Detected Commands -->
    {#if $detectedCommands.length > 0}
      <CommandList commands={$detectedCommands} />
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

  .lines-list {
    display: flex;
    flex-direction: column;
    gap: 5px;
    max-height: 200px;
    overflow-y: auto;
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
</style>
