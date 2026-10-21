<!--
  PenChip.svelte - Pen state in one header chip: Connect target when
  disconnected, model + battery when connected (with a small Disconnect).

  Connect and Disconnect used to be buttons in ActionBar. The chip replaces them
  so the header carries the pen's state without a seven-button toolbar; the pen
  logic itself (connectPen / disconnectPen) is unchanged.

  While connected, the dot and the pen's name are one button that opens Manage
  Pen Memory (it used to be a Settings section): pen memory is about the pen,
  so it opens from the pen.
-->
<script>
  import { penConnected, penAuthorized, penBattery, penInfo, log } from '$stores';
  import { connectPen, disconnectPen } from '$lib/pen-sdk.js';
  import PenMemoryDialog from '../dialog/PenMemoryDialog.svelte';

  let isConnecting = false;
  let showPenMemory = false;

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
  {#if authorized}
    <button
      class="pen-identity"
      on:click={() => (showPenMemory = true)}
      title="Manage pen memory: remove imported books from the pen"
    >
      <span class="dot" aria-hidden="true"></span>
      <span class="label">
        {penModel}{#if batteryPercent !== null && !Number.isNaN(batteryPercent)}<span
          class="battery"
          class:low={batteryPercent < 20}
        > · {batteryPercent}%</span>{/if}
      </span>
    </button>
    <button
      class="chip-action"
      on:click={handleDisconnect}
      title="Disconnect from the pen"
    >Disconnect</button>
  {:else if $penConnected}
    <span class="dot" aria-hidden="true"></span>
    <span class="label">Authorizing…</span>
  {:else}
    <span class="dot" aria-hidden="true"></span>
    <span class="label muted">Pen: not connected</span>
    <button
      class="chip-action connect"
      on:click={handleConnect}
      disabled={isConnecting}
      title="Connect to SmartPen via Bluetooth"
    >{isConnecting ? 'Connecting…' : 'Connect'}</button>
  {/if}
</div>

<!-- Outside the chip's {#if}: the dialog shows its own result after a delete
     even if the pen drops mid-way. -->
<PenMemoryDialog bind:visible={showPenMemory} />

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

  /* Dot + name as one quiet button: no chrome until hovered, so the chip
     reads the same as before. The left margin pulls it back over the chip's
     padding so the hover pill fits the chip's curve. */
  .pen-identity {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin-left: -6px;
    padding: 3px 8px 3px 6px;
    border: none;
    border-radius: 99px;
    background: transparent;
    font: inherit;
    cursor: pointer;
  }

  .pen-identity:hover {
    background: rgba(255, 255, 255, 0.06);
  }

  .pen-identity:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
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
