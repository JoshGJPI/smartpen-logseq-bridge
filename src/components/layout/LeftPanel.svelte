<!--
  LeftPanel.svelte - Data explorer with a single row of tabs.

  Was two nested tab levels (Data Explorer / Activity Log, then Strokes /
  Transcription / Saved Pages). The log moved to Settings → Troubleshooting in
  v2.7, which left the outer level switching between one thing, so it went and
  the inner row became the navigation.

  Tab ids are unchanged from the nested version — `setActiveTab('transcription')`
  is called from elsewhere (ActionBar, after a transcription run) and renaming
  ids for a label change would be churn with a chance of a silent miss.
-->
<script>
  import StrokeList from '../strokes/StrokeList.svelte';
  import SavedPagesTab from '../saved-pages/SavedPagesTab.svelte';
  import TranscriptsPanel from '../transcription/TranscriptsPanel.svelte';
  import BooksTab from '../books/BooksTab.svelte';

  import { activeTab, setActiveTab, pageTranscriptionCount } from '$stores';

  const tabs = [
    { id: 'strokes', label: 'Strokes' },
    { id: 'transcription', label: 'Transcripts' },
    { id: 'saved-pages', label: 'Pages' },
    { id: 'books', label: 'Books' }
  ];
</script>

<aside class="left-panel panel">
  <div class="panel-tabs" role="tablist">
    {#each tabs as tab (tab.id)}
      <button
        class="panel-tab"
        class:active={$activeTab === tab.id}
        role="tab"
        aria-selected={$activeTab === tab.id}
        on:click={() => setActiveTab(tab.id)}
      >
        {tab.label}
        <!-- Pages waiting to be reviewed, so a finished MyScript run is visible
             from any tab. -->
        {#if tab.id === 'transcription' && $pageTranscriptionCount > 0}
          <span class="tab-badge">{$pageTranscriptionCount}</span>
        {/if}
      </button>
    {/each}
  </div>

  <div class="tab-content">
    {#if $activeTab === 'strokes'}
      <StrokeList />
    {:else if $activeTab === 'transcription'}
      <TranscriptsPanel />
    {:else if $activeTab === 'saved-pages'}
      <SavedPagesTab />
    {:else if $activeTab === 'books'}
      <BooksTab />
    {/if}
  </div>
</aside>

<style>
  .left-panel {
    display: flex;
    flex-direction: column;
    max-height: calc(100vh - 120px);
    overflow: hidden;
    gap: 0;
    padding: 15px;
  }

  .panel-tabs {
    display: flex;
    gap: 4px;
    margin-bottom: 15px;
    border-bottom: 2px solid var(--border);
    flex-wrap: wrap;
  }

  .panel-tab {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 9px 16px;
    background: transparent;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 0.9rem;
    font-weight: 500;
    transition: all 0.2s;
    border-bottom: 2px solid transparent;
    margin-bottom: -2px;
  }

  .panel-tab.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }

  .panel-tab:hover:not(.active) {
    color: var(--text-primary);
    background: rgba(255, 255, 255, 0.03);
  }

  .tab-badge {
    font-size: 0.68rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    background: var(--accent);
    color: #fff;
    border-radius: 9px;
    padding: 1px 6px;
    line-height: 1.4;
  }

  .tab-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    /* Children handle their own overflow. */
  }
</style>
