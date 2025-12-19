<!--
  DbHeader.svelte - Header for LogSeq DB tab with refresh and status
-->
<script>
  import { createEventDispatcher } from 'svelte';
  
  export let connected;
  export let scanning;
  export let lastScan;
  
  const dispatch = createEventDispatcher();
  
  function handleRefresh() {
    dispatch('refresh');
  }
  
  function formatTime(timestamp) {
    if (!timestamp) return 'Never';
    return new Date(timestamp).toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit'
    });
  }
</script>

<div class="db-header">
  <button 
    class="refresh-btn" 
    on:click={handleRefresh}
    disabled={scanning || !connected}
    title="Refresh page list from LogSeq"
  >
    <span class="icon" class:spinning={scanning}>🔄</span>
    Refresh
  </button>
  
  <div class="status">
    {#if connected}
      <span class="connected">Connected to localhost:12315</span>
    {:else}
      <span class="disconnected">Not connected</span>
    {/if}
  </div>
  
  {#if lastScan}
    <div class="last-scan">
      Last scanned: {formatTime(lastScan)}
    </div>
  {/if}
</div>

<style>
  .db-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px;
    background: var(--bg-secondary);
    border-radius: 8px;
    margin-bottom: 16px;
    flex-wrap: wrap;
  }
  
  .refresh-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    background: var(--bg-tertiary);
    border: none;
    border-radius: 6px;
    color: var(--text-primary);
    cursor: pointer;
    font-size: 0.875rem;
    transition: all 0.2s;
  }
  
  .refresh-btn:hover:not(:disabled) {
    background: var(--accent-color);
    color: white;
  }
  
  .refresh-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  .icon {
    font-size: 1rem;
    transition: transform 0.3s;
  }
  
  .icon.spinning {
    animation: spin 1s linear infinite;
  }
  
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  
  .status {
    flex: 1;
    font-size: 0.875rem;
  }
  
  .connected {
    color: var(--success-color, #4caf50);
  }
  
  .disconnected {
    color: var(--text-tertiary);
  }
  
  .last-scan {
    font-size: 0.75rem;
    color: var(--text-tertiary);
  }
</style>
