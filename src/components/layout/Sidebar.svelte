<!--
  Sidebar.svelte - Left panel with controls and settings
-->
<script>
  import PenControls from '../pen/PenControls.svelte';
  import PenInfo from '../pen/PenInfo.svelte';
  import MyScriptSettings from '../settings/MyScriptSettings.svelte';
  import LogseqSettings from '../settings/LogseqSettings.svelte';
  import ActivityLog from './ActivityLog.svelte';
  
  import { penConnected } from '$stores';
</script>

<aside class="sidebar panel">
  <section class="control-section">
    <div class="panel-header">Pen Connection</div>
    <PenControls />
    
    {#if $penConnected}
      <PenInfo />
    {/if}
  </section>
  
  <section class="control-section">
    <div class="panel-header">MyScript Transcription</div>
    <MyScriptSettings />
  </section>
  
  <section class="control-section">
    <div class="panel-header">LogSeq Settings</div>
    <LogseqSettings />
  </section>
  
  <section class="control-section log-section">
    <div class="panel-header">Activity Log</div>
    <ActivityLog />
  </section>
</aside>

<style>
  .sidebar {
    display: flex;
    flex-direction: column;
    gap: 0;
    overflow-y: auto;
    max-height: calc(100vh - 120px);
  }

  .control-section {
    padding-bottom: 15px;
    margin-bottom: 15px;
    border-bottom: 1px solid var(--border);
  }

  .control-section:last-child {
    border-bottom: none;
    margin-bottom: 0;
    padding-bottom: 0;
  }

  .log-section {
    flex: 1;
    min-height: 150px;
    display: flex;
    flex-direction: column;
  }

  .panel-header {
    font-size: 0.95rem;
    font-weight: 600;
    margin-bottom: 12px;
    color: var(--text-primary);
  }
</style>
