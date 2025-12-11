<!--
  Header.svelte - Application header with status indicators, action buttons, and settings
-->
<script>
  import { penConnected, penAuthorized, penBattery } from '$stores';
  import { logseqConnected, logseqStatusText } from '$stores';
  import ActionBar from '../header/ActionBar.svelte';
  import SettingsDropdown from '../header/SettingsDropdown.svelte';
</script>

<header class="header">
  <div class="header-left">
    <h1 class="title">NeoSmartpen → <span class="accent">LogSeq</span> Bridge</h1>
    
    <div class="status-bar">
      <!-- Pen Status -->
      <div class="status-indicator">
        <div 
          class="status-dot" 
          class:connected={$penConnected && $penAuthorized}
          class:connecting={$penConnected && !$penAuthorized}
        ></div>
        <span class="status-text">
          {#if $penConnected && $penAuthorized}
            Connected {$penBattery ? `(${$penBattery})` : ''}
          {:else if $penConnected}
            Authorizing...
          {:else}
            Disconnected
          {/if}
        </span>
      </div>
      
      <!-- LogSeq Status -->
      <div class="status-indicator">
        <div 
          class="status-dot"
          class:connected={$logseqConnected}
        ></div>
        <span class="status-text">{$logseqStatusText}</span>
      </div>
    </div>
  </div>
  
  <div class="header-right">
    <ActionBar />
    <SettingsDropdown />
  </div>
</header>

<style>
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 20px 0;
    border-bottom: 1px solid var(--border);
    margin-bottom: 20px;
    gap: 20px;
  }

  .header-left {
    display: flex;
    flex-direction: column;
    gap: 10px;
    flex: 1;
  }

  .header-right {
    display: flex;
    gap: 12px;
    align-items: center;
  }

  .title {
    font-size: 1.5rem;
    font-weight: 600;
  }

  .accent {
    color: var(--accent);
  }

  .status-bar {
    display: flex;
    gap: 20px;
    align-items: center;
  }

  .status-indicator {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.875rem;
  }

  .status-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--text-secondary);
    transition: all 0.3s ease;
  }

  .status-dot.connected {
    background: var(--success);
    box-shadow: 0 0 10px var(--success);
  }

  .status-dot.connecting {
    background: var(--warning);
    animation: pulse 1s infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  .status-text {
    color: var(--text-secondary);
  }

  /* Responsive adjustments */
  @media (max-width: 1400px) {
    .header {
      flex-wrap: wrap;
    }
    
    .header-left {
      flex: 0 0 100%;
    }
    
    .header-right {
      flex: 1;
      justify-content: flex-end;
    }
  }

  @media (max-width: 1200px) {
    .title {
      font-size: 1.3rem;
    }
    
    .status-bar {
      gap: 15px;
    }
  }
</style>
