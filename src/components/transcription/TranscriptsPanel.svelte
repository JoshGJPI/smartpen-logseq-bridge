<!--
  TranscriptsPanel.svelte — the Transcripts tab: review incoming, search saved.

  Two halves of one job that used to live in different places. Review is the
  existing TranscriptionView (transcriptions waiting to be checked and saved);
  Search was a modal opened from the canvas toolbar.

  The mode lives in a store rather than local state so the canvas can route
  straight to Search (toolbar 🔍 / Ctrl+F) and so switching tabs away and back
  returns you to the half you were using.
-->
<script>
  import { tick } from 'svelte';
  import {
    transcriptsMode,
    transcriptSearchFocus,
    pageTranscriptionCount,
    isTranscribing
  } from '$stores';
  import TranscriptionView from './TranscriptionView.svelte';
  import TranscriptSearch from './TranscriptSearch.svelte';

  let searchInput = null;

  // A finished transcription is the one thing that should pull the panel back
  // to Review — it is new work that needs checking before it can be saved.
  let prevCount = $pageTranscriptionCount;
  $: {
    const count = $pageTranscriptionCount;
    if (count > prevCount) transcriptsMode.set('review');
    prevCount = count;
  }

  // The canvas asks for focus by bumping the counter; act on every change but
  // not on the initial subscription.
  let lastFocusToken = $transcriptSearchFocus;
  $: if ($transcriptSearchFocus !== lastFocusToken) {
    lastFocusToken = $transcriptSearchFocus;
    focusSearch();
  }

  /** The request usually arrives with the mode switch, so the input does not
   *  exist yet — wait for Svelte to mount Search before reaching for it. */
  async function focusSearch() {
    await tick();
    searchInput?.focus();
  }
</script>

<div class="transcripts-panel">
  <div class="mode-switch" role="group" aria-label="Transcripts view">
    <button
      class="mode-btn"
      class:active={$transcriptsMode === 'review'}
      on:click={() => transcriptsMode.set('review')}
    >
      Review
      {#if $pageTranscriptionCount > 0}
        <span class="mode-count">{$pageTranscriptionCount}</span>
      {/if}
    </button>
    <button
      class="mode-btn"
      class:active={$transcriptsMode === 'search'}
      on:click={() => transcriptsMode.set('search')}
    >
      Search
    </button>
  </div>

  <div class="mode-content">
    {#if $transcriptsMode === 'search'}
      <TranscriptSearch bind:searchInput />
    {:else}
      <TranscriptionView />

      {#if $pageTranscriptionCount === 0 && !$isTranscribing}
        <div class="nudge">
          Looking for something you already transcribed?
          <button class="link-btn" on:click={() => transcriptsMode.set('search')}>
            Search saved transcripts →
          </button>
        </div>
      {/if}
    {/if}
  </div>
</div>

<style>
  .transcripts-panel {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    gap: 12px;
  }

  .mode-switch {
    display: flex;
    gap: 2px;
    padding: 2px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 7px;
    flex-shrink: 0;
    align-self: flex-start;
  }

  .mode-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 14px;
    background: transparent;
    border: none;
    border-radius: 5px;
    color: var(--text-secondary);
    font-size: 0.8rem;
    cursor: pointer;
    transition: all 0.15s;
  }

  .mode-btn:hover:not(.active) {
    color: var(--text-primary);
  }

  .mode-btn.active {
    background: var(--accent);
    color: #fff;
  }

  .mode-count {
    font-size: 0.68rem;
    font-variant-numeric: tabular-nums;
    background: rgba(255, 255, 255, 0.18);
    border-radius: 8px;
    padding: 0 5px;
  }

  .mode-btn:not(.active) .mode-count {
    background: var(--bg-tertiary);
  }

  .mode-content {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  .nudge {
    flex-shrink: 0;
    padding: 10px 0 0;
    margin-top: 10px;
    border-top: 1px solid var(--border);
    font-size: 0.75rem;
    color: var(--text-secondary);
    text-align: center;
  }

  .link-btn {
    display: block;
    margin: 4px auto 0;
    padding: 0;
    background: none;
    border: none;
    color: var(--accent);
    font-size: 0.75rem;
    cursor: pointer;
  }

  .link-btn:hover {
    text-decoration: underline;
  }
</style>
