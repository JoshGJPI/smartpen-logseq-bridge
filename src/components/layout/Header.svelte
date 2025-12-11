<!--
  Header.svelte - Application header with status indicators, action buttons, and settings
-->
<script>
  import { penConnected, penAuthorized, penBattery, penInfo, penMemory } from '$stores';
  import { logseqConnected, logseqStatusText } from '$stores';
  import ActionBar from '../header/ActionBar.svelte';
  import SettingsDropdown from '../header/SettingsDropdown.svelte';
  
  // Extract pen model name
  $: penModel = $penInfo?.ModelName || $penInfo?.DeviceName || 'Pen';
  $: batteryPercent = $penBattery ? $penBattery.replace('%', '') : '0';
  $: memoryPercent = $penMemory ? $penMemory.replace('%', '') : '0';
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
            Connected - {penModel}
            {#if $penBattery || $penMemory}
              <span class="pen-details">
                ({#if $penBattery}<span class="detail-item" class:low-battery={parseInt(batteryPercent) < 20}>
                  {batteryPercent}%
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="icon battery-icon">
                    <rect x="2" y="6" width="18" height="12" rx="2" ry="2"/>
                    <line x1="22" y1="10" x2="22" y2="14"/>
                  </svg>
                </span>{/if}{#if $penMemory}<span class="detail-item">
                  {memoryPercent}%
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="icon memory-icon">
                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                  </svg>
                </span>{/if})
              </span>
            {/if}
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
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .pen-details {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin-left: 4px;
  }

  .detail-item {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 0.85rem;
  }

  .detail-item.low-battery {
    color: var(--warning);
  }

  .icon {
    flex-shrink: 0;
    opacity: 0.7;
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
