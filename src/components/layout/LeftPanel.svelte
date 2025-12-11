<!--
  LeftPanel.svelte - Combined data explorer and activity log with tabbed interface
-->
<script>
  import { writable } from 'svelte/store';
  
  // Components
  import ActivityLog from './ActivityLog.svelte';
  import StrokeList from '../strokes/StrokeList.svelte';
  import RawJsonViewer from '../strokes/RawJsonViewer.svelte';
  import AnalysisView from '../strokes/AnalysisView.svelte';
  import TranscriptionView from '../transcription/TranscriptionView.svelte';
  
  // Store for data explorer tabs
  import { activeTab, setActiveTab } from '$stores';
  
  // Local store for main panel tabs
  const mainTab = writable('explorer'); // 'explorer' or 'log'
  
  const mainTabs = [
    { id: 'explorer', label: 'Data Explorer' },
    { id: 'log', label: 'Activity Log' }
  ];
  
  const explorerTabs = [
    { id: 'strokes', label: 'Strokes' },
    { id: 'raw', label: 'Raw JSON' },
    { id: 'analysis', label: 'Analysis' },
    { id: 'transcription', label: 'Transcription' }
  ];
</script>

<aside class="left-panel panel">
  <!-- Main Tabs (Data Explorer / Activity Log) -->
  <div class="main-tabs">
    {#each mainTabs as tab (tab.id)}
      <button 
        class="main-tab" 
        class:active={$mainTab === tab.id}
        on:click={() => mainTab.set(tab.id)}
      >
        {tab.label}
      </button>
    {/each}
  </div>
  
  <!-- Tab Content -->
  <div class="tab-content">
    {#if $mainTab === 'explorer'}
      <!-- Data Explorer Sub-tabs -->
      <div class="explorer-tabs">
        {#each explorerTabs as tab (tab.id)}
          <button 
            class="explorer-tab" 
            class:active={$activeTab === tab.id}
            on:click={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        {/each}
      </div>
      
      <!-- Data Explorer Content -->
      <div class="explorer-content">
        {#if $activeTab === 'strokes'}
          <StrokeList />
        {:else if $activeTab === 'raw'}
          <RawJsonViewer />
        {:else if $activeTab === 'analysis'}
          <AnalysisView />
        {:else if $activeTab === 'transcription'}
          <TranscriptionView />
        {/if}
      </div>
    {:else if $mainTab === 'log'}
      <!-- Activity Log Content -->
      <div class="log-content">
        <ActivityLog />
      </div>
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

  /* Main Tabs (Data Explorer / Activity Log) */
  .main-tabs {
    display: flex;
    gap: 5px;
    margin-bottom: 15px;
    border-bottom: 2px solid var(--border);
  }

  .main-tab {
    padding: 10px 20px;
    background: transparent;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 0.95rem;
    font-weight: 500;
    transition: all 0.2s;
    border-bottom: 2px solid transparent;
    margin-bottom: -2px;
  }

  .main-tab.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }

  .main-tab:hover:not(.active) {
    color: var(--text-primary);
    background: rgba(255,255,255,0.03);
  }

  /* Tab Content Container */
  .tab-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }

  /* Explorer Sub-tabs */
  .explorer-tabs {
    display: flex;
    gap: 5px;
    margin-bottom: 15px;
    flex-wrap: wrap;
  }

  .explorer-tab {
    padding: 8px 16px;
    background: transparent;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    border-radius: 6px;
    font-size: 0.875rem;
    transition: all 0.2s;
  }

  .explorer-tab.active {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .explorer-tab:hover:not(.active) {
    color: var(--text-primary);
    background: rgba(255,255,255,0.05);
  }

  /* Content Areas */
  .explorer-content,
  .log-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    min-height: 0;
  }

  /* Scrollbar styling */
  .explorer-content::-webkit-scrollbar,
  .log-content::-webkit-scrollbar {
    width: 8px;
  }

  .explorer-content::-webkit-scrollbar-track,
  .log-content::-webkit-scrollbar-track {
    background: var(--bg-tertiary);
    border-radius: 4px;
  }

  .explorer-content::-webkit-scrollbar-thumb,
  .log-content::-webkit-scrollbar-thumb {
    background: var(--border);
    border-radius: 4px;
  }

  .explorer-content::-webkit-scrollbar-thumb:hover,
  .log-content::-webkit-scrollbar-thumb:hover {
    background: var(--accent);
  }
</style>
