<!--
  PenControls.svelte - Pen connection buttons and offline data fetch
-->
<script>
  import { penConnected, penAuthorized, log, clearStrokes, addOfflineStrokes } from '$stores';
  import { connectPen, disconnectPen, fetchOfflineData } from '$lib/pen-sdk.js';
  
  let isConnecting = false;
  let isFetchingOffline = false;
  
  async function handleConnect() {
    isConnecting = true;
    try {
      await connectPen();
    } catch (error) {
      log(`Connection failed: ${error.message}`, 'error');
    } finally {
      isConnecting = false;
    }
  }
  
  async function handleDisconnect() {
    try {
      await disconnectPen();
    } catch (error) {
      log(`Disconnect failed: ${error.message}`, 'error');
    }
  }
  
  async function handleFetchOffline() {
    isFetchingOffline = true;
    try {
      await fetchOfflineData();
      // The actual data comes via callbacks - see pen-sdk.js
    } catch (error) {
      log(`Failed to fetch offline data: ${error.message}`, 'error');
    } finally {
      isFetchingOffline = false;
    }
  }
  
  function handleClearCanvas() {
    clearStrokes();
    log('Canvas cleared', 'info');
  }
</script>

<div class="pen-controls">
  {#if !$penConnected}
    <button 
      class="btn btn-primary" 
      on:click={handleConnect}
      disabled={isConnecting}
    >
      {#if isConnecting}
        Connecting...
      {:else}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/>
          <path d="M8 12l3 3 5-6"/>
        </svg>
        Connect Pen
      {/if}
    </button>
  {:else}
    <button 
      class="btn btn-secondary" 
      on:click={handleDisconnect}
    >
      Disconnect
    </button>
  {/if}
  
  <button 
    class="btn btn-secondary" 
    on:click={handleFetchOffline}
    disabled={!$penConnected || !$penAuthorized || isFetchingOffline}
  >
    {#if isFetchingOffline}
      Fetching...
    {:else}
      📥 Fetch Stored Notes
    {/if}
  </button>
  
  <button 
    class="btn btn-secondary" 
    on:click={handleClearCanvas}
  >
    🗑️ Clear Canvas
  </button>
</div>

<style>
  .pen-controls {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .pen-controls svg {
    flex-shrink: 0;
  }
</style>
