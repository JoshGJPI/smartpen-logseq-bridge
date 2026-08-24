<!--
  TranscriptSearch.svelte — full-text search over saved transcripts.

  Was SearchTranscriptsDialog, a modal opened from the canvas toolbar. Search is
  a browsing activity, not a one-shot task, so it lives in the left panel beside
  the other page lists and stays open while you work.

  Search runs over the metadata-only `savedPages` index (perf #3) — the scan
  carries `transcriptionText` precisely so this works without loading a single
  stroke off disk.
-->
<script>
  import { onDestroy } from 'svelte';
  import { savedPages, canvasPageKeys, log } from '$stores';
  import { setViewerSelection, setViewerMode } from '$stores/viewer.js';
  import { importStrokesFromFolder } from '$lib/storage/load-page.js';
  import { searchPages } from '$lib/transcript-search.js';
  import SearchResultCard from './SearchResultCard.svelte';

  /** Bound by the parent so the toolbar's 🔍 can focus this input. */
  export let searchInput = null;

  let searchQuery = '';
  let searchResults = [];
  let importingKey = null;
  let debounceTimer;

  $: pagesWithTranscription = $savedPages.filter(p => p.transcriptionText);

  $: {
    clearTimeout(debounceTimer);
    const query = searchQuery;
    const pool = pagesWithTranscription;
    debounceTimer = setTimeout(() => {
      searchResults = query.trim() ? searchPages(pool, query) : pool;
    }, 200);
  }

  onDestroy(() => clearTimeout(debounceTimer));

  function isInCanvas(page) {
    return $canvasPageKeys.has(`B${page.book}/P${page.pageId}`);
  }

  async function handleImport(page) {
    importingKey = page.pageName;
    try {
      const result = await importStrokesFromFolder(page);
      if (!result?.success) {
        log(`Could not import B${page.book}/P${page.pageId}`, 'error');
      }
    } catch (error) {
      log(`Import failed: ${error.message}`, 'error');
    } finally {
      importingKey = null;
    }
  }

  function handleOpen(page) {
    setViewerSelection(page.book, page.pageId);
    setViewerMode('book');
  }

  function clearQuery() {
    searchQuery = '';
    searchInput?.focus();
  }
</script>

<div class="transcript-search">
  <div class="search-bar">
    <span class="search-icon" aria-hidden="true">🔍</span>
    <input
      bind:this={searchInput}
      bind:value={searchQuery}
      type="text"
      placeholder="Search transcribed text…"
      aria-label="Search transcribed text"
    />
    {#if searchQuery}
      <button class="clear-btn" on:click={clearQuery} title="Clear search">✕</button>
    {/if}
  </div>

  {#if pagesWithTranscription.length === 0}
    <div class="empty-state">
      <p class="empty-title">Nothing to search yet</p>
      <p>
        Transcribe and save some pages first — or scan your data folder if you
        have saved pages the app has not seen this session.
      </p>
    </div>
  {:else if searchQuery.trim() && searchResults.length === 0}
    <div class="empty-state">
      <p class="empty-title">No matches</p>
      <p>Nothing in {pagesWithTranscription.length} transcribed pages matches “{searchQuery}”.</p>
    </div>
  {:else}
    <div class="results-count">
      {#if searchQuery.trim()}
        {searchResults.length} of {pagesWithTranscription.length} transcribed pages
      {:else}
        {pagesWithTranscription.length} transcribed page{pagesWithTranscription.length !== 1 ? 's' : ''}
      {/if}
    </div>

    <div class="results-list">
      {#each searchResults as page (page.pageName)}
        <SearchResultCard
          {page}
          query={searchQuery}
          inCanvas={isInCanvas(page)}
          busy={importingKey === page.pageName}
          on:import={() => handleImport(page)}
          on:open={() => handleOpen(page)}
        />
      {/each}
    </div>
  {/if}
</div>

<style>
  .transcript-search {
    display: flex;
    flex-direction: column;
    min-height: 0;
    flex: 1;
    gap: 10px;
  }

  .search-bar {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 6px 10px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 6px;
    flex-shrink: 0;
  }

  .search-bar:focus-within {
    border-color: var(--accent);
  }

  .search-icon {
    font-size: 0.8rem;
    opacity: 0.7;
  }

  .search-bar input {
    flex: 1;
    min-width: 0;
    background: transparent;
    border: none;
    color: var(--text-primary);
    font-size: 0.82rem;
    outline: none;
  }

  .search-bar input::placeholder {
    color: var(--text-secondary);
  }

  .clear-btn {
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 0.8rem;
    padding: 0 2px;
  }

  .clear-btn:hover {
    color: var(--text-primary);
  }

  .results-count {
    font-size: 0.7rem;
    color: var(--text-secondary);
    flex-shrink: 0;
  }

  .results-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    overflow-y: auto;
    min-height: 0;
    flex: 1;
    padding-right: 2px;
  }

  .empty-state {
    padding: 30px 20px;
    text-align: center;
    color: var(--text-secondary);
    font-size: 0.8rem;
    line-height: 1.55;
  }

  .empty-title {
    margin: 0 0 6px;
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .empty-state p:last-child {
    margin: 0;
  }
</style>
