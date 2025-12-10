<!--
  PenInfo.svelte - Display connected pen information
-->
<script>
  import { penInfo, penBattery, penMemory } from '$stores';
</script>

{#if $penInfo}
  <div class="pen-info">
    <div class="info-row">
      <span class="info-label">Model</span>
      <span class="info-value">{$penInfo.ModelName || $penInfo.DeviceName || 'NeoSmartpen'}</span>
    </div>
    
    <div class="info-row">
      <span class="info-label">Battery</span>
      <span class="info-value" class:warning={$penInfo.Battery < 20 && $penInfo.Battery !== 128}>
        {$penBattery || '-'}
      </span>
    </div>
    
    <div class="info-row">
      <span class="info-label">Memory</span>
      <span class="info-value">{$penMemory || '-'}</span>
    </div>
    
    {#if $penInfo.MacAddress}
      <div class="info-row">
        <span class="info-label">MAC</span>
        <span class="info-value mac">{$penInfo.MacAddress}</span>
      </div>
    {/if}
    
    {#if $penInfo.ProtocolVersion}
      <div class="info-row">
        <span class="info-label">Protocol</span>
        <span class="info-value">v{$penInfo.ProtocolVersion}</span>
      </div>
    {/if}
  </div>
{/if}

<style>
  .pen-info {
    background: var(--bg-tertiary);
    border-radius: 8px;
    padding: 12px;
    margin-top: 10px;
  }

  .info-row {
    display: flex;
    justify-content: space-between;
    padding: 4px 0;
    font-size: 0.85rem;
  }

  .info-label {
    color: var(--text-secondary);
  }

  .info-value {
    color: var(--text-primary);
    font-weight: 500;
  }

  .info-value.warning {
    color: var(--warning);
  }

  .info-value.mac {
    font-family: 'Consolas', monospace;
    font-size: 0.8rem;
  }
</style>
