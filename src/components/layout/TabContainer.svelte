<!--
  TabContainer.svelte - Right panel with data explorer tabs
-->
<script>
  import { activeTab, setActiveTab } from '$stores';
  
  import StrokeList from '../strokes/StrokeList.svelte';
  import RawJsonViewer from '../strokes/RawJsonViewer.svelte';
  import LogSeqDbTab from '../logseq-db/LogSeqDbTab.svelte';
  import TranscriptionView from '../transcription/TranscriptionView.svelte';
  
  const tabs = [
    { id: 'strokes', label: 'Strokes' },
    { id: 'transcription', label: 'Transcription' },
    { id: 'logseq-db', label: 'LogSeq DB' },
    { id: 'raw', label: 'Raw JSON' }
  ];
</script>

<aside class="data-panel panel">
  <div class="panel-header">Data Explorer</div>
  
  <div class="tabs">
    {#each tabs as tab (tab.id)}
      <button 
        class="tab" 
        class:active={$activeTab === tab.id}
        on:click={() => setActiveTab(tab.id)}
      >
        {tab.label}
      </button>
    {/each}
  </div>
  
  <div class="tab-content">
    {#if $activeTab === 'strokes'}
      <StrokeList />
    {:else if $activeTab === 'transcription'}
      <TranscriptionView />
    {:else if $activeTab === 'logseq-db'}
      <LogSeqDbTab />
    {:else if $activeTab === 'raw'}
      <RawJsonViewer />
    {/if}
  </div>
</aside>

<style>
  .data-panel {
    display: flex;
    flex-direction: column;
    max-height: calc(100vh - 120px);
    overflow: hidden;
  }

  .tabs {
    display: flex;
    gap: 5px;
    margin-bottom: 15px;
    flex-wrap: wrap;
  }

  .tab {
    padding: 8px 16px;
    background: transparent;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    border-radius: 6px;
    font-size: 0.875rem;
    transition: all 0.2s;
  }

  .tab.active {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .tab:hover:not(.active) {
    color: var(--text-primary);
    background: rgba(255,255,255,0.05);
  }

  .tab-content {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
  }
</style>
