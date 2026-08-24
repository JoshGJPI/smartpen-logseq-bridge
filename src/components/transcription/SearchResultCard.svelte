<!--
  SearchResultCard.svelte — one page in the Transcripts → Search results.

  The dialog version (TranscriptSearchResult) rendered the *entire* transcript
  untruncated, which was tolerable in a 700px modal and is not in a 450px panel.
  This one clamps to a few lines and expands on demand.

  Actions are per result rather than select-many-then-import-all: in a panel the
  common case is wanting one page, and a dialog's batch flow costs an extra
  click for it.
-->
<script>
  import { createEventDispatcher } from 'svelte';
  import { highlightMatches } from '$lib/transcript-search.js';
  import { filterTranscriptionProperties, formatBookName } from '$utils/formatting.js';
  import { bookAliases } from '$stores';

  export let page;
  export let query = '';
  export let inCanvas = false;
  export let busy = false;

  const dispatch = createEventDispatcher();

  let expanded = false;

  $: bookName = formatBookName(page.book, $bookAliases, 'alias-only');
  $: transcript = filterTranscriptionProperties(page.transcriptionText || '');
  $: highlighted = highlightMatches(transcript, query);

  // Only offer "show more" when there is meaningfully more to show.
  $: isLong = transcript.length > 220 || (transcript.match(/\n/g) || []).length > 3;

  function formatDate(timestamp) {
    if (!timestamp) return null;
    return new Date(timestamp).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  }
</script>

<div class="result-card">
  <div class="result-head">
    <span class="result-title">
      <span class="book">{bookName}</span><span class="page">/ P{page.pageId}</span>
    </span>
    <span class="result-meta">
      {#if formatDate(page.lastUpdated)}{formatDate(page.lastUpdated)} · {/if}{page.strokeCount} strokes
    </span>
  </div>

  <div class="result-transcript" class:clamped={!expanded && isLong}>
    {@html highlighted}
  </div>

  {#if isLong}
    <button class="more-btn" on:click={() => (expanded = !expanded)}>
      {expanded ? 'Show less' : 'Show more'}
    </button>
  {/if}

  <div class="result-actions">
    <button
      class="act-btn"
      on:click={() => dispatch('import')}
      disabled={inCanvas || busy}
      title={inCanvas
        ? 'This page is already on the canvas'
        : 'Load this page\'s strokes into the Editor'}
    >
      {inCanvas ? '✓ In canvas' : 'Import strokes'}
    </button>
    <button
      class="act-btn"
      on:click={() => dispatch('open')}
      disabled={busy}
      title="Open this page in Book View"
    >
      Open in Book View
    </button>
  </div>
</div>

<style>
  .result-card {
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px 12px;
    background: var(--bg-secondary);
    display: flex;
    flex-direction: column;
    gap: 7px;
  }

  .result-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
    flex-wrap: wrap;
  }

  .result-title {
    font-size: 0.82rem;
    color: var(--text-primary);
    min-width: 0;
  }

  .result-title .book {
    font-weight: 600;
  }

  .result-title .page {
    margin-left: 5px;
    color: var(--text-secondary);
    font-weight: 400;
  }

  .result-meta {
    font-size: 0.68rem;
    color: var(--text-secondary);
    white-space: nowrap;
  }

  .result-transcript {
    font-size: 0.75rem;
    line-height: 1.5;
    color: var(--text-secondary);
    white-space: pre-wrap;
    word-break: break-word;
  }

  .result-transcript.clamped {
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  /* highlightMatches escapes the text and wraps hits in <mark>. */
  .result-transcript :global(mark) {
    background: rgba(251, 191, 36, 0.25);
    color: var(--warning);
    border-radius: 2px;
    padding: 0 1px;
  }

  .more-btn {
    align-self: flex-start;
    padding: 0;
    background: none;
    border: none;
    color: var(--accent);
    font-size: 0.7rem;
    cursor: pointer;
  }

  .more-btn:hover {
    text-decoration: underline;
  }

  .result-actions {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .act-btn {
    padding: 4px 9px;
    font-size: 0.72rem;
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text-primary);
    cursor: pointer;
    transition: all 0.15s;
  }

  .act-btn:hover:not(:disabled) {
    border-color: var(--accent);
  }

  .act-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
</style>
