<!--
  TranscriptSearchResult.svelte - Individual search result card
-->
<script>
  import { createEventDispatcher } from 'svelte';
  import { highlightMatches } from '$lib/transcript-search.js';
  import { filterTranscriptionProperties } from '$utils/formatting.js';
  import { bookAliases } from '$stores';
  
  export let page;
  export let query = '';
  export let selected = false;
  export let disabled = false;
  
  const dispatch = createEventDispatcher();
  
  function handleToggle() {
    if (!disabled) {
      dispatch('toggle');
    }
  }
  
  function formatDate(timestamp) {
    if (!timestamp) return 'Unknown';
    return new Date(timestamp).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  }
  
  // Get book alias or fallback
  $: bookName = $bookAliases[page.book] || `Book ${page.book}`;
  
  // Filter properties and show full transcript (no truncation)
  $: transcriptPreview = filterTranscriptionProperties(page.transcriptionText || '');
  $: highlightedText = highlightMatches(transcriptPreview, query);
</script>

<div 
  class="result-card" 
  class:selected
  class:disabled
  on:click={handleToggle}
>
  <div class="result-header">
    <input 
      type="checkbox" 
      checked={selected}
      {disabled}
      on:click|stopPropagation
    />
    <div class="result-title">
      <strong>{bookName} - Page {page.page}</strong>
    </div>
  </div>
  
  <div class="result-meta">
    <span>{formatDate(page.lastUpdated)}</span>
    <span class="separator">•</span>
    <span>{page.strokeCount} strokes</span>
  </div>
  
  <div class="result-transcript">
    {@html highlightedText}
  </div>
</div>

<style>
  .result-card {
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 14px;
    margin-bottom: 10px;
    cursor: pointer;
    transition: all 0.2s;
  }
  
  .result-card:hover:not(.disabled) {
    background: var(--bg-primary);
    border-color: var(--accent);
  }
  
  .result-card.selected {
    border-color: var(--accent);
    background: rgba(233, 69, 96, 0.1);
  }
  
  .result-card.disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  
  .result-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
  }
  
  .result-header input[type="checkbox"] {
    width: 18px;
    height: 18px;
    cursor: pointer;
  }
  
  .result-title {
    flex: 1;
    color: var(--text-primary);
    font-size: 1rem;
  }
  
  .result-meta {
    display: flex;
    gap: 8px;
    font-size: 0.8rem;
    color: var(--text-secondary);
    margin-bottom: 10px;
    padding-left: 28px;
  }
  
  .separator {
    color: var(--text-tertiary);
  }
  
  .result-transcript {
    padding: 10px;
    background: rgba(0, 0, 0, 0.2);
    border-radius: 6px;
    color: var(--text-secondary);
    font-size: 0.875rem;
    line-height: 1.5;
    margin-left: 28px;
    white-space: pre-wrap;
  }
  
  .result-transcript :global(mark) {
    background: rgba(255, 235, 59, 0.4);
    color: var(--text-primary);
    padding: 2px 0;
    border-radius: 2px;
  }
</style>
