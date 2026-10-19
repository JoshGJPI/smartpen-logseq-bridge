<!--
  LeftPanel.svelte - Data explorer with a single row of tabs.

  Was two nested tab levels (Data Explorer / Activity Log, then Strokes /
  Transcription / Saved Pages). The log moved to Settings → Troubleshooting in
  v2.7, which left the outer level switching between one thing, so it went and
  the inner row became the navigation.

  Tab ids are unchanged from the nested version — `setActiveTab('transcription')`
  is called from elsewhere (ActionBar, after a transcription run) and renaming
  ids for a label change would be churn with a chance of a silent miss.

  Collapsible (reading-first package B): a chevron or the `[` key (App.svelte)
  folds the panel to a ~48 px rail. The rail keeps what a hidden panel would
  lose: an expand chevron, one icon per tab (click = expand and select) and the
  Transcripts badge. The tab content is not mounted while collapsed.
-->
<script>
  import StrokeList from '../strokes/StrokeList.svelte';
  import SavedPagesTab from '../saved-pages/SavedPagesTab.svelte';
  import TranscriptsPanel from '../transcription/TranscriptsPanel.svelte';
  import BooksTab from '../books/BooksTab.svelte';
  import DatesTab from '../dates/DatesTab.svelte';

  import {
    activeTab, setActiveTab, pageTranscriptionCount,
    leftPanelCollapsed, toggleLeftPanel, revealLeftPanel
  } from '$stores';

  // `icon` is an SVG path set (24×24, stroked) for the collapsed rail.
  const tabs = [
    { id: 'strokes', label: 'Strokes',
      icon: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z' },
    { id: 'transcription', label: 'Transcripts',
      icon: 'M4 6h16M4 10h16M4 14h16M4 18h10' },
    { id: 'saved-pages', label: 'Pages',
      icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6' },
    { id: 'books', label: 'Books',
      icon: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z' },
    // Loads the canvas by capture date instead of by notebook. Last because it
    // cuts across the other four rather than sitting alongside them.
    { id: 'dates', label: 'Dates',
      icon: 'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM16 2v4M8 2v4M3 10h18' }
  ];
</script>

<aside class="left-panel panel" class:collapsed={$leftPanelCollapsed}>
  {#if $leftPanelCollapsed}
    <div class="rail" role="tablist" aria-label="Data explorer (collapsed)" aria-orientation="vertical">
      <button
        class="rail-btn rail-chevron"
        on:click={toggleLeftPanel}
        title="Expand the panel  ( [ )"
        aria-label="Expand the panel"
        aria-expanded="false"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
      {#each tabs as tab (tab.id)}
        <button
          class="rail-btn"
          class:active={$activeTab === tab.id}
          role="tab"
          aria-selected={$activeTab === tab.id}
          aria-label={tab.label}
          title={tab.label}
          on:click={() => revealLeftPanel(tab.id)}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={tab.icon}/></svg>
          <!-- Same badge as the tab row: a finished MyScript run stays visible. -->
          {#if tab.id === 'transcription' && $pageTranscriptionCount > 0}
            <span class="tab-badge rail-badge">{$pageTranscriptionCount}</span>
          {/if}
        </button>
      {/each}
    </div>
  {:else}
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
      <button
        class="collapse-btn"
        on:click={toggleLeftPanel}
        title="Collapse the panel  ( [ )"
        aria-label="Collapse the panel"
        aria-expanded="true"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
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
      {:else if $activeTab === 'dates'}
        <DatesTab />
      {/if}
    </div>
  {/if}
</aside>

<style>
  .left-panel {
    display: flex;
    flex-direction: column;
    /* Fills the grid row (App.svelte pins it to minmax(0, 1fr)) instead of
       guessing the header's height, which now changes with the capture bar. */
    min-height: 0;
    max-height: 100%;
    overflow: hidden;
    gap: 0;
    padding: 15px;
  }

  /* ~48 px rail: the grid column (App.svelte) sets the width, this trims the
     panel's padding to fit. */
  .left-panel.collapsed {
    padding: 8px 5px;
    align-items: center;
  }

  .rail {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
  }

  .rail-btn {
    position: relative;
    width: 34px;
    height: 34px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 7px;
    color: var(--text-secondary);
    cursor: pointer;
  }

  .rail-btn:hover {
    color: var(--text-primary);
    background: rgba(255, 255, 255, 0.05);
  }

  /* The selected tab, as in the expanded row: neutral raised + blue edge. */
  .rail-btn.active {
    color: var(--text-primary);
    background: var(--selected-bg);
    box-shadow: inset 2px 0 0 var(--selected-line);
  }

  .rail-chevron {
    margin-bottom: 6px;
    border-color: var(--border);
  }

  .rail-badge {
    position: absolute;
    top: -4px;
    right: -4px;
  }

  .panel-tabs {
    display: flex;
    gap: 4px;
    margin-bottom: 15px;
    border-bottom: 2px solid var(--border);
    flex-wrap: wrap;
  }

  .collapse-btn {
    margin: 0 0 -2px auto;
    padding: 0 8px;
    display: inline-flex;
    align-items: center;
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--text-secondary);
    cursor: pointer;
  }

  .collapse-btn:hover {
    color: var(--text-primary);
  }

  .panel-tab {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    /* 11 px, not 16: five tabs plus the collapse chevron have to share one row
       of the 450 px panel. */
    padding: 9px 11px;
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

  /* Selected = neutral text with a blue underline; the red accent is kept for
     the one primary action on a screen. */
  .panel-tab.active {
    color: var(--text-primary);
    border-bottom-color: var(--selected-line);
  }

  .panel-tab:hover:not(.active) {
    color: var(--text-primary);
    background: rgba(255, 255, 255, 0.03);
  }

  .tab-badge {
    font-size: 0.75rem;
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
