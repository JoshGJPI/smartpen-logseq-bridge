<!--
  PenChip.svelte - Pen state in one header chip: Connect target when
  disconnected, model + battery when connected (with a small Disconnect).

  Connect and Disconnect used to be buttons in ActionBar. The chip replaces them
  so the header carries the pen's state without a seven-button toolbar; the pen
  logic itself (connectPen / disconnectPen) is unchanged.
-->
<script>
  import { penConnected, penAuthorized, penBattery, penInfo, log } from '$stores';
  import { connectPen, disconnectPen } from '$lib/pen-sdk.js';

  let isConnecting = false;

  $: authorized = $penConnected && $penAuthorized;
  $: penModel = $penInfo?.ModelName || $penInfo?.DeviceName || 'Pen';
  $: batteryPercent = $penBattery ? parseInt($penBattery.replace('%', ''), 10) : null;

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
</script>

<div class="pen-chip" class:connected={authorized} class:connecting={$penConnected && !authorized}>
  <span class="dot" aria-hidden="true"></span>

  {#if authorized}
    <span class="label">
      {penModel}{#if batteryPercent !== null && !Number.isNaN(batteryPercent)}<span
        class="battery"
        class:low={batteryPercent < 20}
        title="Pen battery"
      > · {batteryPercent}%</span>{/if}
    </span>
    <button
      class="chip-action"
      on:click={handleDisconnect}
      title="Disconnect from the pen"
    >Disconnect</button>
  {:else if $penConnected}
    <span class="label">Authorizing…</span>
  {:else}
    <span class="label muted">Pen: not connected</span>
    <button
      class="chip-action connect"
      on:click={handleConnect}
      disabled={isConnecting}
      title="Connect to SmartPen via Bluetooth"
    >{isConnecting ? 'Connecting…' : 'Connect'}</button>
  {/if}
</div>

<style>
  .pen-chip {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 30px;
    padding: 0 6px 0 11px;
    border-radius: 99px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    font-size: 0.8125rem;
    white-space: nowrap;
  }

  .pen-chip.connected {
    border-color: rgba(74, 222, 128, 0.35);
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--text-secondary);
    flex-shrink: 0;
  }

  .connected .dot {
    background: var(--success);
    box-shadow: 0 0 8px var(--success);
  }

  .connecting .dot {
    background: var(--warning);
    animation: pulse 1s infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  .label {
    color: var(--text-primary);
  }

  .label.muted {
    color: var(--text-secondary);
  }

  .battery {
    color: var(--text-secondary);
  }

  .battery.low {
    color: var(--warning);
  }

  /* Text buttons inside the chip, not a second toolbar: Connect is the one
     coloured thing in the header, so the eye finds it when it is needed. */
  .chip-action {
    border: none;
    background: transparent;
    color: var(--text-secondary);
    font-size: 0.8125rem;
    font-weight: 500;
    padding: 3px 9px;
    border-radius: 99px;
    cursor: pointer;
  }

  .chip-action:hover:not(:disabled) {
    color: var(--text-primary);
    background: rgba(255, 255, 255, 0.06);
  }

  .chip-action.connect {
    background: var(--accent);
    color: #fff;
  }

  .chip-action.connect:hover:not(:disabled) {
    background: var(--accent-hover);
    color: #fff;
  }

  .chip-action:disabled {
    opacity: 0.6;
    cursor: wait;
  }
</style>
